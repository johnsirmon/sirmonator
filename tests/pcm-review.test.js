import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {createPcmReviewStats,validPcmReview,pcmReviewSummary,withPcmReviewReport} from '../src/pcm-review.js';
import {quantizePcm} from '../src/continuity.js';
import {makeRecording} from '../src/recording.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';
import {openStorage} from '../src/storage.js';
import {recordingBlob,renderReport} from '../src/job-runner.js';
import {renderMetrics} from '../src/render-metrics.js';
import {createNodeExportWorker} from '../scripts/export-node.mjs';
import {createNodeReviewExportWorker} from '../scripts/review-export-node.mjs';

globalThis.IDBKeyRange=IDBKeyRange;
const rate=24000,tone=seconds=>Float32Array.from({length:rate*seconds},(_,i)=>.5*Math.sin(2*Math.PI*440*i/rate));
test('streaming tone statistics preserve samples across uneven chunks with bounded scalar metadata',()=>{
 const samples=tone(1),before=samples.slice(),acc=createPcmReviewStats({sampleRate:rate,domain:'float32'});acc.addFloat32(samples.subarray(0,7001));acc.addFloat32(samples.subarray(7001));const result=acc.finish();
 assert.equal(result.sampleCount,rate);assert.equal(result.seconds,1);assert.ok(Math.abs(result.peak-.5)<.001);assert.ok(Math.abs(result.rms-Math.SQRT1_2*.5)<.001);assert.equal(result.nonFiniteSamples,0);assert.deepEqual(result.reviewHints,[]);assert.ok(validPcmReview(result));assert.deepEqual(samples,before);assert.ok(JSON.stringify(result).length<2000);
});
test('silence and deliberate pauses are measurements and review hints, never omitted-word or sound-quality verdicts',()=>{
 const silent=createPcmReviewStats({sampleRate:rate});silent.addPcm16(quantizePcm(new Float32Array(rate*2)));silent.addPcm16(quantizePcm(new Float32Array(rate*2)));const result=silent.finish();assert.equal(result.longestQuietSeconds,4);assert.equal(result.allNearSilence,true);assert.equal(result.rms,0);assert.ok(result.reviewHints.includes('long-quiet-span-may-be-intentional'));assert.equal(result.includesIntentionalPauses,true);
 const paused=createPcmReviewStats({sampleRate:rate});paused.addPcm16(quantizePcm(tone(1)));paused.addPcm16(quantizePcm(new Float32Array(Math.round(rate*.744))));const output=paused.finish();assert.equal(output.sampleCount,rate+Math.round(rate*.744));assert.equal(output.longQuietSpan,false);assert.equal(output.allNearSilence,false);assert.deepEqual(output.reviewHints,[]);assert.match(pcmReviewSummary(result),/Includes deliberate pauses; not a word or sound-quality check/);
});
test('raw nonfinite/over-range inputs are counted without correction; PCM16 cannot invent prequantization evidence',()=>{
 const samples=new Float32Array([-1.2,1.1,1,-1,NaN,Infinity,0]),before=samples.slice(),acc=createPcmReviewStats({sampleRate:rate,domain:'float32'});acc.addFloat32(samples);const result=acc.finish();assert.equal(result.nonFiniteSamples,2);assert.equal(result.rawFloatNonFiniteSamples,2);assert.equal(result.outOfRangeSamples,2);assert.equal(result.nearFullScaleSamples,4);assert.ok(Number.isFinite(result.rms));assert.ok(validPcmReview(result));assert.deepEqual(samples,before);
 const quantized=createPcmReviewStats({sampleRate:rate});quantized.addPcm16(quantizePcm(new Float32Array([-1,1,0])));const saved=quantized.finish();assert.equal(saved.rawFloatNonFiniteSamples,null);assert.equal(saved.nonFiniteSamples,0);assert.equal(saved.outOfRangeSamples,0);assert.equal(saved.nearFullScaleSamples,2);assert.match(saved.note,/cannot detect non-finite or over-range values before quantization/);
});
test('empty and malformed diagnostic inputs cannot fabricate measured speech',()=>{
 const acc=createPcmReviewStats({sampleRate:rate});assert.equal(acc.finish().allNearSilence,false);assert.equal(acc.finish().peak,null);assert.throws(()=>acc.addPcm16(new ArrayBuffer(3)),/Invalid/);assert.throws(()=>createPcmReviewStats({sampleRate:1}));assert.equal(validPcmReview({schema:2}),false);assert.match(pcmReviewSummary(null),/not measured/);
});
test('report diagnostics mark historical or stale artifacts not measured and retain chapter scope',()=>{
 const acc=createPcmReviewStats({sampleRate:rate});acc.addPcm16(quantizePcm(tone(1)));const diag=acc.finish(),report={passages:[{}],takeSelection:{revision:0},preparations:[]};assert.equal(withPcmReviewReport(report).pcmReview.status,'not-measured');
 const preparation={chapter:2,through:1,takeRevision:0,metrics:{pcmReview:diag}};report.preparations.push(preparation);const measured=withPcmReviewReport(report);assert.equal(measured.pcmReview.status,'measured-artifacts');assert.equal(measured.pcmReview.artifacts[0].chapter,2);assert.match(measured.pcmReview.scope,/do not claim to cover the entire recording/);assert.equal(withPcmReviewReport({...report,takeSelection:{revision:1}}).pcmReview.status,'not-measured');assert.equal(withPcmReviewReport({...report,passages:[{},{}]}).pcmReview.status,'not-measured');assert.equal(report.pcmReview,undefined);
});

