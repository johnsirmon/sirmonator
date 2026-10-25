import {abortable,assertActive} from '../src/continuity.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {pcmReviewSummary} from '../src/pcm-review.js';
const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
// Exercise the real application functions with deferred storage, without importing
// CSS or starting the browser's synthesis engine. No player logic is duplicated.
const player=main.slice(main.indexOf('function beginSelection('),main.indexOf('function mediaControls('));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function harness({read,blob,allocate,validate=async()=>{}}={}){
 const A={id:'A',title:'Recording A',next:1,passages:[{chapter:0}],position:{chapter:0,time:7}},B={id:'B',title:'Recording B',next:0,passages:[{chapter:0}],position:{chapter:0,time:0}};
 A.source='Source A';B.source='Source B';const elements=new Map(),urls=[],actions=[];const $=id=>{if(!elements.has(id))elements.set(id,{textContent:'',value:'0',hidden:false,src:'',currentTime:0,duration:200,pause(){},play(){actions.push({play:true});return Promise.resolve();},removeAttribute(name){this[name]='';}});return elements.get(id);};
 const context=vm.createContext({pcmReviewSummary,busy:()=>false,AbortController,abortable,assertActive,cancelPreparations:()=>{},playbackController:null,exportController:null,chapterCache:{get:(...args)=>context.recordingBlob(context.store,...args),prefetch:()=>{}},$,store:{job:read??(async id=>id==='A'?A:B)},createPlaybackPreparation:async(_store,job)=>{await validate(job);return {job,dispose(){},prepare:async(cache,chapter)=>{const result=await cache.get(job,chapter);if(job.passages.slice(0,job.next).some(p=>p.chapter===chapter+1))cache.prefetch(job,chapter+1);return result;}};},validateCheckpoint:(_store,job)=>validate(job),flushPodcast:async()=>{},restorePodcast:()=>{},availableChapters:job=>[...new Set(job.passages.slice(0,job.next).map(p=>p.chapter))],displayProgress:job=>{$('recording-title').textContent=job.title;},recordingBlob:blob??(async()=>({blob:{id:'A'}})),URL:{createObjectURL:value=>{const url=allocate?allocate(value):'blob:'+value.id;urls.push(url);return url;},revokeObjectURL:()=>{}},mediaControls:()=>{},warn:error=>error.message,Blob,saveFile:(blob,name)=>actions.push({blob,name}),safeFilename:value=>value,createAudio:id=>actions.push({resume:id}),savePosition:async()=>{},controls:()=>{},status:text=>{$('status').textContent=text;}});
 const ended=main.slice(main.indexOf("$('audio').onended="),main.indexOf("$('download').onclick="));
 const handlers=main.split('\n').filter(line=>line.startsWith("$('start').onclick=")||line.startsWith("$('transcript').onclick=")||line.startsWith("$('saved-recordings').onchange=")).join('\n');
 vm.runInContext(`let selectedJob=null,renderToken=0,selectionToken=0,audioURL=null,loadedChapter=0,loadedThrough=0,loadedJobId=null;\n${player}\n${handlers}\n${ended}\nglobalThis.api={showRecording,loadChapter,state:()=>({selectedId:selectedJob?.id,loadedJobId,title:$('recording-title').textContent,src:$('audio').src,status:$('export-status').textContent})};`,context);
 return {A,B,$,urls,actions,context,...context.api};
}
for(const stage of ['preparation','URL allocation'])test(`failed ${stage} switching A to B retains a coherent A player and retry commits B`,async()=>{
 let fail=false;const fixture=harness({blob:async(_store,job)=>{if(fail&&stage==='preparation')throw Error('Synthetic preparation failure');return {blob:{id:job.id}};},allocate:value=>{if(fail&&stage==='URL allocation')throw Error('Synthetic URL allocation failure');return 'blob:'+value.id;}});fixture.B.next=1;
 await fixture.showRecording(fixture.A);fail=true;await fixture.showRecording(fixture.B);
 assert.equal(fixture.state().selectedId,'A');assert.equal(fixture.state().loadedJobId,'A');assert.equal(fixture.state().title,'Recording A');assert.equal(fixture.state().src,'blob:A');
 fixture.$('transcript').onclick();assert.equal(await fixture.actions.at(-1).blob.text(),'Source A');
 fail=false;await fixture.showRecording(fixture.B);assert.equal(fixture.state().selectedId,'B');assert.equal(fixture.state().loadedJobId,'B');assert.equal(fixture.state().title,'Recording B');assert.equal(fixture.state().src,'blob:B');
});

