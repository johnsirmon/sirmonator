import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {sourceSnapshot} from '../scripts/update-render-catalog.mjs';
import catalog from '../src/render-assets.json' with {type:'json'};
import {FOUNDATION_PIPELINE,currentManifest,assertSupportedManifest} from '../src/render-provenance.js';
import {makeRecording} from '../src/recording.js';
import {openStorage} from '../src/storage.js';
import {renderReport,runRecording,validateCheckpoint,recordingBlob} from '../src/job-runner.js';
import {renderMetrics,validMetrics,metricsSummary} from '../src/render-metrics.js';
import {createSpeechRunner} from '../src/speech-runner.js';
import {quantizePcm,CONTINUITY_PIPELINE} from '../src/continuity.js';
import {createNodeExportWorker} from '../scripts/export-node.mjs';
globalThis.IDBKeyRange=IDBKeyRange;
const settings={voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE};
function audio(job){const samples=new Float32Array(2400).fill(.1),runtime={provider:'cpu',dtype:'q8',loadMs:2,inferenceMs:7,modelLoadAttempts:1,retries:0};return {bytes:quantizePcm(samples),sampleRate:24000,sampleCount:2400,channels:1,format:'pcm-s16le',seconds:.1,renderManifest:job.settings.renderManifest,metrics:renderMetrics({started:0,synthesized:10,finished:11,audio:{samples,sampleRate:24000,runtime},outputSeconds:.1,format:'pcm-s16le',engine:'kokoro'})};}
test('catalog rendering source and dependency fingerprints are current and voice assets match pinned metadata',async()=>{
 assert.deepEqual(await sourceSnapshot(),catalog.source);
 for(const [path,asset] of Object.entries(catalog.kokoro.files).filter(([path])=>path.startsWith('voices/'))){
  const bytes=await readFile('node_modules/kokoro-js/'+path);
  assert.equal(bytes.length,asset.size);assert.equal(await (await import('../src/asset-integrity.js')).sha256Bytes(bytes),asset.sha256);
 }
});
test('all engine manifests freeze truthful inputs, source offsets stay exact, and new identities differ from legacy',async()=>{
 for(const voice of ['af_sarah','st-m1','prime']){
  const config={...settings,voice},manifest=currentManifest(config);
  assert.match(manifest.model.revision,/^[a-f0-9]{40}$/);assert.equal(manifest.voice.id,voice);assert.equal(manifest.packages['kokoro-js'].version,'1.2.1');
  const source=('Keep e\u0301 and every original word.\r\n\r\n').repeat(12),job=await makeRecording(source,config),legacy=await makeRecording(source,{...config,pipeline:CONTINUITY_PIPELINE});
  assert.notEqual(job.id,legacy.id);assert.equal((await makeRecording(source,job.settings)).id,job.id);
  assert.equal(job.passages.map(p=>source.slice(p.start,p.end)).join(''),source);assertSupportedManifest(job.settings);
 }
});
test('metrics distinguish loading, reuse, fallback and PCM-deferred encoding without changing runner results',async()=>{
 let clock=0;const observations=[],result={samples:new Float32Array(2400),sampleRate:24000};
 const run=createSpeechRunner({initialProvider:'webgpu',now:()=>clock,onMetrics:m=>observations.push(m),load:async provider=>{clock+=2;return provider;},infer:async provider=>{clock+=3;if(provider==='webgpu')throw Error('GPU lost');return result;}});
 assert.equal(await run({text:'Exact words.'}),result);assert.equal(await run({text:'Exact words.'}),result);
 assert.deepEqual(observations[0],{loadMs:4,inferenceMs:6,modelLoadAttempts:2,retries:1,provider:'wasm'});
 assert.deepEqual(observations[1],{loadMs:0,inferenceMs:3,modelLoadAttempts:0,retries:0,provider:'wasm'});
 const m=audio({settings:{renderManifest:{}}}).metrics;assert.ok(validMetrics(m));assert.equal(m.encoding,'deferred-to-artifact');assert.equal(m.encodingMs,0);
 assert.equal(validMetrics({...m,totalMs:NaN}),false);assert.equal(metricsSummary([{metrics:m},{}]).missing,1);
});
test('manifest and metrics commit atomically, survive reopen, and produce a durable report and separate export timing',async()=>{
 const name='foundation-'+crypto.randomUUID();let store=await openStorage(indexedDB,name),job=await makeRecording('An authored synthetic sentence.',settings);
 await store.ensureJob(job);await store.claim('owner');
 for(const damaged of [{...audio(job),metrics:undefined},{...audio(job),renderManifest:{}},{...audio(job),metrics:{...audio(job).metrics,totalMs:NaN}}])await assert.rejects(store.commit(job.id,0,damaged,'owner'),/provenance|measurements/);
 assert.equal((await store.job(job.id)).next,0);await store.commit(job.id,0,audio(job),'owner');store.close();
 store=await openStorage(indexedDB,name);job=await store.job(job.id);await validateCheckpoint(store,job);
 let report=await renderReport(store,job);assert.equal(report.performance.measured,1);assert.equal(report.passages[0].renderManifestHash,job.renderManifestHash);assert.equal(report.passages[0].metrics.provider,'cpu');
 const result=await recordingBlob(store,job,null,undefined,{createWorker:createNodeExportWorker});assert.ok(result.metrics.encodingMs>=0);assert.equal(result.metrics.inputSamples,2400);assert.equal(result.metrics.bytes,result.blob.size);
 assert.equal(result.metricsPersisted,true);
 const quota=await recordingBlob({...store,savePreparation:async()=>{throw new DOMException('No telemetry quota','QuotaExceededError');}},job,null,undefined,{createWorker:createNodeExportWorker});assert.ok(quota.blob.size>0);assert.equal(quota.metricsPersisted,false);
 job=await store.job(job.id);report=await renderReport(store,job);assert.equal(report.preparations.length,1);assert.equal(report.preparations[0].metrics.phase,'single-artifact-mp3');store.close();
});
test('historical frozen inputs remain exportable, but unsupported resumes reject before synthesis',async()=>{
 const store=await openStorage(indexedDB,'historical-'+crypto.randomUUID()),manifest=currentManifest(settings);manifest.source.sha256='b'.repeat(64);
 const source='First authored paragraph.\n\nSecond authored paragraph.',job=await makeRecording(source,{...settings,renderManifest:manifest});
 await store.ensureJob(job);await store.claim('owner');const partial=await store.commit(job.id,0,audio(job),'owner');let calls=0;
 await assert.rejects(runRecording({store,id:job.id,owner:'owner',generate:()=>{calls++;return audio(job);}}),/not supported/);assert.equal(calls,0);
 const result=await recordingBlob(store,partial,null,undefined,{createWorker:createNodeExportWorker});assert.ok(result.blob.size>0);
 await assert.rejects(validateCheckpoint(store,{...partial,renderManifestHash:'changed'}),/integrity/);store.close();
});
test('legacy report never invents historical model provenance or timing',async()=>{
 const store=await openStorage(indexedDB,'legacy-report-'+crypto.randomUUID()),job=await makeRecording('Original legacy words.',{...settings,pipeline:CONTINUITY_PIPELINE});
 const output=audio(job);delete output.metrics;delete output.renderManifest;await store.ensureJob(job);await store.claim('owner');const saved=await store.commit(job.id,0,output,'owner');
 const report=await renderReport(store,saved);assert.match(report.provenance,/unrecorded/);assert.equal(report.performance.measured,0);assert.equal(report.renderManifestHash,null);store.close();
});
