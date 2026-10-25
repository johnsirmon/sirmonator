import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {openStorage} from '../src/storage.js';
import {makeRecording} from '../src/recording.js';
import {FOUNDATION_PIPELINE,assertSupportedManifest,currentManifest} from '../src/render-provenance.js';
import previous from '../src/render-contract-944aa8e.json' with {type:'json'};
import {validateCheckpoint,recordingBlob,renderReport} from '../src/job-runner.js';
import {changePassage} from '../src/passage-takes.js';
import {selectedTake,takeRevision,validateTake} from '../src/take-selection.js';
import {renderMetrics} from '../src/render-metrics.js';
import {quantizePcm,CONTINUITY_PIPELINE} from '../src/continuity.js';
import {chapterKey} from '../src/chapter-cache.js';
import {createNodeExportWorker} from '../scripts/export-node.mjs';
import {episodePackage,packageZip} from '../src/podcast.js';
import JSZip from 'jszip';
globalThis.IDBKeyRange=IDBKeyRange;
const config={voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE};
function audio(job,level=.1){const samples=new Float32Array(2400).fill(level);return {bytes:quantizePcm(samples),sampleRate:24000,sampleCount:2400,channels:1,format:'pcm-s16le',seconds:.1,renderManifest:job.settings.renderManifest,metrics:renderMetrics({started:0,synthesized:10,finished:11,audio:{samples,sampleRate:24000,runtime:{provider:'cpu',dtype:'q8',loadMs:2,inferenceMs:7,modelLoadAttempts:1,retries:0}},outputSeconds:.1,format:'pcm-s16le',engine:'kokoro'})};}
async function fixture(settings=config){const name='takes-'+crypto.randomUUID(),store=await openStorage(indexedDB,name);let job=await makeRecording('First original words.\n\nMiddle exact e\u0301 words.\n\nFinal original words.',settings);await store.ensureJob(job);await store.claim('owner');while(job.next<job.passages.length)job=await store.commit(job.id,job.next,audio(job,.1+job.next/10),'owner');assert.equal(job.passages.length,3);return {store,job,name};}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
test('immutable middle take, frozen export snapshot, selection/undo and reload retain exact source and original bytes',async()=>{
 let {store,job,name}=await fixture();const originals=await store.parts(job.id),originalBytes=await Promise.all(originals.map(p=>p.blob.arrayBuffer()));const oldJob=structuredClone(job);let seen;
 job=await changePassage({store,id:job.id,index:1,owner:'owner',revision:0,generate:async(text,settings,last)=>{seen={text,settings,last};return audio(job,.7);}});
 assert.equal(seen.text,job.source.slice(job.passages[1].start,job.passages[1].end));assert.deepEqual(seen.settings,job.settings);assert.equal(seen.last,false);
 assert.notEqual(chapterKey(oldJob,0),chapterKey(job,0));assert.equal(job.id,oldJob.id);assert.equal(job.next,oldJob.next);assert.equal(job.seconds,oldJob.seconds);assert.equal(takeRevision(job),1);
 const parts=await validateCheckpoint(store,job);assert.equal(parts[0].takeId,undefined);assert.equal(parts[2].takeId,undefined);assert.equal(parts[1].takeId,selectedTake(job,1));assert.notDeepEqual(await parts[1].blob.arrayBuffer(),originalBytes[1]);
 for(const [i,p] of (await store.parts(job.id)).entries())assert.deepEqual(await p.blob.arrayBuffer(),originalBytes[i]);
 const before=await recordingBlob(store,oldJob,null,undefined,{createWorker:createNodeExportWorker});const after=await recordingBlob(store,job,null,undefined,{createWorker:createNodeExportWorker});assert.notDeepEqual(await before.blob.arrayBuffer(),await after.blob.arrayBuffer());assert.equal(before.metrics.inputSamples,7200);assert.equal(after.metrics.inputSamples,7200);
 const savedId=selectedTake(job,1);store.close();store=await openStorage(indexedDB,name);job=await store.job(job.id);assert.equal(selectedTake(job,1),savedId);await store.claim('owner');
 job=await changePassage({store,id:job.id,action:'undo',owner:'owner',revision:1});assert.equal(selectedTake(job,1),'original');assert.equal((await store.takes(job.id)).length,1);
 const restored=await recordingBlob(store,job,null,undefined,{createWorker:createNodeExportWorker});assert.deepEqual(await restored.blob.arrayBuffer(),await before.blob.arrayBuffer());
 job=await changePassage({store,id:job.id,index:1,action:'select',takeId:savedId,owner:'owner',revision:2});const report=await renderReport(store,job);assert.equal(report.passages[1].takeId,savedId);assert.match(report.passages[1].audioHash,/^[a-f0-9]{64}$/);assert.equal(report.takeSelection.revision,3);store.close();
});
test('Stop while inference is deferred cannot commit; stale revision and lost lease reject without changing selection',async()=>{
 const {store,job}=await fixture(),gate=deferred(),started=deferred(),controller=new AbortController();
 const pending=changePassage({store,id:job.id,index:1,owner:'owner',revision:0,signal:controller.signal,generate:async()=>{started.resolve();return gate.promise;}});await started.promise;controller.abort();await assert.rejects(pending,{name:'AbortError'});gate.resolve(audio(job));await new Promise(r=>setImmediate(r));assert.equal((await store.takes(job.id)).length,0);
 let changed=await changePassage({store,id:job.id,index:1,owner:'owner',revision:0,generate:async()=>audio(job)});
 await assert.rejects(changePassage({store,id:job.id,index:1,action:'select',takeId:'original',owner:'owner',revision:0}),/changed/);
 await store.release('owner');await assert.rejects(changePassage({store,id:job.id,action:'undo',owner:'owner',revision:takeRevision(changed)}),/owns/);assert.equal(takeRevision(await store.job(job.id)),1);store.close();
});
test('concurrent replacement rejects stale synthesis; per-passage cap is atomic and original stays selectable',async()=>{
 const {store,job}=await fixture(),gate=deferred(),started=deferred();
 const stale=changePassage({store,id:job.id,index:1,owner:'owner',revision:0,generate:async()=>{started.resolve();return gate.promise;}});await started.promise;
 let changed=await changePassage({store,id:job.id,index:1,owner:'owner',revision:0,generate:async()=>audio(job)});gate.resolve(audio(job));await assert.rejects(stale,/changed/);
 changed=await changePassage({store,id:job.id,index:1,owner:'owner',revision:1,generate:async()=>audio(job)});
 await assert.rejects(changePassage({store,id:job.id,index:1,owner:'owner',revision:2,generate:async()=>audio(job)}),/limit/);assert.equal((await store.takes(job.id)).length,2);
 changed=await changePassage({store,id:job.id,index:1,action:'select',takeId:'original',owner:'owner',revision:2});assert.equal(selectedTake(changed,1),'original');store.close();
});
test('legacy remains exportable and read-only; only explicit foundation contract bridge supports new inference',async()=>{
 const {store,job}=await fixture({...config,pipeline:CONTINUITY_PIPELINE});await assert.rejects(changePassage({store,id:job.id,index:1,owner:'owner',revision:0,generate:()=>{throw Error('must not run');}}),/frozen/);assert.ok((await recordingBlob(store,job,null,undefined,{createWorker:createNodeExportWorker})).blob.size);store.close();
 const manifest=currentManifest(config);manifest.source=previous.source;assertSupportedManifest({...config,renderManifest:manifest});
 manifest.source=structuredClone(previous.source);manifest.source.files['src/tts-worker.js']='a'.repeat(64);assert.throws(()=>assertSupportedManifest({...config,renderManifest:manifest}),/not supported/);
});
test('tampered selected PCM fails validation rather than exporting substituted audio',async()=>{
 const {store,job}=await fixture();const changed=await changePassage({store,id:job.id,index:1,owner:'owner',revision:0,generate:async()=>audio(job)});const take=await store.take(job.id,1,selectedTake(changed,1));
 await assert.rejects(validateCheckpoint({...store,take:async()=>({...take,audioHash:'0'.repeat(64)})},changed),/integrity/);store.close();
});
test('export freezes its selected take while a deferred read races undo',async()=>{
 const {store,job}=await fixture();const changed=await changePassage({store,id:job.id,index:1,owner:'owner',revision:0,generate:async()=>audio(job,.6)});
 const expected=await recordingBlob(store,changed,null,undefined,{createWorker:createNodeExportWorker}),gate=deferred(),started=deferred();
 const pending=recordingBlob({...store,take:async(...args)=>{started.resolve();await gate.promise;return store.take(...args);}},changed,null,undefined,{createWorker:createNodeExportWorker});await started.promise;
 await changePassage({store,id:job.id,action:'undo',owner:'owner',revision:1});gate.resolve();const result=await pending;assert.equal(result.takeRevision,1);assert.deepEqual(await result.blob.arrayBuffer(),await expected.blob.arrayBuffer());assert.equal(selectedTake(await store.job(job.id),1),'original');store.close();
});
test('cancellation during deferred Blob validation rejects without advancing selection; failed audio does not add a take',async()=>{
 const {store,job}=await fixture(),changed=await changePassage({store,id:job.id,index:1,owner:'owner',revision:0,generate:async()=>audio(job)}),take=await store.take(job.id,1,selectedTake(changed,1));
 const gate=deferred(),started=deferred(),controller=new AbortController();class DeferredBlob extends Blob{async arrayBuffer(){started.resolve();return gate.promise;}}
 const pending=validateTake(changed,{...take,blob:new DeferredBlob([await take.blob.arrayBuffer()])},{signal:controller.signal});await started.promise;controller.abort();await assert.rejects(pending,{name:'AbortError'});gate.resolve(await take.blob.arrayBuffer());
 await assert.rejects(changePassage({store,id:job.id,index:2,owner:'owner',revision:1,generate:async()=>({...audio(job),sampleRate:44100})}),/Invalid|format/);assert.equal((await store.takes(job.id)).length,1);assert.equal(takeRevision(await store.job(job.id)),1);store.close();
});
test('v1 database upgrade preserves original draft, recordings and byte-identical parts',async()=>{
 const name='v1-upgrade-'+crypto.randomUUID(),{store:source,job}=await fixture(),parts=await source.parts(job.id);source.close();
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('prefs');d.createObjectStore('jobs',{keyPath:'id'});d.createObjectStore('parts',{keyPath:['jobId','index']});d.createObjectStore('locks');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 await new Promise((resolve,reject)=>{const tx=db.transaction(['prefs','jobs','parts'],'readwrite');tx.objectStore('prefs').put({text:'Original private draft'},'draft');tx.objectStore('jobs').put(job);for(const p of parts)tx.objectStore('parts').put(p);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
 const store=await openStorage(indexedDB,name);assert.equal((await store.draft()).text,'Original private draft');assert.deepEqual(await store.job(job.id),job);assert.equal((await store.takes(job.id)).length,0);for(const [i,p] of (await validateCheckpoint(store,job)).entries())assert.deepEqual(await p.blob.arrayBuffer(),await parts[i].blob.arrayBuffer());store.close();
});
test('additional PCM budget rejects atomically and undo history remains bounded without deleting originals or takes',async()=>{
 const {store,job}=await fixture();let changed=job;
 const large=()=>{const a=audio(job);return {...a,bytes:new ArrayBuffer(6_000_000),sampleCount:3_000_000,seconds:125,metrics:{...a.metrics,outputAudioSeconds:125}};};
 for(const index of [0,0,1,1,2])changed=await changePassage({store,id:job.id,index,owner:'owner',revision:takeRevision(changed),generate:async()=>large()});
 const before=changed;await assert.rejects(changePassage({store,id:job.id,index:2,owner:'owner',revision:5,generate:async()=>large()}),/limit/);changed=await store.job(job.id);assert.equal(takeRevision(changed),5);assert.equal(changed.takeBytes,30_000_000);assert.deepEqual(changed.takeSelection,before.takeSelection);assert.equal((await store.takes(job.id)).length,5);
 const id=selectedTake(changed,2);for(let n=0;n<12;n++)changed=await changePassage({store,id:job.id,index:2,owner:'owner',revision:takeRevision(changed),action:'select',takeId:n%2?'original':id});
 assert.equal(changed.takeSelection.history.length,8);assert.equal((await store.parts(job.id)).length,3);assert.equal((await store.takes(job.id)).length,5);await store.deleteJob(job.id);assert.equal((await store.takes(job.id)).length,0);store.close();
});
test('podcast ZIP uses selected artifact duration for longer and shorter takes, freezes revisions, and exports after undo',async()=>{
 for(const [originalSeconds,replacementSeconds] of [[.1,1],[1,.1]]){
  const name='podcast-takes-'+crypto.randomUUID(),store=await openStorage(indexedDB,name);let job=await makeRecording('First original words.\n\nMiddle exact words.\n\nFinal original words.',config);await store.ensureJob(job);await store.claim('owner');
  const durationAudio=seconds=>{const a=audio(job);return {...a,bytes:quantizePcm(new Float32Array(Math.round(seconds*24000)).fill(.2)),sampleCount:Math.round(seconds*24000),seconds,metrics:{...a.metrics,outputAudioSeconds:seconds}};};
  while(job.next<job.passages.length)job=await store.commit(job.id,job.next,durationAudio(originalSeconds),'owner');await store.podcastGuid(job.id);job=await store.job(job.id);const originalDuration=job.seconds;
  const changed=await changePassage({store,id:job.id,index:1,owner:'owner',revision:0,generate:async()=>durationAudio(replacementSeconds)});
  const artifact=await recordingBlob(store,changed,null,undefined,{createWorker:createNodeExportWorker});assert.equal(changed.seconds,originalDuration);assert.ok(Math.abs(artifact.seconds-originalDuration)>.2);
  await assert.rejects(episodePackage(changed,artifact.blob,{}),/frozen/);await assert.rejects(episodePackage(changed,artifact.blob,{},{seconds:originalDuration,takeRevision:1}),/duration/);
  const result=await episodePackage(changed,artifact.blob,{},{seconds:artifact.seconds,takeRevision:artifact.takeRevision});const zip=await JSZip.loadAsync(await packageZip(result.files).arrayBuffer());const mp3=result.files.find(f=>f.name.endsWith('.mp3'));assert.deepEqual(await zip.file(mp3.name).async('uint8array'),new Uint8Array(await artifact.blob.arrayBuffer()));
  const restored=await changePassage({store,id:job.id,owner:'owner',revision:1,action:'undo'});assert.equal(restored.seconds,originalDuration);
  // An export begun before undo still packages its frozen old selection.
  await episodePackage(changed,artifact.blob,{},{seconds:artifact.seconds,takeRevision:1});await assert.rejects(episodePackage(restored,artifact.blob,{},{seconds:artifact.seconds,takeRevision:1}),/frozen/);
  const original=await recordingBlob(store,restored,null,undefined,{createWorker:createNodeExportWorker});const undone=await episodePackage(restored,original.blob,{},{seconds:original.seconds,takeRevision:original.takeRevision});assert.ok(packageZip(undone.files).size>0);assert.equal((await store.job(job.id)).seconds,originalDuration);store.close();
 }
});
