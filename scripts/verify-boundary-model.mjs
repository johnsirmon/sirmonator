// Existing verified Kokoro cache only. No remote model or voice request allowed.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import catalog from '../src/render-assets.json' with {type:'json'};
import {KOKORO_REVISION,FOUNDATION_PIPELINE} from '../src/engine-specs.js';
import {makeRecording} from '../src/recording.js';
import {openStorage} from '../src/storage.js';
import {runRecording,recordingBlob,renderReport} from '../src/job-runner.js';
import {createSynthesisClient} from '../src/synthesis-client.js';
import {createNodeWorkerFactory} from './worker-node.mjs';
import {createNodeExportWorker} from './export-node.mjs';
import {parsePronunciation,spokenPassage} from '../src/pronunciation.js';
import {WORD_BOUNDARIES} from '../src/text-boundaries.js';
const hash=bytes=>createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
globalThis.IDBKeyRange=IDBKeyRange;
const cacheDir=resolve('.cache/foundation-models'),base='onnx-community/Kokoro-82M-v1.0-ONNX',verified=[];
for(const name of ['config.json','tokenizer.json','tokenizer_config.json','onnx/model_quantized.onnx','voices/af_sarah.bin']){const bytes=await readFile(resolve(cacheDir,base,KOKORO_REVISION,name)),expected=catalog.kokoro.files[name],digest=expected.sha256?hash(bytes):createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');assert.equal(digest,expected.sha256??expected.gitBlob);assert.equal(bytes.length,expected.size);verified.push({name,bytes:bytes.length,hash:digest});}
const factory=await createNodeWorkerFactory({offline:true,cacheDir}),client=createSynthesisClient({createWorker:()=>factory.createWorker()}),store=await openStorage(indexedDB,'boundary-real-'+crypto.randomUUID()),controller=new AbortController(),owner='boundary-real',inputs=[],source=('John reads the original words about hope and care. ').repeat(4)+'Café means café; e\u0301 stays in the reviewed text.';
let job=await makeRecording(source,{voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE,pronunciation:parsePronunciation('John => jon')},'Actual cached-model boundary sample');assert.equal(job.settings.renderManifest.chunker.revision,WORD_BOUNDARIES);await store.ensureJob(job);await store.claim(owner);const lease=setInterval(()=>store.renew(owner).catch(()=>{}),5000),timeout=setTimeout(()=>{controller.abort();client.cancel('Boundary sample deadline exceeded.');},120000);
try{job=await runRecording({store,id:job.id,owner,generate:async(text,settings,last)=>{assert.equal(controller.signal.aborted,false);const audio=await client.generate({text,settings,last},'kokoro:frozen');assert.equal(audio.spokenText,spokenPassage(text,settings.pronunciation).text);inputs.push({text,spokenText:audio.spokenText,last,seconds:audio.seconds,sampleCount:audio.sampleCount,sha256:hash(audio.bytes)});return audio;}});assert.equal(inputs.map(input=>input.text).join(''),source);assert.ok(inputs.length>=2);const artifact=await recordingBlob(store,job,null,undefined,{signal:controller.signal,createWorker:createNodeExportWorker}),bytes=new Uint8Array(await artifact.blob.arrayBuffer()),file=resolve('.cache/versioned-boundary-real.mp3');await writeFile(file,bytes);const decoded=spawnSync('ffmpeg',['-v','error','-i',file,'-f','null','-'],{encoding:'utf8',timeout:15000,windowsHide:true});assert.equal(decoded.error,undefined);assert.equal(decoded.status,0);const report={kind:'Actual production worker/client + cached verified Kokoro q8 Node CPU; fake-indexeddb; network disabled',source,inputs,verifiedLocalFiles:verified,workerSourceSHA256:factory.sourceSHA256,report:await renderReport(store,job),artifact:{file,bytes:bytes.length,sha256:hash(bytes),seconds:artifact.seconds,ffmpegDecode:'passed'},limitations:'No listening, ASR, word accuracy, browser inference or phone claim. Input reconstruction and decode do not establish acoustic correctness.'};await writeFile('evidence/versioned-boundaries-real-node.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,passages:inputs.length,boundaryPlanHash:job.boundaryPlanHash,bytes:bytes.length,seconds:artifact.seconds}));}
finally{clearTimeout(timeout);clearInterval(lease);client.cancel();await factory.waitForTerminations();await store.release(owner).catch(()=>{});store.close();}
