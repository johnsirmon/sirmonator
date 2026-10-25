import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {openStorage} from '../src/storage.js';
import {makeRecording} from '../src/recording.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';
import {resilienceAudio} from '../scripts/resilience-scenario.mjs';
import {changePassage} from '../src/passage-takes.js';
import {browserStorageEstimate,storageEstimateText,usageAnchor} from '../src/storage-usage.js';
import {assertSupportedManifest} from '../src/render-provenance.js';
import catalog from '../src/render-assets.json' with {type:'json'};
import {readFile} from 'node:fs/promises';
import {scanRecordingUsage} from '../src/storage-usage.js';
import {recordingBlob} from '../src/job-runner.js';
import {createNodeExportWorker} from '../scripts/export-node.mjs';
globalThis.IDBKeyRange=IDBKeyRange;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
async function fixture(factory=indexedDB){const name='usage-'+crypto.randomUUID(),store=await openStorage(factory,name),job=await makeRecording('Original first passage.\n\nOriginal next passage.\n\nLast passage.',{voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE});await store.ensureJob(job);await store.claim('fixture');let saved=job;for(let i=0;i<job.passages.length;i++)saved=await store.commit(job.id,i,resilienceAudio(job,i),'fixture');return {name,store,job:saved};}
test('one read-only snapshot counts original/take Blob payloads and serialized metadata with zero audio reads',async()=>{
 const {store,job}=await fixture();try{const changed=await changePassage({store,id:job.id,index:1,owner:'fixture',revision:0,generate:async()=>resilienceAudio(job,1,{sampleCount:123})}),rows=[await store.job(job.id),...await store.parts(job.id),...await store.takes(job.id)],expectedMetadata=rows.reduce((n,row)=>n+new TextEncoder().encode(JSON.stringify(row,(key,value)=>value instanceof Blob?undefined:value)).length,0),native=Blob.prototype.arrayBuffer;let calls=0;
  try{Blob.prototype.arrayBuffer=function(){calls++;throw Error('Must not read audio for sizes');};const summary=await store.usage(job.id);assert.equal(summary.originalBytes,3*96*2);assert.equal(summary.alternativeBytes,123*2);assert.equal(summary.originalRows,3);assert.equal(summary.alternativeRows,1);assert.equal(summary.metadataJsonBytes,expectedMetadata);assert.equal(summary.metadataComplete,true);assert.equal(summary.scanComplete,true);assert.equal(summary.requests,3);assert.equal(summary.anchor,usageAnchor(changed));assert.equal(calls,0);}finally{Blob.prototype.arrayBuffer=native;}
  assert.equal((await store.job(job.id)).takeSelection.revision,1);assert.equal((await store.parts(job.id)).length,3);
 }finally{store.close();}
});
test('row/metadata limits produce explicitly incomplete measurements without writing',async()=>{
 const {store,job}=await fixture();try{const before=await store.job(job.id),limited=await store.usage(job.id,{rowLimit:2});assert.equal(limited.rowsFetched,2);assert.equal(limited.scanComplete,false);assert.equal(limited.originalBytes,384);const metadata=await store.usage(job.id,{metadataUnits:0});assert.equal(metadata.metadataComplete,false);assert.equal(metadata.scanComplete,true);assert.equal(metadata.originalRows,3);assert.deepEqual(await store.job(job.id),before);assert.equal((await store.parts(job.id)).length,3);}finally{store.close();}
});
test('mid-flight cancellation after a batch is queued aborts the read transaction and leaves audio exportable',async()=>{
 const controller=new AbortController();let armed=false;const factory={open(...args){const request=indexedDB.open(...args);request.addEventListener('success',()=>{const db=request.result,native=db.transaction.bind(db);db.transaction=(...args)=>{const tx=native(...args),object=tx.objectStore.bind(tx);tx.objectStore=name=>{const store=object(name);if(armed&&name==='parts'){const get=store.getAll.bind(store);store.getAll=(...args)=>{const result=get(...args);queueMicrotask(()=>controller.abort());return result;};}return store;};return tx;};});return request;}},fixtureValue=await fixture(factory),{store,job}=fixtureValue;
 try{armed=true;await assert.rejects(store.usage(job.id,{signal:controller.signal}),{name:'AbortError'});armed=false;assert.equal((await store.usage(job.id)).originalRows,3);assert.equal((await store.job(job.id)).next,3);assert.ok((await recordingBlob({...store,savePreparation:undefined},job,null,undefined,{createWorker:createNodeExportWorker})).blob.size>0);}finally{store.close();}
});
test('nonresponsive readonly request times out, aborts once and ignores late completion',async()=>{
 let tx,aborts=0;const db={transaction(){tx={objectStore:()=>({get:()=>({})}),abort(){aborts++;}};return tx;}};await assert.rejects(scanRecordingUsage(db,'synthetic',{timeoutMs:5}),{name:'StorageUsageTimeoutError'});assert.equal(aborts,1);tx.oncomplete();assert.equal(aborts,1);
});
test('optional browser estimates handle unsupported/rejected/stalled/cancelled APIs without false readiness or success guarantees',async()=>{
 for(const estimate of [()=>undefined,()=>Promise.reject(Error('unsupported')),()=>({usage:-1,quota:100}),()=>({usage:10,quota:NaN})])assert.equal(await browserStorageEstimate({estimate}),null);
 const delayed=deferred();assert.equal(await browserStorageEstimate({estimate:()=>delayed.promise,timeoutMs:5}),null);delayed.resolve({usage:1,quota:2});const value=await browserStorageEstimate({estimate:async()=>({usage:1024,quota:4096})});assert.deepEqual(value,{usage:1024,quota:4096});assert.match(storageEstimateText(value),/shared origin.*Approximate.*not device memory or a guarantee/);assert.match(storageEstimateText(null),/unavailable/);
 const controller=new AbortController(),pending=browserStorageEstimate({estimate:()=>new Promise(()=>{}),signal:controller.signal});controller.abort();await assert.rejects(pending,{name:'AbortError'});
});
test('reviewed Word recordings remain supported across storage-only changes with exact boundary/renderer pins',async()=>{
 const report=JSON.parse(await readFile('evidence/versioned-boundaries-real-node.json','utf8')),job=await makeRecording(report.source,report.report.settings);assert.equal(job.id,report.report.recordingId);assert.equal(job.boundaryPlanHash,report.report.boundaryPlanHash);assertSupportedManifest(job.settings);const previous=catalog.source.files['src/text-boundaries.js'];try{catalog.source.files['src/text-boundaries.js']='f'.repeat(64);assert.throws(()=>assertSupportedManifest(job.settings),/not supported/);}finally{catalog.source.files['src/text-boundaries.js']=previous;}
});
