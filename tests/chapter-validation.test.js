import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackPreparation,recordingBlob,validateCheckpoint} from '../src/job-runner.js';
import {createChapterCache,chapterKey} from '../src/chapter-cache.js';
import {createNodeExportWorker} from '../scripts/export-node.mjs';
import {chapterFixture} from '../scripts/chapter-benchmark-fixture.mjs';
import {abortable} from '../src/continuity.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
function cacheFor(fixture,extra={}){
 let background;const cache=createChapterCache({prepare:(job,chapter,options)=>recordingBlob(fixture.store,job,chapter,undefined,{...options,createWorker:createNodeExportWorker}),...extra}),prefetch=cache.prefetch;
 cache.prefetch=(...args)=>{background=prefetch(...args);return background;};return {cache,get background(){return background;}};
}
test('current plus next chapter use one validated immutable checkpoint and match independent encodes',async()=>{
 const f=await chapterFixture(300),pair=cacheFor(f),operation=await createPlaybackPreparation(f.store,f.job);
 assert.ok(Object.isFrozen(operation.job));assert.ok(Object.isFrozen(operation.job.takeSelection.selected));
 const result=await operation.prepare(pair.cache,0),next=await pair.background;assert.equal(f.reads.parts,1);assert.equal(f.reads.partRows,300);assert.equal(f.reads.take,f.takes.size);
 for(const [chapter,value] of [[0,result],[1,next]]){const direct=await recordingBlob(f.store,f.job,chapter,undefined,{createWorker:createNodeExportWorker});assert.deepEqual(await value.blob.arrayBuffer(),await direct.blob.arrayBuffer());assert.equal(value.seconds,direct.seconds);}
 await assert.rejects(operation.prepare(pair.cache,0),/already consumed/);pair.cache.clear();
});
test('cached compressed audio never skips a fresh corruption or selected-take check',async()=>{
 const f=await chapterFixture(160),pair=cacheFor(f);await(await createPlaybackPreparation(f.store,f.job)).prepare(pair.cache,0);await pair.background;
 const take=f.takes.get('synthetic-0');take.audioHash='0'.repeat(64);
 await assert.rejects(createPlaybackPreparation(f.store,f.job),/integrity/);take.audioHash='a'.repeat(64);
 const broken={...f.store,parts:async(id,n)=>{const rows=await f.store.parts(id,n);rows[0].spokenTextHash='0'.repeat(64);return rows;}};
 await assert.rejects(createPlaybackPreparation(broken,f.job),/integrity/);pair.cache.clear();
});
test('private preparation capability expires after bounded prefetch and cannot be replayed',async()=>{
 const f=await chapterFixture(160),captured=[],pair=cacheFor(f,{prepare:(job,chapter,options)=>{captured.push({job,options});return recordingBlob(f.store,job,chapter,undefined,{...options,createWorker:createNodeExportWorker});}});
 await(await createPlaybackPreparation(f.store,f.job)).prepare(pair.cache,0);await pair.background;await tick();
 for(const capture of captured)await assert.rejects(recordingBlob(f.store,capture.job,0,undefined,capture.options),/expired/);pair.cache.clear();
});
test('cross-tab take revision change leaves the first operation immutable and changes the next cache key',async()=>{
 const f=await chapterFixture(160),pair=cacheFor(f),old=await createPlaybackPreparation(f.store,f.job),key=chapterKey(old.job,0),take=f.takes.get('synthetic-0');
 f.job.takeSelection={schema:1,revision:2,selected:{},history:[]};
 const first=await old.prepare(pair.cache,0);await pair.background;const fresh=await createPlaybackPreparation(f.store,f.job);assert.notEqual(chapterKey(fresh.job,0),key);
 const second=await fresh.prepare(pair.cache,0);await pair.background;assert.notDeepEqual(await first.blob.arrayBuffer(),await second.blob.arrayBuffer());assert.notEqual(first.seconds,second.seconds);assert.equal(old.job.takeSelection.revision,1);assert.ok(take);pair.cache.clear();
});
test('growing recording validates its committed prefix afresh and invalidates the growing chapter',async()=>{
 const f=await chapterFixture(160);delete f.job.takeSelection;f.job.next=159;const pair=cacheFor(f),before=await createPlaybackPreparation(f.store,f.job),chapter=f.job.passages[158].chapter,key=chapterKey(before.job,chapter),first=await before.prepare(pair.cache,chapter);
 f.job.next=160;const after=await createPlaybackPreparation(f.store,f.job);assert.notEqual(chapterKey(after.job,chapter),key);const second=await after.prepare(pair.cache,chapter);assert.ok(second.seconds>first.seconds);assert.equal(f.reads.parts,2);pair.cache.clear();
});
test('cancellation during deferred checkpoint reads prevents take reads and preparation',async()=>{
 const f=await chapterFixture(160),gate=deferred(),entered=deferred(),controller=new AbortController();
 const pending=createPlaybackPreparation({...f.store,parts:async()=>{entered.resolve();await gate.promise;return f.parts;}},f.job,{signal:controller.signal});await entered.promise;controller.abort();await assert.rejects(pending,{name:'AbortError'});gate.resolve();await tick();assert.equal(f.reads.take,0);
});
test('concurrent preparation scopes cannot dispose another consumer of a pending cache artifact',async()=>{
 const f=await chapterFixture(160),gate=deferred(),entered=deferred(),controller=new AbortController();let once=true;
 const pair=cacheFor(f,{prepare:async(job,chapter,options)=>{if(once){once=false;entered.resolve();await gate.promise;}return recordingBlob(f.store,job,chapter,undefined,{...options,createWorker:createNodeExportWorker});}});
 const a=await createPlaybackPreparation(f.store,f.job),b=await createPlaybackPreparation(f.store,f.job),first=a.prepare(pair.cache,0,{signal:controller.signal});await entered.promise;
 const second=b.prepare(pair.cache,0);controller.abort();await assert.rejects(first,{name:'AbortError'});gate.resolve();assert.ok((await second).blob.size);await pair.background;pair.cache.clear();assert.equal(f.reads.parts,2);
});
test('cache eviction aborts an in-flight operation without publishing, and next operation revalidates',async()=>{
 const f=await chapterFixture(300),gate=deferred(),entered=deferred();let first=true;
 const pair=cacheFor(f,{maxEntries:1,prepare:async(job,chapter,options)=>{if(first){first=false;entered.resolve();await abortable(gate.promise,options.signal);}return recordingBlob(f.store,job,chapter,undefined,{...options,createWorker:createNodeExportWorker});}});
 const old=await createPlaybackPreparation(f.store,f.job),pending=old.prepare(pair.cache,0);await entered.promise;pair.cache.clear();await assert.rejects(pending,{name:'AbortError'});gate.resolve();
 const fresh=await createPlaybackPreparation(f.store,f.job);assert.ok((await fresh.prepare(pair.cache,1)).blob.size);await pair.background;assert.equal(f.reads.parts,2);pair.cache.clear();
});