test('pending B selection keeps A identity and a newer C selection wins over late B preparation',async()=>{
 const gate=deferred(),started=deferred();let delayed=false;const fixture=harness({blob:async(_store,job)=>{if(job.id==='B'&&delayed){started.resolve();await gate.promise;}return {blob:{id:job.id}};}});fixture.B.next=1;
 await fixture.showRecording(fixture.A);delayed=true;const pending=fixture.showRecording(fixture.B);await started.promise;assert.equal(fixture.state().selectedId,'A');assert.equal(fixture.state().title,'Recording A');assert.equal(fixture.state().src,'blob:A');
 // Reuse A's storage slot with a fresh title: selection tokens, not object
 // identity or a distinct ID, must prevent the delayed B result publishing.
 fixture.A.title='Recording C revision';await fixture.showRecording(fixture.A);gate.resolve();await pending;assert.equal(fixture.state().selectedId,'A');assert.equal(fixture.state().title,'Recording C revision');assert.equal(fixture.state().loadedJobId,'A');assert.equal(fixture.state().src,'blob:A');
});

for(const stage of ['preparation','URL allocation'])test(`failed ${stage} chapter transition restores the loaded chapter control and retries`,async()=>{
 let fail=false;const fixture=harness({blob:async(_store,job,chapter)=>{if(fail&&stage==='preparation')throw Error('Synthetic chapter failure');return {blob:{id:job.id+chapter}};},allocate:value=>{if(fail&&stage==='URL allocation')throw Error('Synthetic allocation failure');return 'blob:'+value.id;}});fixture.A.next=2;fixture.A.passages=[{chapter:0},{chapter:1}];
 await fixture.showRecording(fixture.A);fail=true;fixture.$('play-chapter').value='1';await fixture.loadChapter(1);assert.equal(fixture.state().src,'blob:A0');assert.equal(fixture.state().title,'Recording A');assert.equal(fixture.$('play-chapter').value,'0');
 fail=false;assert.equal(await fixture.loadChapter(1),true);assert.equal(fixture.state().src,'blob:A1');assert.equal(fixture.$('play-chapter').value,'1');
});

test('actual Stop during pending B selection keeps A audio/identity and allows a fresh B retry',async()=>{
 const gate=deferred(),started=deferred();let delayed=true;const fixture=harness({blob:async(_store,job)=>{if(job.id==='B'&&delayed){started.resolve();await gate.promise;}return {blob:{id:job.id}};}});fixture.B.next=1;
 fixture.context.killWorker=()=>{};fixture.context.audition={stop(){}};fixture.context.cancelPreparations=()=>fixture.context.playbackController?.abort();
 vm.runInContext('let creating=false,quick=false,importing=false;'+main.split('\n').find(line=>line.startsWith("$('stop').onclick=")),fixture.context);
 await fixture.showRecording(fixture.A);const pending=fixture.showRecording(fixture.B);await started.promise;fixture.$('stop').onclick();gate.resolve();await pending;assert.equal(fixture.state().selectedId,'A');assert.equal(fixture.state().loadedJobId,'A');assert.equal(fixture.state().src,'blob:A');assert.equal(fixture.state().title,'Recording A');
 delayed=false;await fixture.showRecording(fixture.B);assert.equal(fixture.state().selectedId,'B');assert.equal(fixture.state().src,'blob:B');
});

