import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {makeRecording} from '../src/recording.js';
import {openStorage} from '../src/storage.js';
import {renderReport} from '../src/job-runner.js';
import {CONTINUITY_PIPELINE,quantizePcm} from '../src/continuity.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';
import {renderMetrics} from '../src/render-metrics.js';
import {pcmReviewSummary} from '../src/pcm-review.js';
import {changePassage} from '../src/passage-takes.js';

globalThis.IDBKeyRange=IDBKeyRange;
const main=await readFile('src/main.js','utf8'),details=main.slice(main.indexOf('function renderDetails('),main.indexOf('function mediaControls('));
function display(job){const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{textContent:''});return nodes.get(id);};vm.runInNewContext(details+'\nrenderDetails(job);',{$,job,pcmReviewSummary,busy:()=>false});return $('render-performance').textContent;}
function audio(job,{known=false,renderMs=1000}={}){
 const samples=new Float32Array(2400).fill(.1),sampleRate=24000,runtime=known?{provider:'cpu',dtype:'q8',loadMs:200,inferenceMs:500,modelLoadAttempts:1,retries:0}:undefined;
 return {bytes:quantizePcm(samples),sampleCount:samples.length,sampleRate,channels:1,format:'pcm-s16le',seconds:.1,renderManifest:job.settings.renderManifest,metrics:renderMetrics({started:0,synthesized:renderMs,finished:renderMs+1,audio:{samples,sampleRate,runtime},outputSeconds:.1,format:'pcm-s16le',engine:'kokoro'})};
}
async function fixture(pipeline,text='Synthetic authored source.'){
 const store=await openStorage(indexedDB,'timing-'+crypto.randomUUID());let job=await makeRecording(text,{voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline});await store.ensureJob(job);await store.claim('fixture');return {store,job};
}
test('legacy nullable measurements stay unknown on screen rather than becoming a zero loading/inference claim',async()=>{
 const {store,job}=await fixture(CONTINUITY_PIPELINE);try{const output=audio(job),saved=await store.commit(job.id,0,output,'fixture'),report=await renderReport(store,saved);assert.equal(output.metrics.loadMs,null);assert.equal(report.performance.loadMs,null);assert.equal(report.performance.inferenceMs,null);assert.equal(saved.performance.loadMs,0);const text=display(saved);assert.doesNotMatch(text,/0\.00 s loading|0\.00 s engine calls/);assert.match(text,/legacy|Legacy/);assert.match(text,/does not establish|unrecorded|unknown/);assert.match(text,/1\.00 s render/);}finally{store.close();}
});
test('mixed legacy known/unknown parts do not present the known subset as a complete breakdown',async()=>{
 const {store,job}=await fixture(CONTINUITY_PIPELINE,'First paragraph.\n\nSecond paragraph.');try{assert.equal(job.passages.length,2);await store.commit(job.id,0,audio(job),'fixture');const saved=await store.commit(job.id,1,audio(job,{known:true}),'fixture'),report=await renderReport(store,saved);assert.equal(report.performance.loadMs,null);assert.equal(saved.performance.loadMs,200);assert.doesNotMatch(display(saved),/0\.20 s loading|0\.50 s engine calls/);assert.match(display(saved),/render report/i);}finally{store.close();}
});
test('frozen known measurements retain their actual breakdown and label original scope when a take is selected',async()=>{
 const {store,job}=await fixture(FOUNDATION_PIPELINE);try{const original=await store.commit(job.id,0,audio(job,{known:true}),'fixture');assert.match(display(original),/0\.20 s loading; 0\.50 s engine calls/);
 const selected=await changePassage({store,id:job.id,index:0,action:'regenerate',owner:'fixture',revision:0,generate:async()=>audio(job,{known:true,renderMs:5000})});const report=await renderReport(store,selected);assert.equal(report.performance.renderMs,5000);assert.equal(selected.performance.renderMs,1000);assert.match(display(selected),/Original passages/);assert.match(display(selected),/take.*render report|render report.*take/i);assert.equal(selected.source,job.source);
 }finally{store.close();}
});
