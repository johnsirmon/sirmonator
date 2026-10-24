import {test} from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {openStorage} from '../src/storage.js';
import {makeRecording,chaptersFor,selectedText,decodeText,MAX_READING} from '../src/recording.js';
import {runRecording,recordingBlob} from '../src/job-runner.js';
const settings={voice:'prime',edition:'refined',delivery:'natural',speed:1};
const audio={bytes:new Uint8Array([1,2,3]),seconds:1,sampleRate:24000};
const database=()=>openStorage(indexedDB,'test-'+crypto.randomUUID());
const source='Good morning, church. Love your neighbor.\n\n'.repeat(18);

test('large text chapters and ranges preserve every character and obey per-reading limits',async()=>{
 const text='John 3:16. “Faith, hope, and love.” 😀\n\n'.repeat(16000),chapters=chaptersFor(text);
 assert.ok(text.length>150000);assert.equal(chapters.map(c=>text.slice(c.start,c.end)).join(''),text);
 assert.ok(chapters.every(c=>c.end-c.start<=6000));
 const range=selectedText(text,chapters,1,2);assert.equal(range,text.slice(chapters[1].start,chapters[2].end));
 const job=await makeRecording(range,settings);assert.equal(job.passages.map(p=>job.source.slice(p.start,p.end)).join(''),range);
 await assert.rejects(makeRecording('x'.repeat(MAX_READING+1),settings),/smaller chapter range/);
 assert.throws(()=>selectedText(text,chapters,3,2),/valid chapter/);
});

test('recording identity prevents stale audio reuse after text, voice edition, delivery, or speed changes',async()=>{
 const original=await makeRecording(source,settings),same=await makeRecording(source,{...settings},'Different title');assert.equal(original.id,same.id);
 for(const [text,config] of [[source+'Amen.',settings],[source,{...settings,edition:'previous'}],[source,{...settings,speed:1.15}],[source,{...settings,delivery:'reflective'}],[source,{...settings,voice:'fenix'}]])assert.notEqual(original.id,(await makeRecording(text,config)).id);
});

test('TXT decoding handles Unicode BOMs and rejects corrupted input without replacement',()=>{
 assert.equal(decodeText(new TextEncoder().encode('Hello 😀').buffer),'Hello 😀');
 assert.equal(decodeText(new Uint8Array([255,254,65,0,66,0]).buffer),'AB');
 assert.equal(decodeText(new Uint8Array([254,255,0,65,0,66]).buffer),'AB');
 assert.throws(()=>decodeText(new Uint8Array([255,0]).buffer),/encoding/);
});

test('draft, saved passages and playback position survive database close and reopen',async()=>{
 const name='persist-'+crypto.randomUUID();let store=await openStorage(indexedDB,name);
 const job=await makeRecording(source,settings);await store.saveDraft({text:source,title:'Sermon',from:0,to:0});await store.ensureJob(job);await store.claim('owner');
 await store.commit(job.id,0,audio,'owner');await store.position(job.id,{chapter:0,time:.75});store.close();
 store=await openStorage(indexedDB,name);assert.equal((await store.draft()).text,source);const restored=await store.job(job.id);assert.equal(restored.next,1);assert.equal(restored.position.time,.75);assert.equal((await store.part(job.id,0)).blob.size,3);store.close();
});

test('pause, cancellation, failure and resume generate only missing passages in exact source order',async()=>{
 const store=await database(),job=await makeRecording(source,settings);await store.ensureJob(job);await store.claim('owner');let paused=false;const calls=[];
 const generate=async text=>{calls.push(text);return audio;};
 const partial=await runRecording({store,id:job.id,owner:'owner',generate,shouldPause:()=>paused,onSaved:()=>{paused=true;}});assert.equal(partial.next,1);
 await assert.rejects(runRecording({store,id:job.id,owner:'owner',generate:async()=>{throw Error('device lost');}}),/device lost/);assert.equal((await store.job(job.id)).next,1);
 const ready=await runRecording({store,id:job.id,owner:'owner',generate});assert.equal(ready.state,'ready');assert.equal(calls.join(''),source);assert.equal(calls.length,job.passages.length);
 const again=await runRecording({store,id:job.id,owner:'owner',generate});assert.equal(again.next,ready.next);assert.equal(calls.length,job.passages.length);store.close();
});

