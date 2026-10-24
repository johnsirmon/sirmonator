import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
const player=main.slice(main.indexOf('function beginSelection('),main.indexOf('function mediaControls('));
const fields=main.slice(main.indexOf('function podcastFields('),main.indexOf("$('pod-export').onclick="));
const exporting=main.slice(main.indexOf("$('pod-export').onclick="),main.indexOf('function podcastHandoff('));
const restore=main.slice(main.indexOf('function restorePodcast('),main.indexOf('let podcastSaveTimer'));
const saving=main.slice(main.indexOf('let podcastSaveTimer'),main.indexOf("window.addEventListener('pagehide',()=>flushPodcast"));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
function harness(save=async()=>{}){
 let persisted={id:'A',title:'Recording A',source:'Original source',next:1,passages:[{}],podcast:{episodeTitle:'OLD'}},exported;
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,hidden:false,textContent:'',addEventListener(name,callback){this[name]=callback;}});return elements.get(id);};
 const store={job:async()=>structuredClone(persisted),savePodcast:async(id,value)=>{await save(value);persisted={...persisted,podcast:structuredClone(value)};},podcastGuid:async()=>{persisted.episodeGuid='stable';}};
 const context=vm.createContext({$,store,Promise,clearTimeout:()=>{},setTimeout:()=>1,validateCheckpoint:async()=>{},displayProgress:()=>{},availableChapters:()=>[0],podcastHandoff:()=>{},recordingBlob:async()=>({blob:{}}),safeFilename:value=>value,packageZip:()=>({}),saveFile:()=>{},controls:()=>{},warn:error=>error.message,episodePackage:async(_job,_blob,value)=>{exported=value;return {files:[],metadata:{warnings:[]}};},URL:{},mediaControls:()=>{}});
 vm.runInContext(`let selectedJob=null,selectionToken=0,renderToken=0,audioURL=null,loadedJobId=null,loadedChapter=0,loadedThrough=0,exporting=false;const busy=()=>exporting;\n${player}\n${fields}\n${restore}\n${saving}\n${exporting}\nglobalThis.api={showRecording,flushPodcast,pending:()=>podcastPending};`,context);
 return {...context.api,$,job:()=>structuredClone(persisted),exported:()=>exported,edit:title=>{$('pod-episode-title').value=title;$('podcast-prep').input();}};
}
test('same-recording Open flushes pending metadata then restores the acknowledged snapshot before export',async()=>{
 const gate=deferred(),started=deferred(),fixture=harness(async()=>{started.resolve();await gate.promise;});
 await fixture.showRecording(fixture.job(),{keepAudio:true});const stale=fixture.job();fixture.edit('NEW');
 const opening=fixture.showRecording(stale,{keepAudio:true});await started.promise;gate.resolve();await opening;
 assert.equal(fixture.job().podcast.episodeTitle,'NEW');assert.equal(fixture.$('pod-episode-title').value,'NEW');
 await fixture.$('pod-export').onclick();assert.equal(fixture.exported().episodeTitle,'NEW');assert.equal(fixture.job().podcast.episodeTitle,'NEW');
});
test('failed podcast saves retain pending fields and visible edits for retry',async()=>{
 let fail=true;const fixture=harness(async()=>{if(fail)throw Error('Storage temporarily unavailable');});
 await fixture.showRecording(fixture.job(),{keepAudio:true});fixture.edit('NEW');
 await assert.rejects(fixture.showRecording(fixture.job(),{keepAudio:true}),/Storage temporarily/);
 assert.equal(fixture.pending().fields.episodeTitle,'NEW');assert.equal(fixture.$('pod-episode-title').value,'NEW');
 fail=false;await fixture.flushPodcast();assert.equal(fixture.pending(),null);assert.equal(fixture.job().podcast.episodeTitle,'NEW');
});
test('serialized saves do not clear a newer edit while an earlier save is in flight',async()=>{
 const gate=deferred(),started=deferred();let first=true;const fixture=harness(async()=>{if(first){first=false;started.resolve();await gate.promise;}});
 await fixture.showRecording(fixture.job(),{keepAudio:true});fixture.edit('FIRST');const firstSave=fixture.flushPodcast();await started.promise;
 fixture.edit('LATEST');const secondSave=fixture.flushPodcast();gate.resolve();await Promise.all([firstSave,secondSave]);
 assert.equal(fixture.job().podcast.episodeTitle,'LATEST');assert.equal(fixture.pending(),null);
});

test('same-recording Open preserves edits made while its pending save is in flight',async()=>{
 const gate=deferred(),started=deferred();let first=true;const fixture=harness(async()=>{if(first){first=false;started.resolve();await gate.promise;}});
 await fixture.showRecording(fixture.job(),{keepAudio:true});fixture.edit('FIRST');const opening=fixture.showRecording(fixture.job(),{keepAudio:true});await started.promise;
 fixture.edit('LATEST');gate.resolve();await opening;
 assert.equal(fixture.job().podcast.episodeTitle,'LATEST');assert.equal(fixture.$('pod-episode-title').value,'LATEST');await fixture.$('pod-export').onclick();assert.equal(fixture.exported().episodeTitle,'LATEST');
});
