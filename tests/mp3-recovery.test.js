import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {encodePcmParts,MP3_REQUEST_TIMEOUT_MS,abortable,assertActive} from '../src/continuity.js';
import {showPreparationProgress} from '../src/preparation-progress.js';
import {createNodeExportWorker} from '../scripts/export-node.mjs';
import {chapterFixture} from '../scripts/chapter-benchmark-fixture.mjs';
import {recordingBlob} from '../src/job-runner.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
const part=blob=>({blob:blob??new Blob([new Uint8Array(8)]),sampleRate:24000,sampleCount:4,channels:1,format:'pcm-s16le'});
function clock(){let time=0,id=0;const tasks=new Map();return {now:()=>time,setTimeout:(fn,ms)=>{tasks.set(++id,{fn,at:time+ms});return id;},clearTimeout:key=>tasks.delete(key),advance(ms){time+=ms;for(const [key,task] of [...tasks])if(task.at<=time){tasks.delete(key);task.fn();}},get size(){return tasks.size;}};}
const reply=(worker,data,extra={})=>worker.onmessage({data:{id:data.id,type:data.type,ok:true,...(data.type==='finish'?{parts:[new Uint8Array([1,2,3])]}:{}),...extra}});
for(const stage of ['start','read','part','finish'])test(`stalled ${stage} times out once and clears timers, worker and partial result`,async()=>{
 const timer=clock(),entered=deferred(),late=deferred(),updates=[];let terminated=0,savedRequest;
 const worker={terminate(){terminated++;},postMessage(data){if(data.type===stage){savedRequest=data;entered.resolve();}else queueMicrotask(()=>reply(this,data));}};
 class StalledBlob extends Blob{arrayBuffer(){entered.resolve();return late.promise;}}
 const source=part(stage==='read'?new StalledBlob([new Uint8Array(8)]):undefined),pending=encodePcmParts([source],24000,{timers:timer,now:timer.now,createWorker:()=>worker,onProgress:p=>updates.push(p)});
 await entered.promise;assert.equal(timer.size,1);timer.advance(MP3_REQUEST_TIMEOUT_MS+1);
 await assert.rejects(pending,error=>error.name==='Mp3PreparationTimeoutError'&&/Saved passages and selected takes were not changed/.test(error.message));
 assert.equal(terminated,1);assert.equal(timer.size,0);assert.equal(updates.at(-1).phase,'failed');assert.equal(updates.some(p=>p.phase==='complete'),false);
 assert.equal(updates.at(-1).completedParts,stage==='finish'?1:0);
 if(savedRequest)reply(worker,savedRequest);late.resolve(new ArrayBuffer(8));await tick();assert.equal(terminated,1);assert.equal(timer.size,0);
});
for(const kind of ['send','messageerror','workererror','bad-id','bad-ack'])test(`${kind} settles preparation and permits no successful output`,async()=>{
 const timer=clock(),updates=[];let terminated=0;
 const worker={terminate(){terminated++;},postMessage(data){if(kind==='send')throw Error('Synthetic send failed');queueMicrotask(()=>{if(kind==='messageerror')this.onmessageerror({});else if(kind==='workererror')this.onerror({message:'Synthetic worker failed'});else reply(this,data,kind==='bad-id'?{id:-1}:{ok:false});});}};
 await assert.rejects(encodePcmParts([part()],24000,{createWorker:()=>worker,timers:timer,onProgress:p=>updates.push(p)}),/Retry preparation/);assert.equal(terminated,1);assert.equal(timer.size,0);assert.equal(updates.at(-1).phase,'failed');
});
test('worker failure while a saved Blob read is pending also settles that read',async()=>{
 const started=deferred(),late=deferred(),timer=clock();let terminated=0;
 class WaitingBlob extends Blob{arrayBuffer(){started.resolve();return late.promise;}}
 const worker={terminate(){terminated++;},postMessage(data){queueMicrotask(()=>reply(this,data));}};
 const pending=encodePcmParts([part(new WaitingBlob([new Uint8Array(8)]))],24000,{createWorker:()=>worker,timers:timer});await started.promise;worker.onmessageerror({});await assert.rejects(pending,/could not be read/);late.resolve(new ArrayBuffer(8));await tick();assert.equal(terminated,1);assert.equal(timer.size,0);
});
test('abort removes watchdog and late acknowledgements cannot increment progress',async()=>{
 const entered=deferred(),controller=new AbortController(),timer=clock(),updates=[];let sent,terminated=0;
 const worker={terminate(){terminated++;},postMessage(data){sent=data;entered.resolve();}};
 const pending=encodePcmParts([part()],24000,{signal:controller.signal,createWorker:()=>worker,timers:timer,onProgress:p=>updates.push(p)});await entered.promise;controller.abort();await assert.rejects(pending,{name:'AbortError'});const length=updates.length;reply(worker,sent);timer.advance(MP3_REQUEST_TIMEOUT_MS+1);assert.equal(updates.length,length);assert.equal(updates.at(-1).phase,'cancelled');assert.equal(timer.size,0);assert.equal(terminated,1);
});
test('progress counts acknowledged nonempty parts and distinguishes finalization',async()=>{
 const timer=clock(),entered=deferred(),gate=deferred(),updates=[];let pendingPart,acks=0;
 const worker={terminate(){},postMessage(data){if(data.type==='part'){acks++;if(acks===1){pendingPart=data;entered.resolve();return;}}queueMicrotask(()=>reply(this,data));}};
 const empty={...part(new Blob([])),sampleCount:0},pending=encodePcmParts([part(),empty,part()],24000,{createWorker:()=>worker,timers:timer,now:timer.now,onProgress:p=>updates.push(p)});
 await entered.promise;assert.equal(updates.at(-1).completedParts,0);assert.equal(updates.at(-1).totalParts,2);timer.advance(250);reply(worker,pendingPart);await pending;
 assert.deepEqual(updates.map(p=>[p.phase,p.completedParts]),[['starting',0],['encoding',0],['encoding',1],['finalizing',2],['complete',2]]);assert.equal(updates.at(-1).completedSamples,8);assert.equal(timer.size,0);
});
test('fast preparations produce bounded status updates, and observer errors do not break audio',async()=>{
 const timer=clock(),updates=[],worker={terminate(){},postMessage(data){queueMicrotask(()=>reply(this,data));}};
 const result=await encodePcmParts(Array.from({length:500},()=>part()),24000,{createWorker:()=>worker,timers:timer,now:timer.now,onProgress:p=>{updates.push(p);if(p.phase==='encoding')throw Error('Observer failed');}});
 assert.equal(result.size,3);assert.equal(updates.length,4);assert.equal(updates.at(-1).completedParts,500);assert.equal(timer.size,0);
});
test('retry uses unchanged checkpoint/take selection and produces identical MP3 bytes and duration',async()=>{
 const fixture=await chapterFixture(160),before=JSON.stringify(fixture.job),expected=await recordingBlob(fixture.store,fixture.job,0,undefined,{createWorker:createNodeExportWorker});
 await assert.rejects(recordingBlob(fixture.store,fixture.job,0,undefined,{createWorker:()=>({terminate(){},postMessage(){throw Error('Synthetic failure');}})}),/Retry preparation/);
 assert.equal(JSON.stringify(fixture.job),before);const retried=await recordingBlob(fixture.store,fixture.job,0,undefined,{createWorker:createNodeExportWorker});assert.equal(retried.seconds,expected.seconds);assert.deepEqual(await retried.blob.arrayBuffer(),await expected.blob.arrayBuffer());assert.equal(JSON.stringify(fixture.job),before);
});
test('accessible progress displays exact acknowledgements and hides meter on terminal failure',()=>{
 const map=new Map(),$=id=>{if(!map.has(id))map.set(id,{});return map.get(id);};
 showPreparationProgress($,{phase:'encoding',completedParts:2,totalParts:8},'Chapter 1');assert.equal($('preparation-meter').max,8);assert.equal($('preparation-meter').value,2);assert.match($('preparation-status').textContent,/2 of 8/);
 showPreparationProgress($,{phase:'finalizing',completedParts:8,totalParts:8});assert.match($('preparation-status').textContent,/Finalizing/);
 showPreparationProgress($,{phase:'failed',completedParts:8,totalParts:8,error:'Retry safely.'});assert.equal($('preparation-meter').hidden,true);assert.match($('preparation-status').textContent,/Retry safely/);
});
test('actual export handler never publishes failed preparation or changes selected revision',async()=>{
 const main=await readFile('src/main.js','utf8'),handler=main.slice(main.indexOf('async function exportAudio('),main.indexOf("$('start').onclick=")),map=new Map();let downloads=0;
 const $=id=>{if(!map.has(id))map.set(id,{});return map.get(id);},job={id:'synthetic',title:'Test',next:1,passages:[{}],takeSelection:{revision:2}};
 const context=vm.createContext({$,AbortController,abortable,assertActive,showPreparationProgress,store:{job:async()=>structuredClone(job)},recordingBlob:async(_s,_j,_c,_m,options)=>({blob:await encodePcmParts([part()],24000,{...options,createWorker:()=>({terminate(){},postMessage(){throw Error('Synthetic export failure');}})})}),busy:()=>false,controls(){},renderDetails(){},safeFilename:x=>x,saveFile(){downloads++;},warn:e=>e.message});
 vm.runInContext(`let selectedJob=${JSON.stringify(job)},selectionToken=0,exporting=false,exportController=null;${handler}\nglobalThis.state=()=>({exporting,revision:selectedJob.takeSelection.revision});`,context);await context.exportAudio();assert.equal(downloads,0);assert.deepEqual({...context.state()},{exporting:false,revision:2});assert.match($('export-status').textContent,/Retry preparation/);assert.equal($('preparation-meter').hidden,true);
});
test('preparation awaits asynchronous worker shutdown after clearing request timers',async()=>{
 const timer=clock(),termination=deferred(),entered=deferred();let completed=false;
 const worker={terminate(){entered.resolve();return termination.promise;},postMessage(data){queueMicrotask(()=>reply(this,data));}};
 const pending=encodePcmParts([part()],24000,{createWorker:()=>worker,timers:timer}).then(value=>{completed=true;return value;});await entered.promise;await tick();assert.equal(completed,false);assert.equal(timer.size,0);termination.resolve();assert.equal((await pending).size,3);
});
test('changed PCM read length and malformed final result cannot produce an artifact',async()=>{
 class WrongLength extends Blob{async arrayBuffer(){return new ArrayBuffer(2);}}
 for(const mode of ['read','finish']){
  let terminated=0;const worker={terminate(){terminated++;},postMessage(data){queueMicrotask(()=>reply(this,data,mode==='finish'&&data.type==='finish'?{parts:[]}:{}));}};
  await assert.rejects(encodePcmParts([part(mode==='read'?new WrongLength([new Uint8Array(8)]):undefined)],24000,{createWorker:()=>worker}),/changed|Invalid/);assert.equal(terminated,1);
 }
});
test('recovery changes preserve PCM helpers and worker codec source except response envelopes',async()=>{
 const hash=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex'),continuity=await readFile('src/continuity.js','utf8'),worker=await readFile('src/mp3-export-worker.js','utf8');
 assert.equal(hash(continuity.slice(0,continuity.indexOf('export const MP3_REQUEST_TIMEOUT_MS'))),'7ab599978bd3f10533a66a2ce8a1d1dd43e70150f40f87ec19e28e5408877563');
 assert.equal(hash(worker.replaceAll('{id:data.id,type:data.type,','{')),'250e7d1fc79c2b89c46bbeabc03d82661162e606d79fbd3223acd09ae93797db');
});
test('default browser timers keep their global receiver through the watchdog wrapper',async()=>{
 const source=(await readFile('src/continuity.js','utf8')).replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify('file:///fixture/continuity.js')),tasks=new Map();let id=0,globalObject,terminated=0;
 const context=vm.createContext({Blob,ArrayBuffer,Uint8Array,DOMException,performance,Promise,Error,
  setTimeout:function(fn,ms){assert.equal(this,globalObject,'browser timer receiver');tasks.set(++id,{fn,ms});return id;},
  clearTimeout:function(key){assert.equal(this,globalObject,'browser timer receiver');tasks.delete(key);}});
 globalObject=vm.runInContext('globalThis',context);vm.runInContext(source+'\nglobalThis.encode=encodePcmParts;',context);
 const worker={terminate(){terminated++;},postMessage(data){queueMicrotask(()=>reply(this,data));}};
 assert.equal((await context.encode([part()],24000,{createWorker:()=>worker})).size,3);assert.equal(tasks.size,0);assert.equal(terminated,1);
});