async function fixture(samples=tone(1)){
 const name='pcm-review-'+crypto.randomUUID(),store=await openStorage(indexedDB,name),settings={voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE};let job=await makeRecording('Procedural synthetic source.',settings);await store.ensureJob(job);await store.claim('fixture');const seconds=samples.length/rate,metrics=renderMetrics({started:0,synthesized:10,finished:11,audio:{samples,sampleRate:rate,runtime:{provider:'cpu',dtype:'synthetic',loadMs:2,inferenceMs:7,modelLoadAttempts:1,retries:0}},outputSeconds:seconds,format:'pcm-s16le',engine:'kokoro'});job=await store.commit(job.id,0,{bytes:quantizePcm(samples),sampleRate:rate,sampleCount:samples.length,channels:1,format:'pcm-s16le',seconds,metrics,renderManifest:job.settings.renderManifest},'fixture');return {store,job,name};
}
test('production codec wrapper preserves MP3 bytes and original hashes while optional metadata survives reopening',async()=>{
 const f=await fixture();let store=f.store;const before=await store.part(f.job.id,0),original=await before.blob.arrayBuffer();
 const baseline=await recordingBlob(store,f.job,null,undefined,{createWorker:createNodeExportWorker}),reviewed=await recordingBlob(store,f.job,null,undefined,{createWorker:createNodeReviewExportWorker});assert.deepEqual(new Uint8Array(await reviewed.blob.arrayBuffer()),new Uint8Array(await baseline.blob.arrayBuffer()));assert.equal(reviewed.metrics.pcmReview.sampleCount,rate);assert.equal(reviewed.metrics.pcmReview.domain,'pcm-s16le');assert.equal(reviewed.metricsPersisted,true);
 store.close();store=await openStorage(indexedDB,f.name);const job=await store.job(f.job.id),part=await store.part(job.id,0),report=withPcmReviewReport(await renderReport(store,job));assert.equal(part.audioHash,before.audioHash);assert.deepEqual(new Uint8Array(await part.blob.arrayBuffer()),new Uint8Array(original));assert.equal(report.pcmReview.status,'measured-artifacts');assert.equal(report.pcmReview.artifacts[0].diagnostics.schema,1);assert.ok(job.preparations.length<=4);store.close();
});
test('diagnostic calculation failure and optional metadata quota failure cannot block unchanged silent audio',async()=>{
 const {store,job}=await fixture(new Float32Array(rate));try{
  const baseline=await recordingBlob(store,job,null,undefined,{createWorker:createNodeExportWorker});
  for(const phase of ['start','part','finish']){const failed=await recordingBlob(store,job,null,undefined,{createWorker:()=>createNodeReviewExportWorker({failDiagnostics:phase})});assert.equal(failed.metrics.pcmReview.status,'unavailable');assert.deepEqual(new Uint8Array(await failed.blob.arrayBuffer()),new Uint8Array(await baseline.blob.arrayBuffer()));}
  const quota=await recordingBlob({...store,savePreparation:async()=>{throw new DOMException('Synthetic optional quota','QuotaExceededError');}},job,null,undefined,{createWorker:createNodeReviewExportWorker});assert.equal(quota.metricsPersisted,false);assert.equal(quota.metrics.pcmReview.allNearSilence,true);assert.ok(quota.blob.size>0);assert.deepEqual(new Uint8Array(await quota.blob.arrayBuffer()),new Uint8Array(await baseline.blob.arrayBuffer()));assert.equal((await store.job(job.id)).next,1);
 }finally{store.close();}
});
test('actual app preparation selects the diagnostic worker while preserving caller cancellation options',async()=>{
 const main=await readFile('src/main.js','utf8'),line=main.split('\n').find(line=>line.startsWith('function recordingBlob('));assert.ok(line.includes("'./mp3-review-worker.js'"));let captured;const signal=new AbortController().signal;
 const context=vm.createContext({signal,encodeRecordingBlob:(...args)=>captured=args,customWorker(){}});vm.runInContext(line.replaceAll('import.meta.url',"'https://example.invalid/app.js'")+'\nrecordingBlob({}, {}, 2, 1024, {signal,createWorker:customWorker});',context);assert.equal(captured[2],2);assert.equal(captured[3],1024);assert.equal(captured[4].createWorker,context.customWorker);assert.equal(captured[4].signal,signal);
 assert.match(main,/JSON\.stringify\(withPcmReviewReport\(report\),null,2\)/);assert.match(main,/pcmReviewSummary\(preparation\?\.pcmReview\)/);assert.equal(signal.aborted,false);
});
