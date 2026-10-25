import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {openStorage} from '../src/storage.js';
import {makeRecording} from '../src/recording.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';
import {currentManifest,assertSupportedManifest} from '../src/render-provenance.js';
import archived from '../src/render-contract-23d62a8.json' with {type:'json'};
import {renderReport} from '../src/job-runner.js';
import {sha256Bytes} from '../src/asset-integrity.js';
import {validateCheckpoint} from '../src/job-runner.js';
import {syntheticPassage} from '../scripts/integration-fixture.mjs';
globalThis.IDBKeyRange=IDBKeyRange;
test('new frozen original checkpoints reject same-length PCM corruption',async()=>{
 const store=await openStorage(indexedDB,'pcm-integrity-'+crypto.randomUUID()),job=await makeRecording('Exact synthetic text.',{voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE});
 try{await store.ensureJob(job);await store.claim('fixture');const saved=await store.commit(job.id,0,await syntheticPassage({text:job.source,settings:job.settings,last:true}),'fixture'),parts=await store.parts(job.id),bytes=new Uint8Array(await parts[0].blob.arrayBuffer());bytes[0]^=1;
  await assert.rejects(validateCheckpoint({...store,parts:async()=>[{...parts[0],blob:new Blob([bytes])}]},saved),/integrity|checksum/);
 }finally{store.close();}
});
test('declared checksum policy cannot lose its hash or be removed without breaking frozen identity',async()=>{
 const store=await openStorage(indexedDB,'pcm-required-'+crypto.randomUUID()),job=await makeRecording('Exact checksum text.',{voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE});
 try{assert.equal(job.settings.renderManifest.checkpointIntegrity,'original-pcm-sha256-v1');await store.ensureJob(job);await store.claim('fixture');const saved=await store.commit(job.id,0,await syntheticPassage({text:job.source,settings:job.settings,last:true}),'fixture'),parts=await store.parts(job.id),missing={...parts[0]};delete missing.audioHash;await assert.rejects(validateCheckpoint({...store,parts:async()=>[missing]},saved),/integrity/);
 const changed=structuredClone(saved);delete changed.settings.renderManifest.checkpointIntegrity;await assert.rejects(validateCheckpoint(store,changed),/integrity/);
 }finally{store.close();}
});
test('historical manifests without checksums remain readable and explicitly labeled unknown',async()=>{
 const base={voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE},manifest=currentManifest(base);manifest.chunker={revision:'exact-offsets-240-v1',maxCharacters:240};manifest.source=archived.source;delete manifest.checkpointIntegrity;
 const store=await openStorage(indexedDB,'pcm-legacy-'+crypto.randomUUID()),job=await makeRecording('Historical source.',{...base,renderManifest:manifest});
 try{assertSupportedManifest(job.settings);await store.ensureJob(job);await store.claim('fixture');const saved=await store.commit(job.id,0,await syntheticPassage({text:job.source,settings:job.settings,last:true}),'fixture'),wrapper={...store,parts:async(...args)=>(await store.parts(...args)).map(part=>{delete part.audioHash;return part;})};assert.equal((await validateCheckpoint(wrapper,saved)).length,1);assert.equal((await renderReport(wrapper,saved)).checkpointIntegrity,'legacy-original-checksums-unrecorded');}
 finally{store.close();}
});
test('commit owns a byte snapshot before asynchronous hashing can yield to caller mutation',async()=>{
 const store=await openStorage(indexedDB,'pcm-owned-'+crypto.randomUUID()),job=await makeRecording('Immutable submitted PCM.',{voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE});try{await store.ensureJob(job);await store.claim('fixture');const audio=await syntheticPassage({text:job.source,settings:job.settings,last:true}),expected=await sha256Bytes(audio.bytes),pending=store.commit(job.id,0,audio,'fixture');new Uint8Array(audio.bytes).fill(0);await pending;const part=await store.part(job.id,0);assert.equal(part.audioHash,expected);assert.equal(await sha256Bytes(await part.blob.arrayBuffer()),expected);}finally{store.close();}
});
