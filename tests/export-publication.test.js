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
