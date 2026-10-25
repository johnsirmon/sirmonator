import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodePcmParts} from '../src/continuity.js';
import {createChapterCache,chapterKey} from '../src/chapter-cache.js';
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
const pcm=blob=>({blob:blob??new Blob([new Uint8Array(8)]),format:'pcm-s16le',sampleCount:4,sampleRate:24000,channels:1});
for(const stage of ['blob','part','finish'])test(`abort during deferred ${stage} rejects immediately, terminates worker and discards late completion`,async()=>{
  const started=deferred(),gate=deferred(),controller=new AbortController(),messages=[];let terminated=false;
  const worker={terminate(){terminated=true;},postMessage(data){messages.push(data.type);if(data.type===stage){started.resolve();gate.promise.then(()=>this.onmessage({data:{id:data.id,type:data.type,ok:true,parts:[new Uint8Array([1])]}}));}else queueMicrotask(()=>this.onmessage({data:{id:data.id,type:data.type,ok:true}}));}};
  class DeferredBlob extends Blob{arrayBuffer(){started.resolve();return gate.promise;}}
  const part=pcm(stage==='blob'?new DeferredBlob([new Uint8Array(8)]):undefined);
  const result=encodePcmParts([part],24000,{signal:controller.signal,createWorker:()=>worker});
  await started.promise;controller.abort();await assert.rejects(result,{name:'AbortError'});assert.equal(terminated,true);
  gate.resolve(new ArrayBuffer(8));await Promise.resolve();assert.equal(messages.includes('finish'),stage==='finish');
});
test('stale state after final encoder response cannot publish an artifact',async()=>{
  let current=true,terminated=false;
  const worker={terminate(){terminated=true;},postMessage(data){queueMicrotask(()=>{if(data.type==='finish')current=false;this.onmessage({data:{id:data.id,type:data.type,ok:true,parts:[new Uint8Array([1])]}});});}};
  await assert.rejects(encodePcmParts([pcm()],24000,{isCurrent:()=>current,createWorker:()=>worker}),/cancelled/);assert.equal(terminated,true);
});
test('chapter preparation is shared before ended, reusable on revisit, and keyed to committed chapter snapshot',async()=>{
  const gates=new Map(),calls=[];
  const cache=createChapterCache({prepare:(job,chapter)=>{calls.push(chapter);const gate=deferred();gates.set(chapter,gate);return gate.promise;}});
  const job={id:'A',settings:{pipeline:'pcm-v2'},next:4,passages:[{chapter:0},{chapter:0},{chapter:1},{chapter:1}]};
  const current=cache.get(job,0);await Promise.resolve();gates.get(0).resolve({blob:new Blob(['current'])});await current;
  const ahead=cache.prefetch(job,1);await Promise.resolve();const ended=cache.get(job,1);assert.deepEqual(calls,[0,1]);
  gates.get(1).resolve({blob:new Blob(['next'])});await ahead;const next=await ended;assert.equal(await cache.get(job,1),next);assert.equal(await cache.get(job,0),await current);
  assert.equal(chapterKey(job,0),chapterKey({...job,next:3},0));assert.notEqual(chapterKey(job,1),chapterKey({...job,next:3},1));
  cache.clear();
});
test('navigation invalidation aborts deferred preparation and never caches a late result',async()=>{
  const gate=deferred();let signal;
  const cache=createChapterCache({prepare:(_job,_chapter,options)=>{signal=options.signal;return gate.promise;}});
  const job={id:'A',next:1,passages:[{chapter:0}],settings:{pipeline:'pcm'}};
  const old=cache.get(job,0);await Promise.resolve();cache.clear();assert.equal(signal.aborted,true);
  gate.resolve({blob:new Blob(['late'])});await assert.rejects(old,{name:'AbortError'});
});
test('cache byte budget evicts older chapters and never retains an oversized result',async()=>{
  let calls=0;const cache=createChapterCache({maxBytes:4,prepare:async()=>{calls++;return {blob:new Blob(['12345'])};}});
  const job={id:'A',next:1,passages:[{chapter:0}]};await cache.get(job,0);await cache.get(job,0);assert.equal(calls,2);
});
test('cache byte budget holds when chapter preparations finish out of order',async()=>{
  const gates=[deferred(),deferred()];let calls=0;
  const cache=createChapterCache({maxBytes:6,prepare:(_job,chapter)=>{calls++;return gates[chapter].promise;}});
  const job={id:'A',next:2,passages:[{chapter:0},{chapter:1}]};const first=cache.get(job,0),second=cache.get(job,1);
  await Promise.resolve();gates[1].resolve({blob:new Blob(['1234'])});await second;gates[0].resolve({blob:new Blob(['1234'])});await first;
  await cache.get(job,1);assert.equal(calls,3);cache.clear();
});
