import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {abortable,assertActive} from '../src/continuity.js';
const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
const audioExport=main.slice(main.indexOf('async function exportAudio('),main.indexOf("$('start').onclick="));
const podcastExport=main.slice(main.indexOf("$('pod-export').onclick="),main.indexOf('function podcastHandoff('));
const stop=main.split('\n').find(line=>line.startsWith("$('stop').onclick="));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
for(const kind of ['audio','podcast'])for(const stage of ['blob','package']){
  if(kind==='audio'&&stage==='package')continue;
  test(`${kind} Stop during deferred ${stage} prevents publication`,async()=>{
    const gate=deferred(),started=deferred(),elements=new Map(),publications=[];
    const job={id:'A',next:1,passages:[{}],title:'Synthetic test',settings:{}};
    const $=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);};
    const context=vm.createContext({$,AbortController,abortable,assertActive,store:{job:async()=>job,podcastGuid:async()=>{}},
      recordingBlob:async()=>{if(stage==='blob'){started.resolve();await gate.promise;}return {blob:new Blob(['mp3'])};},
      episodePackage:async()=>{if(stage==='package'){started.resolve();await gate.promise;}return {files:[],metadata:{warnings:[]}};},
      Blob,File,packageZip:()=>new Blob(['zip']),saveFile:()=>publications.push('download'),navigator:{share:()=>publications.push('share')},
      safeFilename:v=>v,controls:()=>{},busy:()=>false,flushPodcast:async()=>{},podcastFields:()=>({}),warn:e=>e.message,status:()=>{},killWorker:()=>{},audition:{stop(){}},window:{}});
    vm.runInContext(`let selectedJob=${JSON.stringify(job)},selectionToken=0,renderToken=0,exporting=false,exportController=null,creating=false,quick=false;function cancelPreparations(){exportController?.abort();}\n${audioExport}\n${podcastExport}\n${stop}\nglobalThis.start=()=>${kind==='audio'?'exportAudio()':"$('pod-export').onclick()"};`,context);
    const pending=context.start();await started.promise;$('stop').onclick();gate.resolve();await pending;assert.deepEqual(publications,[]);
  });
}
test('final-chapter ended cannot acknowledge another tab take revision or export unseen audio',async()=>{
 const job={id:'A',next:1,passages:[{chapter:0}],title:'Synthetic test',settings:{}},remote={...job,takeSelection:{schema:1,revision:1,selected:{0:'other-tab-take'},history:[]}},elements=new Map();let prepared=0,published=0;
 const $=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);};
 const ended=main.slice(main.indexOf("$('audio').onended="),main.indexOf("$('download').onclick="));
 const context=vm.createContext({$,AbortController,abortable,assertActive,store:{job:async()=>structuredClone(remote)},recordingBlob:async()=>{prepared++;return {blob:new Blob(['mp3'])};},Blob,File,saveFile:()=>published++,safeFilename:v=>v,controls:()=>{},busy:()=>false,warn:e=>e.message,renderDetails:()=>{},availableChapters:()=>[0],navigator:{},loadChapter:()=>{throw Error('must not silently load');}});
 vm.runInContext(`let selectedJob=${JSON.stringify(job)},loadedJobId='A',loadedChapter=0,loadedThrough=1,selectionToken=0,renderToken=0,exporting=false,exportController=null;${ended}\n${audioExport}\nglobalThis.start=()=>exportAudio();globalThis.revision=()=>selectedJob.takeSelection?.revision??0;`,context);
 await $('audio').onended();assert.equal(context.revision(),0);assert.match($('export-status').textContent,/changed in another window/);await context.start();assert.equal(prepared,0);assert.equal(published,0);assert.equal(context.revision(),0);assert.match($('export-status').textContent,/Load latest/);
});
test('actual podcast handler forwards frozen selected artifact duration without rewriting original job duration',async()=>{
 const job={id:'A',next:1,passages:[{}],title:'Synthetic test',seconds:3,takeSelection:{revision:1}},elements=new Map();let received,published=0;
 const $=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);};
 const context=vm.createContext({$,AbortController,abortable,assertActive,store:{job:async()=>structuredClone(job),podcastGuid:async()=>{}},recordingBlob:async()=>({blob:new Blob(['mp3']),seconds:1.5,takeRevision:1}),episodePackage:async(saved,_audio,_fields,artifact)=>{received={saved,artifact};return {files:[],metadata:{warnings:[]}};},Blob,saveFile:()=>published++,packageZip:()=>new Blob(['zip']),safeFilename:v=>v,controls:()=>{},busy:()=>false,flushPodcast:async()=>{},podcastFields:()=>({}),warn:e=>e.message});
 vm.runInContext(`let selectedJob=${JSON.stringify(job)},selectionToken=0,exporting=false,exportController=null;${podcastExport}`,context);
 await $('pod-export').onclick();assert.equal(received.saved.seconds,3);assert.equal(received.artifact.seconds,1.5);assert.equal(received.artifact.takeRevision,1);assert.equal(job.seconds,3);assert.equal(published,1);
});
