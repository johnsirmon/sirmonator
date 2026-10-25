import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createSynthesisClient} from '../src/synthesis-client.js';
import {createSpeechRunner} from '../src/speech-runner.js';
import {normalizeSettings} from '../src/recording.js';
import {FOUNDATION_PIPELINE,assertSupportedManifest} from '../src/render-provenance.js';
import {getVoice} from '../src/voices.js';
import {characterVoice} from '../src/character-settings.js';
import {quantizePcm,LEGACY_PIPELINE,CONTINUITY_PIPELINE,isPcmPipeline} from '../src/continuity.js';
import {renderMetrics,validFrozenMetrics} from '../src/render-metrics.js';
import {characterEffect,pauseAfter} from '../src/audio-effects.js';
import {spokenPassage} from '../src/pronunciation.js';
import {assertEngineRequest} from '../src/engine-capabilities.js';
import {LEGACY_BOUNDARIES} from '../src/text-boundaries.js';

// Execute production worker orchestration. Replace only module loading and the
// actual model/provider with deterministic stubs; no ONNX runtime is loaded.
const original=await readFile('src/tts-worker.js','utf8');
const adaptations=[
 ["await Promise.all([import('kokoro-js'),import('@huggingface/transformers')])",'await loadDependencies()'],
 ["(await import('./pinned-kokoro.js')).loadPinnedKokoro(options)",'loadPinned(options)'],
 ["(await import('./pocket-engine.js'))",'pocketModule'],
 ["(await import('./supertonic-engine.js'))",'supertonicModule'],
 ["await import(/* @vite-ignore */ new URL(encoderPath,import.meta.url).href)",'await loadEncoder()'],
];
let source=original.replace(/^import [^\n]+\r?\n/gm,'');
for(const [from,to] of adaptations){assert.ok(source.includes(from),'Worker injection point remains explicit: '+from);source=source.replace(from,to);}
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
const config=(voice='af_sarah',extra={})=>normalizeSettings({voice,edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE,...extra});
const request=(settings,text='Exact source.\r\n')=>({text,settings,last:true});
const family=settings=>getVoice(settings.voice).engine+':'+(settings.pipeline===FOUNDATION_PIPELINE?'frozen':'legacy');

function harness({blockLoadWorker=null}={}){
 const workers=[],timers=new Map(),gate=deferred(),loadEntered=deferred();let timerId=0;
 const client=createSynthesisClient({createWorker(){
  const id=workers.length,stats={loads:0,pinnedLoads:0,legacyLoads:0,inferences:[],responses:[],tasks:[]},worker={stats,messages:[],terminated:0,terminate(){this.terminated++;},postMessage(data){this.messages.push(structuredClone(data));stats.tasks.push(context.self.onmessage({data}));},late(data){this.onmessage({data});}};workers.push(worker);
  let clock=0;const now=()=>++clock;
  const model={generate:async(text,settings)=>{stats.inferences.push({text,...settings});return {audio:new Float32Array([.1,-.2,.3,0]),sampling_rate:24000};}};
  const load=async options=>{stats.loads++;if(id===blockLoadWorker){loadEntered.resolve();await gate.promise;}options.progress_callback?.({status:'progress',file:'synthetic-model',progress:100});return model;};
  const stubEngine=async(text,voice,speed)=>{stats.inferences.push({text,voice,speed});return {samples:new Float32Array([.1,-.2,.3,0]),sampleRate:24000,runtime:{provider:'wasm',dtype:'stub',loadMs:0,inferenceMs:0,modelLoadAttempts:0,retries:0}};};
  const context=vm.createContext({self:{postMessage:data=>{stats.responses.push(data);worker.onmessage?.({data});}},performance:{now},navigator:{},getVoice,characterVoice,quantizePcm,LEGACY_PIPELINE,CONTINUITY_PIPELINE,isPcmPipeline,FOUNDATION_PIPELINE,assertSupportedManifest,renderMetrics,characterEffect,pauseAfter,spokenPassage,assertEngineRequest,createSpeechRunner:options=>createSpeechRunner({...options,now}),loadDependencies:async()=>[{KokoroTTS:{from_pretrained:(_repo,options)=>{stats.legacyLoads++;return load(options);}}},{env:{backends:{onnx:{wasm:{}}}}}],loadPinned:options=>{stats.pinnedLoads++;return load(options);},pocketModule:{pocket:stubEngine},supertonicModule:{supertonic:stubEngine}});
  vm.runInContext(source,context);return worker;
 },setTimer:fn=>{timers.set(++timerId,fn);return timerId;},clearTimer:id=>timers.delete(id)});
 async function pair(settings=config()){
  const before=workers.length,a=request(settings),first=await client.generate(a,family(settings)),worker=workers.at(-1),secondSettings=config('af_kore'),second=await client.generate(request(secondSettings,'Second source.'),family(secondSettings));
  assert.equal(workers.at(-1),worker);assert.ok(workers.length<=before+1);assert.equal(first.format,'pcm-s16le');assert.equal(second.format,'pcm-s16le');assert.deepEqual(first.renderManifest,settings.renderManifest);assert.deepEqual(second.renderManifest,secondSettings.renderManifest);assert.ok(validFrozenMetrics(first.metrics,'kokoro'));assert.ok(validFrozenMetrics(second.metrics,'kokoro'));assert.equal(second.metrics.modelLoadAttempts,0);return worker;
 }
 return {client,workers,timers,pair,gate,loadEntered};
}

