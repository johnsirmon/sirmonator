import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {openStorage} from '../src/storage.js';
import {openReviewStorage} from '../src/review-storage.js';
import {makeRecording} from '../src/recording.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';
import {parsePronunciation,spokenPassage} from '../src/pronunciation.js';
import {runRecording,recordingBlob,validateCheckpoint} from '../src/job-runner.js';
import {changePassage} from '../src/passage-takes.js';
import {captureReview,compareTranscript} from '../src/speech-review.js';
import {createSynthesisClient} from '../src/synthesis-client.js';
import {createSyntheticWorker,INTEGRATION_SOURCE,syntheticPassage} from '../scripts/integration-fixture.mjs';
import {createNodeExportWorker} from '../scripts/export-node.mjs';
globalThis.IDBKeyRange=IDBKeyRange;
test('combined synthetic create, pause/resume, take/undo, manual review, reload, stale selection and export',async()=>{
 const name='combined-'+crypto.randomUUID(),reviewName=name+'-reviews',owner='fixture',inputs=[];
 let store=await openStorage(indexedDB,name),reviews=await openReviewStorage(indexedDB,reviewName),job=await makeRecording(INTEGRATION_SOURCE,{voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE,pronunciation:parsePronunciation('Paul => pawl')},'SIMULATION combined integration');
 const client=createSynthesisClient({createWorker:()=>createSyntheticWorker({onInput:data=>inputs.push(data)})}),generate=(text,settings,last)=>client.generate({text,settings,last},'synthetic');
 try{
  await store.ensureJob(job);await store.claim(owner);let pause=false;job=await runRecording({store,id:job.id,owner,generate,shouldPause:()=>pause,onSaved(){pause=true;}});assert.equal(job.next,1);
  job=await runRecording({store,id:job.id,owner,generate});assert.equal(job.next,3);assert.equal(inputs.map(x=>x.text).join(''),INTEGRATION_SOURCE);for(const part of await validateCheckpoint(store,job))assert.ok(part.spokenTextHash);
  const original=await recordingBlob(store,job,null,undefined,{createWorker:createNodeExportWorker});
  const changed=await changePassage({store,id:job.id,index:1,owner,revision:0,generate});assert.equal(changed.takeSelection.revision,1);const selectedId=changed.takeSelection.selected[1];assert.ok(selectedId);assert.equal(inputs[3].text,job.source.slice(job.passages[1].start,job.passages[1].end));
  const undo=await changePassage({store,id:job.id,owner,revision:1,action:'undo'});assert.equal(undo.takeSelection.revision,2);assert.equal(undo.takeSelection.selected[1],undefined);
  const snapshot=await captureReview(store,job.id,1),comparison=await compareTranscript(snapshot,'pawl');assert.ok(comparison.findings.length);assert.equal(snapshot.spoken,spokenPassage(snapshot.source,job.settings.pronunciation).text);
  await reviews.save({schema:1,snapshot,comparison,transcript:'pawl',notes:'Synthetic manual comparison, not listening proof.',noWordsHeard:false,listenedByUser:false,automaticTranscription:false,audioVerified:false});
  store.close();reviews.close();store=await openStorage(indexedDB,name);reviews=await openReviewStorage(indexedDB,reviewName);job=await store.job(job.id);assert.equal(job.source,INTEGRATION_SOURCE);assert.equal(job.takeSelection.revision,2);assert.equal((await reviews.load(snapshot)).audioVerified,false);
  const undone=await recordingBlob(store,job,null,undefined,{createWorker:createNodeExportWorker});assert.deepEqual(await undone.blob.arrayBuffer(),await original.blob.arrayBuffer());
  await store.claim(owner);const fresh=await changePassage({store,id:job.id,index:1,takeId:selectedId,action:'select',owner,revision:2}),latest=await captureReview(store,job.id,1);assert.notEqual(latest.key,snapshot.key);assert.equal(await reviews.load(latest),null);
  const controller=new AbortController();controller.abort();await assert.rejects(recordingBlob(store,fresh,null,undefined,{createWorker:createNodeExportWorker,signal:controller.signal}),{name:'AbortError'});assert.equal((await store.job(job.id)).takeSelection.revision,3);
 }finally{client.cancel();await store.release(owner).catch(()=>{});store.close();reviews.close();}
});
test('synthetic preview uses actual MP3 encoding while declaring no model inference',async()=>{
 const job=await makeRecording('Paul listened.',{voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE,pronunciation:parsePronunciation('Paul => pawl')}),audio=await syntheticPassage({text:job.source,settings:job.settings,last:true,preview:true});assert.ok(audio.bytes.byteLength>0);assert.equal(audio.metrics.provider,'none');assert.match(audio.metrics.fixture,/no model inference/);assert.equal(audio.spokenText,'pawl listened.');
});
