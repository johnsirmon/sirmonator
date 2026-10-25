import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createChapterCache} from '../src/chapter-cache.js';
import {abortable} from '../src/continuity.js';
const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
const controls=main.slice(main.indexOf('const busy='),main.indexOf('const audition='));
const player=main.slice(main.indexOf('function beginSelection('),main.indexOf('function mediaControls('));
const preparation=main.slice(main.indexOf('const chapterCache='),main.indexOf('const status='));
const stop=main.split('\n').find(line=>line.startsWith("$('stop').onclick="));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
test('actual controls keep Stop enabled after current load while next chapter prepares, and Stop aborts it',async()=>{
 const gate=deferred(),started=deferred(),elements=new Map();let nextSignal,preparedCalls=0;
 const job={id:'A',next:2,passages:[{chapter:0},{chapter:1}],settings:{pipeline:'pcm-v2'}};
 const $=id=>{if(!elements.has(id))elements.set(id,{value:'0',disabled:false,currentTime:0,duration:1,pause(){}});return elements.get(id);};
 const context=vm.createContext({storageReady:true,storageOpening:false,storageStateChanged(){},$,createChapterCache,abortable,AbortController,
  document:{querySelectorAll:()=>[]},store:{job:async()=>job},
  recordingBlob:async(_store,_job,chapter,_max,{signal})=>{preparedCalls++;if(chapter===1){nextSignal=signal;started.resolve();return gate.promise;}return {blob:new Blob(['current'])};},
  createPlaybackPreparation:async(_store,job)=>({job,dispose(){},prepare:async(cache,chapter)=>{const result=await cache.get(job,chapter);if(job.passages.slice(0,job.next).some(p=>p.chapter===chapter+1))cache.prefetch(job,chapter+1);return result;}}),validateCheckpoint:async()=>{},availableChapters:()=>[0,1],URL:{createObjectURL:()=> 'blob:current',revokeObjectURL:()=>{}},mediaControls:()=>{},podcastHandoff:()=>{},warn:e=>e.message,status:()=>{},killWorker:()=>{},audition:{stop(){}},window:{}});
 vm.runInContext(`let selectedJob=${JSON.stringify(job)},creating=false,quick=false,auditionBusy=false,importing=false,exporting=false,pauseRequested=false,quickPaused=false,exportController=null,playbackController=null,renderToken=0,selectionToken=0,audioURL=null,loadedChapter=0,loadedThrough=0,loadedJobId=null;
 ${preparation}\n${controls}\n${player}\n${stop}\nglobalThis.api={loadChapter,cache:chapterCache,foreground:()=>playbackController};`,context);
 await context.api.loadChapter(0);await started.promise;
 assert.equal(context.api.foreground(),null);assert.equal(context.api.cache.preparing,true);assert.equal($('stop').disabled,false);assert.equal($('stop').textContent,'Cancel audio preparation');
 const late=context.api.cache.get(job,1);$('stop').onclick();assert.equal(nextSignal.aborted,true);assert.equal(context.api.cache.preparing,false);assert.equal($('stop').disabled,true);
 gate.resolve({blob:new Blob(['late'])});await assert.rejects(late,{name:'AbortError'});assert.equal($('audio').src,'blob:current');assert.equal(preparedCalls,2);assert.equal($('stop').disabled,true);
});
test('cache preparation notifications cover success, failure and clear',async()=>{
 const gate=deferred(),states=[];let fail=false;
 const cache=createChapterCache({onChange:()=>states.push(cache.preparing),prepare:async()=>{if(fail)throw Error('synthetic failure');return gate.promise;}});
 const job={id:'A',next:1,passages:[{chapter:0}]};const pending=cache.get(job,0);assert.equal(states.at(-1),true);
 gate.resolve({blob:new Blob(['ok'])});await pending;assert.equal(states.at(-1),false);
 cache.clear();assert.equal(states.at(-1),false);fail=true;await assert.rejects(cache.get(job,0),/synthetic failure/);assert.equal(states.at(-1),false);
});
