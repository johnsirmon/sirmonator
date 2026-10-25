import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {abortable,encodePcmParts} from '../src/continuity.js';
import {createSynthesisClient} from '../src/synthesis-client.js';
import {createAuditionPlayer} from '../src/audition-player.js';
import {createQuickListener} from '../src/quick-listener.js';
import {createChapterCache} from '../src/chapter-cache.js';
const baseline=process.env.SIRMONATOR_RESOURCE_BASELINE;
if(baseline)assert.match(baseline,/^[a-f0-9]{40}$/,'Explicit local historical source only');
const main=baseline?execFileSync('git',['show',baseline+':src/main.js'],{encoding:'utf8',windowsHide:true}):await readFile(new URL('../src/main.js',import.meta.url),'utf8');
const section=(start,end)=>{const a=main.indexOf(start),b=main.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return main.slice(a,b);};
function urls(){let sequence=0;const live=new Set(),revoked=[];return {live,revoked,fail:false,createObjectURL(){if(this.fail)throw Error('Synthetic URL allocation failure');const url='blob:synthetic-'+(++sequence);live.add(url);return url;},revokeObjectURL(url){assert.ok(live.delete(url),'revoked missing URL '+url);revoked.push(url);}};}
function timers(){let sequence=0;const tasks=new Map();return {setTimeout(fn){tasks.set(++sequence,fn);return sequence;},clearTimeout:id=>tasks.delete(id),drain(){const ready=[...tasks];tasks.clear();for(const [,fn] of ready)fn();},get size(){return tasks.size;}};}

test('actual download handler releases URLs on synchronous failure and retains successful downloads until grace timer',()=>{
 const URL=urls(),clock=timers();let failure=false,created=0;
 const context=vm.createContext({URL,setTimeout:fn=>clock.setTimeout(fn),document:{createElement(){created++;if(failure==='create')throw Error('Synthetic anchor failure');return {click(){if(failure==='click')throw Error('Synthetic download failure');}};}}});
 vm.runInContext(section('function saveFile(', 'async function refreshLibrary(')+'\nglobalThis.save=saveFile;',context);
 for(let i=0;i<100;i++){failure=i%3===0?'create':i%3===1?'click':false;
  if(failure){assert.throws(()=>context.save(new Blob(['synthetic']),'sample.mp3'),/Synthetic/);assert.equal(URL.live.size,0,'failed download retained an unowned object URL');assert.equal(clock.size,0);}
  else{context.save(new Blob(['synthetic']),'sample.mp3');assert.equal(URL.live.size,1,'successful download revoked prematurely');assert.equal(clock.size,1);clock.drain();assert.equal(URL.live.size,0);}
 }
 assert.equal(created,100);
});

test('actual chapter replacement preserves the current URL when replacement allocation fails over 100 loads',async()=>{
 const URL=urls(),nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:'1',duration:1,currentTime:0,pause(){}});return nodes.get(id);};
 const job={id:'synthetic',next:1,passages:[{chapter:0}]};let failPreparation=false;
 const context=vm.createContext({$,URL,AbortController,abortable,store:{job:async()=>job},controls(){},renderDetails(){},mediaControls(){},warn:e=>e.message,chapterCache:{},createPlaybackPreparation:async()=>({job,dispose(){},prepare:async()=>{if(failPreparation)throw Error('Synthetic preparation failure');return {blob:new Blob(['synthetic'])};}})});
 vm.runInContext(`let selectedJob=${JSON.stringify(job)},renderToken=0,selectionToken=0,playbackController=null,audioURL=null,loadedChapter=0,loadedThrough=0,loadedJobId=null;${section('function playbackFailure(','async function showRecording(')}${section('async function loadChapter(','function renderDetails(')}\nglobalThis.load=loadChapter;globalThis.url=()=>audioURL;`,context);
 assert.equal(await context.load(0),true);
 for(let i=0;i<100;i++){const previous=context.url();URL.fail=i%3===0;failPreparation=i%3===1;const result=await context.load(0);assert.equal(URL.live.size,1);
  if(URL.fail||failPreparation){assert.equal(result,undefined);assert.equal(context.url(),previous);assert.ok(URL.live.has(previous),'failed replacement revoked currently loaded audio');assert.equal($('audio').src,previous);}
  else{assert.equal(result,true);assert.notEqual(context.url(),previous);assert.ok(!URL.live.has(previous));}
 }
 URL.revokeObjectURL(context.url());assert.equal(URL.live.size,0);
});