test('atomic checkpoints reject out-of-order, missing and stale-owner writes; duplicates cannot overwrite',async()=>{
 const store=await database(),job=await makeRecording(source,settings);await store.ensureJob(job);await store.claim('first');
 await assert.rejects(store.commit(job.id,1,audio,'first'),/out of order/);assert.equal((await store.job(job.id)).next,0);
 await assert.rejects(store.commit(job.id,0,{...audio,bytes:new Uint8Array()},'first'),/no audio/);assert.equal(await store.part(job.id,0),undefined);
 await store.commit(job.id,0,audio,'first');await store.commit(job.id,0,{...audio,bytes:new Uint8Array([9])},'first');assert.equal((await store.part(job.id,0)).blob.size,3);
 assert.equal(await store.claim('second'),false);await store.claim('second',true);await assert.rejects(store.commit(job.id,1,audio,'first'),/Another window/);
 await store.commit(job.id,1,audio,'second');assert.equal((await store.job(job.id)).next,2);assert.equal((await store.job(job.id)).bytes,6);store.close();
});

test('failed save never advances the runner; exported partial and chapter audio contain committed bytes only',async()=>{
 const store=await database(),job=await makeRecording('Welcome. '.repeat(1400),settings);await store.ensureJob(job);await store.claim('owner');
 let calls=0;await assert.rejects(runRecording({store:{...store,commit:async()=>{throw new DOMException('No space','QuotaExceededError');}},id:job.id,owner:'owner',generate:async()=>{calls++;return audio;}}),{name:'QuotaExceededError'});assert.equal(calls,1);assert.equal((await store.job(job.id)).next,0);
 const partial=await store.commit(job.id,0,audio,'owner');const result=await recordingBlob(store,partial,0);assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),audio.bytes);
 await assert.rejects(recordingBlob(store,partial,null,2),/individual chapter/);
 await store.deleteJob(job.id);assert.equal(await store.job(job.id),undefined);assert.equal(await store.part(job.id,0),undefined);store.close();
});

// Synthetic source only: simulate damaged local checkpoints without synthesizing speech.
test('resume and download reject changed source, routing, settings and invalid progress before generating',async()=>{
 const store=await database(),job=await makeRecording(source,settings);
 await store.ensureJob(job);await store.claim('owner');
 const variants=[
  {...job,source:job.source.replace('Love','Hate')},
  {...job,sourceHash:'stale'},
  {...job,settings:{...job.settings,speed:1.15}},
  {...job,passages:[...job.passages].reverse()},
  {...job,chapters:[{start:1,end:job.source.length}]},
  {...job,next:-1}, {...job,next:.5}, {...job,next:job.passages.length+1},
 ];
 for(const damaged of variants){
  let generated=0;
  const damagedStore={...store,job:async()=>damaged};
  await assert.rejects(runRecording({store:damagedStore,id:job.id,owner:'owner',generate:async()=>{generated++;return audio;}}),/text integrity/);
  assert.equal(generated,0);
  await assert.rejects(recordingBlob(damagedStore,damaged),/text integrity/);
 }
 assert.equal((await store.job(job.id)).next,0);store.close();
});

test('resume refuses missing committed audio instead of skipping its manuscript passage',async()=>{
 const store=await database(),job=await makeRecording(source,settings);
 await store.ensureJob(job);await store.claim('owner');
 const saved=await store.commit(job.id,0,audio,'owner');let generated=0;
 const damagedStore={...store,parts:async()=>[]};
 await assert.rejects(runRecording({store:damagedStore,id:job.id,owner:'owner',generate:async()=>{generated++;return audio;}}),/text integrity/);
 assert.equal(generated,0);
 await assert.rejects(recordingBlob(damagedStore,saved),/text integrity/);
 assert.equal((await store.job(job.id)).next,1);
 assert.equal((await store.part(job.id,0)).blob.size,3);store.close();
});

test('malformed UTF-16 cannot collide with another source identity; valid Unicode stays exact',async()=>{
 await assert.rejects(makeRecording('Incomplete \uD800',settings),/incomplete Unicode/);
 await assert.rejects(makeRecording('Incomplete \uD801',settings),/incomplete Unicode/);
 const text='\u{1F64F} Faith e\u0301 \u00e9\r\n\tKeep every character.\n\n';
 const job=await makeRecording(text,settings);assert.equal(job.source,text);assert.equal(job.passages.map(p=>text.slice(p.start,p.end)).join(''),text);
});

test('aborted IndexedDB reads reject cleanly without leaking a transaction rejection',async()=>{
 const store=await database();await store.saveDraft({text:source});const get=IDBObjectStore.prototype.get;
 IDBObjectStore.prototype.get=function(...args){const result=get.apply(this,args);queueMicrotask(()=>this.transaction.abort());return result;};
 try{await assert.rejects(store.draft(),{name:'AbortError'});await new Promise(resolve=>setImmediate(resolve));}
 finally{IDBObjectStore.prototype.get=get;store.close();}
});
