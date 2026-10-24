import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
// Exercise the real application functions with deferred storage, without importing
// CSS or starting the browser's synthesis engine. No player logic is duplicated.
const player=main.slice(main.indexOf('function beginSelection('),main.indexOf('function mediaControls('));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function harness({read,blob,validate=async()=>{}}={}){
 const A={id:'A',title:'Recording A',next:1,passages:[{chapter:0}],position:{chapter:0,time:7}},B={id:'B',title:'Recording B',next:0,passages:[{chapter:0}],position:{chapter:0,time:0}};
 A.source='Source A';B.source='Source B';const elements=new Map(),urls=[],actions=[];const $=id=>{if(!elements.has(id))elements.set(id,{textContent:'',value:'0',hidden:false,src:'',currentTime:0,duration:200,pause(){},play(){actions.push({play:true});return Promise.resolve();},removeAttribute(name){this[name]='';}});return elements.get(id);};
 const context=vm.createContext({$,store:{job:read??(async id=>id==='A'?A:B)},validateCheckpoint:(_store,job)=>validate(job),flushPodcast:async()=>{},restorePodcast:()=>{},availableChapters:job=>[...new Set(job.passages.slice(0,job.next).map(p=>p.chapter))],displayProgress:job=>{$('recording-title').textContent=job.title;},recordingBlob:blob??(async()=>({blob:{id:'A'}})),URL:{createObjectURL:value=>{const url='blob:'+value.id;urls.push(url);return url;},revokeObjectURL:()=>{}},mediaControls:()=>{},warn:error=>error.message,Blob,saveFile:(blob,name)=>actions.push({blob,name}),safeFilename:value=>value,createAudio:id=>actions.push({resume:id}),savePosition:async()=>{},controls:()=>{},status:text=>{$('status').textContent=text;}});
 const ended=main.slice(main.indexOf("$('audio').onended="),main.indexOf("$('download').onclick="));
 const handlers=main.split('\n').filter(line=>line.startsWith("$('start').onclick=")||line.startsWith("$('transcript').onclick=")||line.startsWith("$('saved-recordings').onchange=")).join('\n');
 vm.runInContext(`let selectedJob=null,renderToken=0,selectionToken=0,audioURL=null,loadedChapter=0,loadedThrough=0,loadedJobId=null;\n${player}\n${handlers}\n${ended}\nglobalThis.api={showRecording,loadChapter,state:()=>({selectedId:selectedJob?.id,loadedJobId,title:$('recording-title').textContent,src:$('audio').src,status:$('export-status').textContent})};`,context);
 return {A,B,$,urls,actions,...context.api};
}
for(const stage of ['job read','audio read'])test(`switching to an empty recording refuses late A results after deferred ${stage}`,async()=>{
 const gate=deferred(),started=deferred();let fixture;
 fixture=harness(stage==='job read'?{read:async id=>{if(id==='A'){started.resolve();await gate.promise;}return id==='A'?fixture.A:fixture.B;}}:{blob:async()=>{started.resolve();await gate.promise;return {blob:{id:'A'}};}});
 const old=fixture.showRecording(fixture.A);await started.promise;
 await fixture.showRecording(fixture.B);gate.resolve();await old;
 const state=fixture.state();assert.equal(state.title,'Recording B');assert.equal(state.selectedId,'B');assert.equal(state.loadedJobId,null);assert.equal(state.src,'');assert.deepEqual(fixture.urls,[]);
 fixture.$('transcript').onclick();fixture.$('resume-recording').onclick();assert.equal(await fixture.actions[0].blob.text(),'Source B');assert.equal(fixture.actions[1].resume,'B');
});
test('an older recording whose validation finishes last cannot replace a newer selection',async()=>{
 const gate=deferred(),started=deferred(),fixture=harness({validate:async job=>{if(job.id==='A'){started.resolve();await gate.promise;}}});
 const old=fixture.showRecording(fixture.A);await started.promise;await fixture.showRecording(fixture.B);gate.resolve();await old;
 assert.equal(fixture.state().selectedId,'B');assert.equal(fixture.state().title,'Recording B');
});
test('late failure from an old audio read does not overwrite the new recording status',async()=>{
 const gate=deferred(),started=deferred(),fixture=harness({blob:async()=>{started.resolve();await gate.promise;return {blob:{id:'A'}};}});
 const old=fixture.showRecording(fixture.A);await started.promise;await fixture.showRecording(fixture.B);fixture.$('export-status').textContent='B is selected';gate.reject(Error('A failed'));await old;
 assert.equal(fixture.state().status,'B is selected');assert.equal(fixture.state().selectedId,'B');
});

test('stale validation errors are ignored after another recording is selected',async()=>{
 const gate=deferred(),started=deferred(),fixture=harness({validate:async job=>{if(job.id==='A'){started.resolve();await gate.promise;}}});let staleError;
 const old=fixture.showRecording(fixture.A).catch(error=>{staleError=error;});await started.promise;await fixture.showRecording(fixture.B);gate.reject(Error('A checkpoint failed'));await old;
 assert.equal(staleError,undefined);assert.equal(fixture.state().selectedId,'B');
});

test('Open captures the requested ID before deferred job reads so the last user choice wins',async()=>{
 const gate=deferred(),started=deferred();let fixture;
 fixture=harness({read:async id=>{if(id==='A'){started.resolve();await gate.promise;}return id==='A'?fixture.A:fixture.B;}});
 fixture.$('saved-recordings').value='A';const old=fixture.$('open-recording').onclick();await started.promise;
 fixture.$('saved-recordings').value='B';await fixture.$('open-recording').onclick();gate.resolve();await old;
 assert.equal(fixture.state().selectedId,'B');assert.equal(fixture.state().title,'Recording B');
});

test('delayed ended-handler storage reads cannot restore the previous recording',async()=>{
 const gate=deferred(),started=deferred();let delay=false,fixture;
 fixture=harness({read:async id=>{if(delay&&id==='A'){started.resolve();await gate.promise;}return id==='A'?fixture.A:fixture.B;}});
 await fixture.showRecording(fixture.A);delay=true;const old=fixture.$('audio').onended();await started.promise;
 await fixture.showRecording(fixture.B);gate.resolve();await old;
 assert.equal(fixture.state().selectedId,'B');assert.equal(fixture.state().title,'Recording B');assert.equal(fixture.state().loadedJobId,null);
});

test('old ended handler cannot autoplay the newly selected recording after a deferred chapter load',async()=>{
 const gate=deferred(),started=deferred();let reads=0;
 const fixture=harness({blob:async()=>{if(++reads===2){started.resolve();await gate.promise;}return {blob:{id:'A'}};}});
 fixture.A.next=2;fixture.A.passages=[{chapter:0},{chapter:1}];await fixture.showRecording(fixture.A);
 const old=fixture.$('audio').onended();await started.promise;await fixture.showRecording(fixture.B);gate.resolve();await old;
 assert.equal(fixture.state().selectedId,'B');assert.ok(!fixture.actions.some(action=>action.play));
});
