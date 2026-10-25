import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {writeFile} from 'node:fs/promises';
import {seedDeployed,snapshotWorker} from './deployed-compatibility-fixture.mjs';
import {openStorage} from '../src/storage.js';
import {recordingBlob,renderReport} from '../src/job-runner.js';
import {LEGACY_PIPELINE,CONTINUITY_PIPELINE} from '../src/continuity.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';
import {sha256Bytes} from '../src/asset-integrity.js';
import {createNodeExportWorker} from './export-node.mjs';
import {check} from './resilience-scenario.mjs';
globalThis.IDBKeyRange=IDBKeyRange;
const rows=[];let manifest;
for(const pipeline of [LEGACY_PIPELINE,CONTINUITY_PIPELINE,FOUNDATION_PIPELINE]){
 const name='compatibility-evidence-'+crypto.randomUUID(),fixture=await seedDeployed({factory:indexedDB,name,pipeline,keepOpen:true});manifest=fixture.old.manifest;
 const previous=await fixture.old.runner.recordingBlob({...fixture.store,savePreparation:undefined},fixture.job,null,undefined,{createWorker:snapshotWorker(fixture.old.root)}),oldHash=await sha256Bytes(await previous.blob.arrayBuffer());fixture.store.close();const store=await openStorage(indexedDB,name);
 try{const restored=await store.job(fixture.job.id),artifact=await recordingBlob({...store,savePreparation:undefined},restored,null,undefined,{createWorker:createNodeExportWorker}),newHash=await sha256Bytes(await artifact.blob.arrayBuffer()),report=await renderReport(store,restored),draftPreserved=JSON.stringify(await store.draft())===JSON.stringify(fixture.draft);check(oldHash===newHash&&draftPreserved,'Compatibility comparison failed');rows.push({pipeline,oldSchema:1,newSchema:2,recordingId:restored.id,sourceHash:restored.sourceHash,parts:restored.next,seconds:artifact.seconds,mp3Bytes:artifact.blob.size,oldMp3Sha256:oldHash,newMp3Sha256:newHash,identical:true,draftPreserved,checkpointIntegrity:report.checkpointIntegrity,provenance:report.provenance});}finally{store.close();}
}
await writeFile('evidence/deployed-compatibility-snapshot.json',JSON.stringify(manifest,null,2)+'\n');const report={schema:1,baseline:manifest.commit,kind:'Actual old code/schema + latest readers/codec; fake-indexeddb; procedural CC0 PCM/MP3, no model',rows,limits:'Byte-identical procedural encoding is not inference compatibility or acoustic accuracy. Native-browser evidence is separate; c2f5cbb predates review/reference side databases.'};await writeFile('evidence/deployed-compatibility-matrix.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