test('actual custom preview retains one owned URL across 100 failures and successful replacements',async()=>{
 const URL=urls(),old=URL.createObjectURL(),nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:'',pause(){},play:async()=>{}});return nodes.get(id);};$('audition-audio').src=old;
 let failGeneration=false;const context=vm.createContext({$,URL,Blob,busy:()=>false,boundaryError:null,draftBoundaryPolicy:()=>null,rangeText:()=> 'Synthetic exact words.',chunkSource:()=>['Synthetic exact words.'],controls(){},settings:()=>({}),generate:async()=>{if(failGeneration)throw Error('Synthetic preview failure');return {bytes:new Uint8Array([1])};},status(){},warn:e=>e.message,synthesisClient:{idle(){}}});
 vm.runInContext(`let creating=false,cancelled=false,previewURL=${JSON.stringify(old)};${section("$('custom-preview').onclick=", "$('engine').onchange=")}\nglobalThis.url=()=>previewURL;`,context);
 for(let i=0;i<100;i++){const previous=context.url();URL.fail=i%3===0;failGeneration=i%3===1;await $('custom-preview').onclick();assert.equal(URL.live.size,1);if(URL.fail||failGeneration){assert.equal(context.url(),previous);assert.ok(URL.live.has(previous));assert.equal($('audition-audio').src,previous);}else{assert.notEqual(context.url(),previous);assert.ok(!URL.live.has(previous));}}
 URL.revokeObjectURL(context.url());assert.equal(URL.live.size,0);
});

test('abortable removes signal listeners after 100 resolve, reject and cancellation cycles',async()=>{
 for(let i=0;i<100;i++){const controller=new AbortController(),signal=controller.signal,live=new Set(),add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);signal.addEventListener=(name,fn,options)=>{if(name==='abort')live.add(fn);add(name,fn,options);};signal.removeEventListener=(name,fn,options)=>{if(name==='abort')live.delete(fn);remove(name,fn,options);};
  let resolve,reject;const work=new Promise((yes,no)=>{resolve=yes;reject=no;}),pending=abortable(work,signal);assert.equal(live.size,1);
  if(i%3===0){controller.abort();await assert.rejects(pending,{name:'AbortError'});resolve('late');}else if(i%3===1){reject(Error('Synthetic read failure'));await assert.rejects(pending,/Synthetic read failure/);}else{resolve('ok');assert.equal(await pending,'ok');}await Promise.resolve();assert.equal(live.size,0);
 }
});

test('Studio warm reuse, cancellation, failure and idle retry balance workers/timers over 100 cycles',async()=>{
 const clock=timers();let live=0;const workers=[];
 const client=createSynthesisClient({setTimer:fn=>clock.setTimeout(fn),clearTimer:id=>clock.clearTimeout(id),createWorker:()=>{live++;const worker={postMessage(data){this.last=data;},terminate(){live--;},reply(){this.onmessage({data:{type:'passage',requestId:this.last.requestId,seconds:1}});}};workers.push(worker);return worker;}});
 for(let i=0;i<100;i++){for(let n=0;n<2;n++){const work=client.generate({text:'Synthetic'},'kokoro:frozen');workers.at(-1).reply();await work;assert.equal(live,1);assert.equal(clock.size,1);}const old=workers.at(-1),late=old.onmessage;
  if(i%3===0){const pending=client.generate({},'kokoro:frozen');client.cancel();await assert.rejects(pending,/cancelled/);}else if(i%3===1){const pending=client.generate({},'kokoro:frozen');old.onerror({message:'Synthetic worker failure'});await assert.rejects(pending,/Synthetic worker failure/);}else clock.drain();assert.equal(live,0);assert.equal(clock.size,0);late({data:{type:'passage',requestId:old.last.requestId,seconds:99}});assert.equal(live,0);
 }
 client.cancel();assert.equal(live,0);assert.equal(clock.size,0);
});

