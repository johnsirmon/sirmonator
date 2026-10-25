// Explicit real-model check: existing pinned Kokoro files only, no network.
// Uses production worker/client/take/storage/export interfaces on Node CPU.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import catalog from '../src/render-assets.json' with {type:'json'};
import {FOUNDATION_PIPELINE,KOKORO_REVISION} from '../src/engine-specs.js';
import {makeRecording} from '../src/recording.js';
import {openStorage} from '../src/storage.js';
import {runRecording,recordingBlob,renderReport,validateCheckpoint} from '../src/job-runner.js';
import {changePassage} from '../src/passage-takes.js';
import {selectedTake} from '../src/take-selection.js';
import {createSynthesisClient} from '../src/synthesis-client.js';
import {createNodeWorkerFactory} from './worker-node.mjs';
import {createNodeExportWorker} from './export-node.mjs';
import {parsePronunciation,spokenPassage} from '../src/pronunciation.js';
const hash=bytes=>createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
globalThis.IDBKeyRange=IDBKeyRange;
const cacheDir=resolve('.cache/foundation-models'),base='onnx-community/Kokoro-82M-v1.0-ONNX',verified=[];
for(const name of ['config.json','tokenizer.json','tokenizer_config.json','onnx/model_quantized.onnx','voices/af_sarah.bin']){
 const bytes=await readFile(resolve(cacheDir,base,KOKORO_REVISION,name)),expected=catalog.kokoro.files[name];
 const digest=expected.sha256?hash(bytes):createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
 assert.equal(digest,expected.sha256??expected.gitBlob);assert.equal(bytes.length,expected.size);verified.push({name,bytes:bytes.length,hash:digest});
}
const factory=await createNodeWorkerFactory({offline:true,cacheDir}),client=createSynthesisClient({createWorker:()=>factory.createWorker()});
const store=await openStorage(indexedDB,'actual-takes-'+crypto.randomUUID()),owner='actual-takes';
const pronunciationMode=process.argv.includes('--pronunciation'),prefix=pronunciationMode?'pronunciation-real':'takes-real';
const source=pronunciationMode?'Paul arrived.\n\nPaul listened.\n\nPaul left.':'One exact sentence.\n\nTwo exact sentences.\n\nThree exact sentences.';
let job=await makeRecording(source,{voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE,...(pronunciationMode?{pronunciation:parsePronunciation('Paul => pawl')}: {})},'Actual passage takes check');
await store.ensureJob(job);await store.claim(owner);
const lease=setInterval(()=>store.renew(owner).catch(()=>{}),5000),controller=new AbortController();
const timeout=setTimeout(()=>{controller.abort();client.cancel('Verification deadline exceeded.');},120000);
const inputs=[],generate=async(text,settings,last)=>{const input={text,last,manifestHash:hash(new TextEncoder().encode(JSON.stringify(settings.renderManifest)))},audio=await client.generate({text,settings,last},'kokoro:frozen');input.resolvedText=audio.spokenText??text;assert.equal(input.resolvedText,spokenPassage(text,settings.pronunciation).text);inputs.push(input);return audio;};
const artifacts=[];
async function artifact(snapshot,label){
 const result=await recordingBlob(store,snapshot,null,undefined,{createWorker:createNodeExportWorker,signal:controller.signal}),bytes=new Uint8Array(await result.blob.arrayBuffer()),file=resolve('.cache/'+prefix+'-'+label+'.mp3');await writeFile(file,bytes);
 const decoded=spawnSync('ffmpeg',['-v','error','-i',file,'-f','null','-'],{encoding:'utf8',timeout:15000,windowsHide:true});
 if(decoded.error||decoded.status!==0)throw Error('FFmpeg decode failed: '+(decoded.error?.message??decoded.stderr));
 const item={label,file,sha256:hash(bytes),bytes:bytes.length,selectedSeconds:result.seconds,takeRevision:result.takeRevision,metrics:result.metrics,ffmpegDecode:'passed'};artifacts.push(item);return item;
}
try{
 job=await runRecording({store,id:job.id,owner,generate});assert.equal(job.passages.length,3);
 const originalParts=await store.parts(job.id),originalHashes=await Promise.all(originalParts.map(async p=>hash(await p.blob.arrayBuffer()))),original=await artifact(job,'original');
 console.log('Original real CPU passages and MP3 decode passed. Regenerating middle exact passage.');
 const changed=await changePassage({store,id:job.id,index:1,owner,revision:0,generate,signal:controller.signal}),parts=await validateCheckpoint(store,changed),take=await store.take(job.id,1,selectedTake(changed,1));
 assert.equal(changed.id,job.id);assert.equal(changed.source,source);assert.deepEqual(changed.settings,job.settings);assert.equal(changed.seconds,job.seconds);assert.equal(parts[1].takeId,take.takeId);assert.equal(take.audioHash,hash(await take.blob.arrayBuffer()));assert.equal(take.renderManifestHash,job.renderManifestHash);
 assert.equal(inputs[3].text,source.slice(job.passages[1].start,job.passages[1].end));assert.equal(inputs[3].last,false);assert.equal(inputs[3].manifestHash,job.renderManifestHash);
 if(pronunciationMode){assert.notEqual(inputs[3].resolvedText,inputs[3].text);assert.equal(take.spokenTextHash,hash(new TextEncoder().encode(inputs[3].resolvedText)));}
 const retainedHashes=await Promise.all((await store.parts(job.id)).map(async p=>hash(await p.blob.arrayBuffer())));assert.deepEqual(retainedHashes,originalHashes);
 await artifact(changed,'regenerated');
 const restored=await changePassage({store,id:job.id,owner,revision:1,action:'undo',signal:controller.signal});assert.equal(selectedTake(restored,1),'original');assert.equal((await store.takes(job.id)).length,1);
 const undone=await artifact(restored,'undo');assert.equal(undone.sha256,original.sha256);
 const report={kind:'Actual Kokoro production worker/client on Node CPU q8; fake-indexeddb storage API, real PCM/take/export logic; existing verified assets only; network disabled',source,verifiedLocalFiles:verified,workerSourceSHA256:factory.sourceSHA256,workerCreations:factory.creations,originalPartHashes:originalHashes,retainedOriginalHashes:retainedHashes,originalMiddleSHA256:originalHashes[1],regeneratedMiddleSHA256:take.audioHash,sameAudioBytes:take.audioHash===originalHashes[1],takeProvenance:{id:take.takeId,sourceSliceHash:take.sourceSliceHash,renderManifestHash:take.renderManifestHash,executedBuildSourceSha:take.executedBuildSourceSha,metrics:take.metrics},after:await renderReport(store,changed),undo:await renderReport(store,restored),artifacts,inputs,limitations:'Node CPU and fake-indexeddb, not browser inference/storage or subjective listening/word accuracy. Identical or different hashes do not prove acoustic quality. No speedup or long-form/phone claim.'};
 if(pronunciationMode)report.takeProvenance.spokenTextHash=take.spokenTextHash;
 await writeFile(pronunciationMode?'evidence/pronunciation-real-node.json':'evidence/passage-takes-real-node.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,pronunciationMode,workerCreations:factory.creations,originalHashesUnchanged:true,selectedTake:take.takeId,undoRestoredOriginalMp3:true,sameAudioBytes:report.sameAudioBytes,artifacts:artifacts.map(({label,sha256,bytes,selectedSeconds,ffmpegDecode})=>({label,sha256,bytes,selectedSeconds,ffmpegDecode})),metrics:take.metrics}));
}finally{clearTimeout(timeout);clearInterval(lease);client.cancel();await factory.waitForTerminations();await store.release(owner);store.close();}