test('Stop during model initialization ignores late ready/result/error and permits two consecutive warm retry passages',async()=>{
 const h=harness({blockLoadWorker:1});await h.pair();h.client.cancel();const settings=config(),pending=h.client.generate(request(settings),family(settings));await h.loadEntered.promise;const old=h.workers[1];h.client.cancel();await assert.rejects(pending,/cancelled/);assert.equal(old.terminated,1);
 const fresh=await h.pair();h.gate.resolve();await Promise.all(old.stats.tasks);
 for(const type of ['ready','result','passage','error'])old.late({type,requestId:old.messages[0].requestId,message:'late cancelled failure',bytes:new ArrayBuffer(0)});
 assert.equal(fresh.terminated,0);assert.equal(h.workers.length,3);await h.pair();assert.equal(h.workers.length,3);h.client.cancel();
});
test('warm voice/policy changes preserve per-request provenance and exact input while incompatible manifests reject before inference',async()=>{
 const h=harness(),worker=await h.pair(),legacy=config('af_sarah');legacy.renderManifest.chunker={revision:LEGACY_BOUNDARIES,maxCharacters:240};
 const output=await h.client.generate(request(legacy,'Legacy source.'),family(legacy));assert.equal(output.renderManifest.chunker.revision,LEGACY_BOUNDARIES);assert.equal(output.metrics.modelLoadAttempts,0);
 const unsupported=config();unsupported.renderManifest.model.revision='f'.repeat(40);const inferenceCount=worker.stats.inferences.length;
 await assert.rejects(h.client.generate(request(unsupported),family(unsupported)),/not supported/);assert.equal(worker.stats.inferences.length,inferenceCount);assert.equal(worker.terminated,1);
 const replacement=await h.pair();assert.notEqual(replacement,worker);assert.equal(replacement.stats.loads,1);assert.equal(worker.stats.loads,1);assert.equal(worker.stats.inferences[0].text,'Exact source.\r\n');h.client.cancel();
});
test('engine-family switches release old sessions and returning to Kokoro supports two warm passages',async()=>{
 const h=harness(),first=await h.pair();
 for(const voice of ['st-m1','prime']){const settings=config(voice),output=await h.client.generate(request(settings),family(settings));assert.equal(output.renderManifest.engine,getVoice(voice).engine);assert.equal(h.workers.at(-2).terminated,1);}
 const final=await h.pair();assert.notEqual(first,final);assert.equal(final.stats.loads,1);assert.equal(h.workers.filter(w=>!w.terminated).length,1);h.client.cancel();
});
test('stale idle disposal cannot terminate a resumed versioned request and actual expiry permits two warm retries',async()=>{
 const h=harness(),worker=await h.pair(),stale=[...h.timers.values()][0],settings=config(),pending=h.client.generate(request(settings),family(settings));stale();assert.equal(worker.terminated,0);await pending;await h.pair();assert.equal(h.workers.length,1);
 [...h.timers.values()][0]();assert.equal(worker.terminated,1);const replacement=await h.pair();assert.notEqual(replacement,worker);assert.equal(h.workers.length,2);h.client.cancel();
});
test('frozen and legacy Kokoro loaders never share a warm worker across pipeline switches',async()=>{
 const h=harness(),frozen=await h.pair(),legacy=config('af_sarah',{pipeline:CONTINUITY_PIPELINE});
 for(let i=0;i<2;i++){const output=await h.client.generate(request(legacy,'Legacy exact source.'),family(legacy));assert.equal(output.format,'pcm-s16le');assert.equal(output.renderManifest,undefined);}
 const old=h.workers.at(-1);assert.equal(frozen.terminated,1);assert.equal(old.stats.legacyLoads,1);assert.equal(old.stats.pinnedLoads,0);
 const fresh=await h.pair();assert.equal(old.terminated,1);assert.equal(fresh.stats.pinnedLoads,1);assert.equal(fresh.stats.legacyLoads,0);assert.equal(h.workers.filter(w=>!w.terminated).length,1);h.client.cancel();
});