test('audition and Quick listen detach terminal callbacks over 100 modest stopped/failed/completed cycles',async()=>{
 const audio={pause(){},play:async()=>{}},player=createAuditionPlayer({audio,setBusy(){},notify(){}}),voice={voiceURI:'synthetic',name:'Synthetic',lang:'en'},utterances=[];
 const speech={getVoices:()=>[voice],speak:u=>utterances.push(u),pause(){},resume(){},cancel(){}},quick=createQuickListener({getSpeech:()=>speech,createUtterance:text=>({text}),split:text=>[text],onState(){},notify(){}});
 for(let i=0;i<100;i++){await player.play('synthetic-local.wav');const end=audio.onended,error=audio.onerror;if(i%3===0)player.stop();else if(i%3===1)error();else end();assert.equal(audio.onended,null);assert.equal(audio.onerror,null);end();error();
  quick.start({text:'Synthetic exact text.',voice,speed:1});const u=utterances.at(-1),qEnd=u.onend,qError=u.onerror;quick.togglePause();quick.togglePause();if(i%3===0)quick.stop();else if(i%3===1)qError();else qEnd();assert.equal(u.onend,null);assert.equal(u.onerror,null);qEnd();qError();
 }player.stop();quick.stop();
});

test('chapter cache evicts and clears owned snapshots with retries over 100 cycles',async()=>{
 let calls=0,fail=false;const cache=createChapterCache({maxEntries:2,maxBytes:16,prepare:async()=>{calls++;if(fail)throw Error('Synthetic cache preparation failure');return {blob:new Blob([new Uint8Array(8)])};}}),job={id:'synthetic',next:3,passages:[{chapter:0},{chapter:1},{chapter:2}]};
 for(let i=0;i<100;i++){const before=calls;await cache.get(job,0);await cache.get(job,1);await cache.get(job,0);assert.equal(calls-before,2);await cache.get(job,2);await cache.get(job,1);assert.equal(calls-before,4);assert.equal(cache.preparing,false);cache.clear();fail=true;await assert.rejects(cache.get(job,0),/Synthetic cache preparation failure/);assert.equal(cache.preparing,false);fail=false;await cache.get(job,0);cache.clear();assert.equal(cache.preparing,false);}
});

test('MP3 preparation balances workers, abort listeners and request timers over 100 failure/retry cycles',async()=>{
 const part={blob:new Blob([new Uint8Array(8)]),sampleRate:24000,sampleCount:4,channels:1,format:'pcm-s16le'};
 for(let i=0;i<100;i++)for(const mode of [i%2?'failure':'cancel','success','success']){
  const clock=timers(),controller=new AbortController(),signal=controller.signal,listeners=new Set(),add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);let live=0,terminated=0;
  signal.addEventListener=(name,fn,options)=>{if(name==='abort')listeners.add(fn);add(name,fn,options);};signal.removeEventListener=(name,fn,options)=>{if(name==='abort')listeners.delete(fn);remove(name,fn,options);};
  const worker={terminate(){live--;terminated++;},postMessage(data){queueMicrotask(()=>{if(mode==='cancel'){controller.abort();return;}if(mode==='failure'){this.onerror({message:'Synthetic preparation failure'});return;}this.onmessage({data:{type:data.type,id:data.id,ok:true,...(data.type==='finish'?{parts:[new Uint8Array([1,2,3])]}:{})}});});}};live++;
  const pending=encodePcmParts([part],24000,{createWorker:()=>worker,signal,timers:clock});
  if(mode==='success')assert.equal((await pending).size,3);else if(mode==='cancel')await assert.rejects(pending,{name:'AbortError'});else await assert.rejects(pending,/Synthetic preparation failure/);
  assert.equal(live,0);assert.equal(terminated,1);assert.equal(clock.size,0);assert.equal(listeners.size,0);controller.abort();assert.equal(terminated,1);
 }
});
