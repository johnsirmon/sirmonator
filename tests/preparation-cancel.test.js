import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
const create=source.slice(source.indexOf('async function createAudio('),source.indexOf('function quickListen('));
const handlers=source.split('\n').filter(line=>line.startsWith("$('pause').onclick=")||line.startsWith("$('stop').onclick=")).join('\n');
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
for(const stage of ['flushDraft','store.job','ensureJob','browserEstimate'])for(const action of ['stop','pause'])test(`${action} during pending ${stage} does not acquire synthesis or generate`,{timeout:5000},async()=>{
 const gate=deferred(),started=deferred(),elements=new Map(),job={id:'fixture',source:'Reviewed synthetic text.',next:0,passages:[{}],settings:{},seconds:0};let generations=0,leases=0,waited=false,message='';
 const $=id=>{if(!elements.has(id))elements.set(id,{value:id==='engine'?'studio':id==='speed'?'1':'Reviewed synthetic text.',checked:true,hidden:false,focus(){},pause(){}});return elements.get(id);};
 const wait=async name=>{if(stage===name&&!waited){waited=true;started.resolve();await gate.promise;}};
 const context=vm.createContext({boundaryError:'',draftBoundaryPolicy:()=> 'word-grapheme-240-v2',WORD_BOUNDARIES:'word-grapheme-240-v2',browserStorageEstimate:()=>wait('browserEstimate'),storageReady:true,storageOpening:false,storageStateChanged(){},cancelPreparations:()=>{},renderToken:0,$,beginSelection:()=>0,busy:()=>vm.runInContext('creating',context),controls:()=>{},status:text=>message=text,warn:error=>error.message,flushDraft:()=>wait('flushDraft'),store:{job:async()=>{await wait('store.job');return job;},ensureJob:async()=>{await wait('ensureJob');return job;}},navigator:{},rangeText:()=>job.source,countWords:()=>3,MAX_DOCUMENT:2e6,settings:()=>({}),makeRecording:async()=>job,audition:{stop(){}},showRecording:async value=>{context.selectedJob=value;},refreshLibrary:async()=>{},validateCheckpoint:async()=>{},withLease:async callback=>{leases++;return callback(()=>false);},runRecording:async options=>{if(!options.shouldPause())generations++;return job;},generate:()=>{},synthesisClient:{idle(){}},killWorker:()=>{},displayProgress:()=>{},availableChapters:()=>[0],loadChapter:async()=>{},performance,window:{speechSynthesis:{cancel(){}}}});
 vm.runInContext(`let creating=false,quick=false,quickPaused=false,pauseRequested=false,cancelled=false,exporting=false,wake=null,selectedJob=null,selectionToken=0;const owner='fixture';\n${create}\n${handlers}\nglobalThis.start=createAudio;`,context);
 const pending=context.start(stage==='store.job'?'fixture':undefined);await started.promise;$(action).onclick();gate.resolve();await pending;
 assert.equal(generations,0,`${action} must remain effective after the deferred ${stage}`);assert.equal(leases,0,'Do not acquire synthesis after preparation was cancelled or paused');assert.match(message,action==='pause'?/Paused/i:/Cancel/i);
});
