import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {openStorage} from '../src/storage.js';
import {validateCheckpoint,recordingBlob,renderReport,runRecording} from '../src/job-runner.js';
import {LEGACY_PIPELINE,CONTINUITY_PIPELINE} from '../src/continuity.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';
import {sha256Bytes} from '../src/asset-integrity.js';
import {seedDeployed,snapshotWorker} from '../scripts/deployed-compatibility-fixture.mjs';
import {createNodeExportWorker} from '../scripts/export-node.mjs';
import {openReviewStorage} from '../src/review-storage.js';
import {captureReview} from '../src/speech-review.js';
import {openReferenceStorage} from '../src/reference-storage.js';
import {prepareReference} from '../src/reference-provider.js';
import {encodeWav} from '../src/core.js';

globalThis.IDBKeyRange=IDBKeyRange;
const unique=kind=>'deployed-'+kind+'-'+crypto.randomUUID();
const hash=async blob=>sha256Bytes(await blob.arrayBuffer());
const rawOpen=(name,version)=>new Promise((resolve,reject)=>{const request=indexedDB.open(name,version);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const untouched=async(store,fixture)=>{assert.equal((await store.job(fixture.job.id)).source,fixture.job.source);assert.deepEqual(await store.draft(),fixture.draft);const parts=await store.parts(fixture.job.id);assert.equal(parts.length,fixture.parts.length);for(let i=0;i<parts.length;i++)assert.equal(await hash(parts[i].blob),await hash(fixture.parts[i].blob));};

for(const pipeline of [LEGACY_PIPELINE,CONTINUITY_PIPELINE,FOUNDATION_PIPELINE])test('actual c2f5cbb v1 '+pipeline+' upgrades with identical artifact/source/draft and honest legacy labeling',async()=>{
 const name=unique(pipeline),fixture=await seedDeployed({factory:indexedDB,name,pipeline,keepOpen:true}),oldArtifact=await fixture.old.runner.recordingBlob({...fixture.store,savePreparation:undefined},fixture.job,null,undefined,{createWorker:snapshotWorker(fixture.old.root)});fixture.store.close();const store=await openStorage(indexedDB,name);
 try{await untouched(store,fixture);assert.equal((await store.takes(fixture.job.id)).length,0);const restored=await store.job(fixture.job.id),parts=await validateCheckpoint(store,restored);assert.equal(parts.length,restored.next);const latest=await recordingBlob({...store,savePreparation:undefined},restored,null,undefined,{createWorker:createNodeExportWorker});assert.equal(await hash(latest.blob),await hash(oldArtifact.blob));assert.equal(latest.seconds,oldArtifact.seconds);const report=await renderReport(store,restored);assert.equal(report.checkpointIntegrity,'legacy-original-checksums-unrecorded');assert.equal(report.provenance,pipeline===FOUNDATION_PIPELINE?'frozen-render-inputs':'legacy-historical-model-and-voice-revision-unrecorded');assert.ok(parts.every(p=>p.audioHash===undefined));await untouched(store,fixture);
 }finally{store.close();}
});
test('actual deployed partial foundation resumes supported frozen inputs without repeating old passages',async()=>{
 const name=unique('resume'),fixture=await seedDeployed({factory:indexedDB,name,pipeline:FOUNDATION_PIPELINE,partial:true}),store=await openStorage(indexedDB,name),seen=[];
 try{const resumed=await runRecording({store,id:fixture.job.id,owner:fixture.owner,generate:async(...args)=>{seen.push(args[0]);return fixture.generate(...args);}});assert.equal(resumed.next,resumed.passages.length);assert.equal(seen.join(''),resumed.source.slice(resumed.passages[1].start));assert.equal(await hash((await store.part(resumed.id,0)).blob),await hash(fixture.parts[0].blob));assert.deepEqual(await store.draft(),fixture.draft);assert.equal((await validateCheckpoint(store,resumed)).length,resumed.next);
 }finally{store.close();}
});
test('unsupported deployed frozen partial rejects inference before generating while saved prefix exports unchanged',async()=>{
 const name=unique('unsupported'),fixture=await seedDeployed({factory:indexedDB,name,pipeline:FOUNDATION_PIPELINE,partial:true,unsupported:true}),store=await openStorage(indexedDB,name);let generated=0;
 try{await assert.rejects(runRecording({store,id:fixture.job.id,owner:fixture.owner,generate:async()=>{generated++;}}),/not supported/);assert.equal(generated,0);await recordingBlob(store,fixture.job,null,undefined,{createWorker:createNodeExportWorker});assert.equal((await store.job(fixture.job.id)).next,1);await untouched(store,fixture);
 }finally{store.close();}
});
function faultFactory(beforeUpgrade,afterUpgrade){return {open(name,version){const request=indexedDB.open(name,version);return new Proxy(request,{get:(target,key)=>Reflect.get(target,key,target),set(target,key,value){Reflect.set(target,key,key==='onupgradeneeded'?event=>{beforeUpgrade?.(request);value(event);afterUpgrade?.(request);}:value,target);return true;}});}};}
for(const mode of ['abort-during-upgrade','failure-after-store-created'])test('actual deployed upgrade '+mode+' rolls back and explicit retry preserves v1 data',async()=>{
 const name=unique(mode),fixture=await seedDeployed({factory:indexedDB,name,pipeline:FOUNDATION_PIPELINE}),controller=new AbortController(),factory=mode==='abort-during-upgrade'?faultFactory(()=>controller.abort()):faultFactory(null,request=>request.transaction.abort());
 await assert.rejects(openStorage(factory,name,{signal:controller.signal}),{name:mode==='abort-during-upgrade'?'AbortError':'StorageOpenError'});const old=await rawOpen(name,1);assert.equal(old.version,1);assert.equal(old.objectStoreNames.contains('takes'),false);old.close();const store=await openStorage(indexedDB,name);try{await untouched(store,fixture);assert.equal((await store.takes(fixture.job.id)).length,0);}finally{store.close();}
});
test('old open app connection closes on versionchange; blocked abandoned upgrade cannot overwrite a later retry',async()=>{
 const name=unique('tabs'),fixture=await seedDeployed({factory:indexedDB,name,pipeline:FOUNDATION_PIPELINE,keepOpen:true}),store=await openStorage(indexedDB,name);try{await assert.rejects(fixture.store.draft());await untouched(store,fixture);}finally{fixture.store.close();store.close();}
 const blockedName=unique('blocked'),other=await seedDeployed({factory:indexedDB,name:blockedName,pipeline:CONTINUITY_PIPELINE}),blocker=await rawOpen(blockedName,1),states=[];await assert.rejects(openStorage(indexedDB,blockedName,{onState:s=>states.push(s.state)}),{name:'StorageBlockedError'});assert.ok(states.includes('blocked'));blocker.close();const retry=await openStorage(indexedDB,blockedName);try{await untouched(retry,other);}finally{retry.close();}
});
test('malformed deployed checkpoint rejects publication without changing stored rows; old missing hashes remain unknown',async()=>{
 const name=unique('corrupt'),fixture=await seedDeployed({factory:indexedDB,name,pipeline:CONTINUITY_PIPELINE}),store=await openStorage(indexedDB,name);let created=0;
 try{const bad={...store,parts:async()=>fixture.parts.map((part,index)=>index?part:{...part,blob:new Blob([new Uint8Array(3)])})};await assert.rejects(recordingBlob(bad,fixture.job,null,undefined,{createWorker:()=>{created++;throw Error('must not encode');}}),/integrity/);assert.equal(created,0);const textCorrupt={...fixture.job,passages:fixture.job.passages.map((p,i)=>i?{...p,start:p.start+1}:p)};await assert.rejects(validateCheckpoint(store,textCorrupt),/integrity/);await untouched(store,fixture);
  const bytes=new Uint8Array(await fixture.parts[0].blob.arrayBuffer());bytes[0]^=1;const historicalUnknown={...store,parts:async()=>fixture.parts.map((p,i)=>i?p:{...p,blob:new Blob([bytes])})};assert.equal((await validateCheckpoint(historicalUnknown,fixture.job)).length,fixture.parts.length);assert.equal((await renderReport(historicalUnknown,fixture.job)).checkpointIntegrity,'legacy-original-checksums-unrecorded');
 }finally{store.close();}
});
test('independent review/reference metadata survives recordings v1 upgrade without raw reference audio persistence',async()=>{
 const name=unique('side-metadata'),fixture=await seedDeployed({factory:indexedDB,name,pipeline:FOUNDATION_PIPELINE,keepOpen:true}),reviewName=name+'-reviews',referenceName=name+'-reference',snapshot=await captureReview(fixture.store,fixture.job.id,0),payload={schema:1,method:'manual-review-v1',snapshot,transcript:'',noWordsHeard:false,listenedByUser:false,notes:'Synthetic compatibility review retained.',comparison:null,automaticTranscription:false,audioVerified:false,savedAt:Date.now()};let reviews=await openReviewStorage(indexedDB,reviewName),references=await openReferenceStorage(indexedDB,referenceName);
 await reviews.save(payload);const wav=encodeWav([Float32Array.from({length:72000},(_,i)=>.1*Math.sin(i*.1))]),receipt=await prepareReference({size:wav.byteLength,arrayBuffer:async()=>wav},{label:'Procedural compatibility fixture',authority:'synthetic',scope:'Compatibility tests only',provenance:'Procedural CC0 sine; no person or speech',permission:true,aiDisclosure:true}),savedReference=await references.save(receipt,0);reviews.close();references.close();fixture.store.close();
 const store=await openStorage(indexedDB,name);reviews=await openReviewStorage(indexedDB,reviewName);references=await openReferenceStorage(indexedDB,referenceName);
 try{await untouched(store,fixture);assert.deepEqual(await reviews.load(snapshot),payload);assert.deepEqual(await references.load(),savedReference);assert.equal(JSON.stringify(savedReference).includes('audioStored'),false);assert.ok(!('audio' in savedReference.receipt)&&!('embedding' in savedReference.receipt));assert.equal((await references.revoke(savedReference.version)).receipt.state,'revoked');assert.deepEqual(await reviews.load(snapshot),payload);
 }finally{store.close();reviews.close();references.close();}
});