test('old audio ended while B is preparing cannot replace the explicit selection',async()=>{
 const gate=deferred(),started=deferred();let calls=0;const fixture=harness({blob:async(_store,job)=>{calls++;if(job.id==='B'){started.resolve();await gate.promise;}return {blob:{id:job.id}};}});fixture.B.next=1;fixture.A.next=2;fixture.A.passages=[{chapter:0},{chapter:1}];
 await fixture.showRecording(fixture.A);const pending=fixture.showRecording(fixture.B);await started.promise;await fixture.$('audio').onended();assert.equal(calls,2);gate.resolve();await pending;assert.equal(fixture.state().selectedId,'B');assert.equal(fixture.state().src,'blob:B');
});

test('Resume/Create final refresh cannot publish B identity after its actual player preparation failed',async()=>{
 let fail=false;const fixture=harness({blob:async(_store,job)=>{if(fail)throw Error('Synthetic saved player failure');return {blob:{id:job.id}};}});fixture.B.next=1;await fixture.showRecording(fixture.A);fail=true;
 Object.assign(fixture.context,{storageReady:true,navigator:{},synthesisClient:{idle(){}},audition:{stop(){}},refreshLibrary:async()=>assert.fail('failed view must not refresh selection'),withLease:async()=>assert.fail('failed view must not synthesize')});
 const create=main.slice(main.indexOf('async function createAudio('),main.indexOf('function quickListen('));vm.runInContext('let creating=false,quick=false,pauseRequested=false,cancelled=false,wake=null;'+create+'\nglobalThis.resume=createAudio;',fixture.context);
 await fixture.context.resume('B');assert.equal(fixture.state().selectedId,'A');assert.equal(fixture.state().title,'Recording A');assert.equal(fixture.state().src,'blob:A');
});
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

test('delayed ended-handler storage reads cannot restore the previous recording',{timeout:5000},async()=>{
 const gate=deferred(),started=deferred();let delay=false,fixture;
 fixture=harness({read:async id=>{if(delay&&id==='A'){started.resolve();await gate.promise;}return id==='A'?fixture.A:fixture.B;}});
 await fixture.showRecording(fixture.A);delay=true;const old=fixture.$('audio').onended();await started.promise;
 await fixture.showRecording(fixture.B);gate.resolve();await old;
 assert.equal(fixture.state().selectedId,'B');assert.equal(fixture.state().title,'Recording B');assert.equal(fixture.state().loadedJobId,null);
});

test('old ended handler cannot autoplay the newly selected recording after a deferred chapter load',{timeout:5000},async()=>{
 const gate=deferred(),started=deferred();let reads=0;
 const fixture=harness({blob:async()=>{if(++reads===2){started.resolve();await gate.promise;}return {blob:{id:'A'}};}});
 fixture.A.next=2;fixture.A.passages=[{chapter:0},{chapter:1}];await fixture.showRecording(fixture.A);
 const old=fixture.$('audio').onended();await started.promise;await fixture.showRecording(fixture.B);gate.resolve();await old;
 assert.equal(fixture.state().selectedId,'B');assert.ok(!fixture.actions.some(action=>action.play));
});
test('manual chapter navigation supersedes an ended handler with a deferred storage read',{timeout:5000},async()=>{
 const gate=deferred(),started=deferred();let delay=false,fixture;
 fixture=harness({read:async id=>{if(delay){delay=false;started.resolve();await gate.promise;}return id==='A'?fixture.A:fixture.B;}});
 fixture.A.next=3;fixture.A.passages=[{chapter:0},{chapter:1},{chapter:2}];await fixture.showRecording(fixture.A);
 delay=true;const old=fixture.$('audio').onended();await started.promise;await fixture.loadChapter(2);gate.resolve();await old;
 assert.equal(fixture.$('play-chapter').value,'2');assert.ok(!fixture.actions.some(action=>action.play));
});
