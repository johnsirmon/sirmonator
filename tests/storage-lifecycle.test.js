import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {openManagedDatabase} from '../src/idb-lifecycle.js';
import {openStorage} from '../src/storage.js';
import {makeRecording} from '../src/recording.js';
import {runRecording} from '../src/job-runner.js';
import {FOUNDATION_PIPELINE,currentManifest,assertSupportedManifest} from '../src/render-provenance.js';
import {parsePronunciation,LEGACY_PRONUNCIATION_MATCHER} from '../src/pronunciation.js';
import archived from '../src/render-contract-40459e2.json' with {type:'json'};
globalThis.IDBKeyRange=IDBKeyRange;
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const rawOpen=(name,version,upgrade)=>new Promise((resolve,reject)=>{const r=indexedDB.open(name,version);r.onupgradeneeded=()=>upgrade?.(r.result);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
test('blocked upgrade rejects visibly, aborts abandoned late upgrade and allows explicit retry without losing draft',async()=>{
 const name='blocked-'+crypto.randomUUID(),old=await rawOpen(name,1,db=>{db.createObjectStore('prefs');db.createObjectStore('jobs',{keyPath:'id'});db.createObjectStore('parts',{keyPath:['jobId','index']});db.createObjectStore('locks');});
 await new Promise((resolve,reject)=>{const tx=old.transaction('prefs','readwrite');tx.objectStore('prefs').put({text:'Keep original draft'},'draft');tx.oncomplete=resolve;tx.onabort=reject;});
 const states=[];await assert.rejects(openStorage(indexedDB,name,{onState:s=>states.push(s)}),{name:'StorageBlockedError'});
 assert.equal(states.at(-1).state,'blocked');assert.match(states.at(-1).message,/Close other tabs/);old.close();
 // A retry queues behind the abandoned open. Its transaction is aborted safely.
 const restored=await openStorage(indexedDB,name);assert.equal((await restored.draft()).text,'Keep original draft');restored.close();
});
test('timed out and aborted opens close delayed successes and never publish readiness',async()=>{
 for(const mode of ['timeout','abort']){
  const request={},events=[],abort=new AbortController();let closed=0;
  const pending=openManagedDatabase({factory:{open:()=>request},name:'synthetic',version:2,upgrade(){throw Error('Late upgrade must not run');},onState:s=>events.push(s.state),timeoutMs:10,signal:abort.signal});
  if(mode==='abort')abort.abort();await assert.rejects(pending,{name:mode==='timeout'?'StorageTimeoutError':'AbortError'});
  let aborted=0;request.transaction={abort(){aborted++;}};request.onupgradeneeded({});assert.equal(aborted,1);
  request.result={close(){closed++;}};request.onsuccess();assert.equal(closed,1);assert.equal(events.includes('ready'),false);
  request.onerror();
 }
});
test('versionchange guards subsequent operations and preserves committed passage plus draft',async()=>{
 const name='versionchange-'+crypto.randomUUID(),events=[],store=await openStorage(indexedDB,name,{onState:s=>events.push(s)});
 const job=await makeRecording('First paragraph.\n\nSecond paragraph.',{voice:'af_sarah',speed:1,delivery:'natural',edition:'refined'});
 await store.saveDraft({text:'Unchanged local draft'});await store.ensureJob(job);await store.claim('owner');
 const audio={bytes:new Uint8Array([1,2,3]),seconds:1,sampleRate:24000};await store.commit(job.id,0,audio,'owner');
 const gate=deferred(),started=deferred();let generations=0;
 const running=runRecording({store,id:job.id,owner:'owner',generate:async()=>{generations++;started.resolve();return gate.promise;}});await started.promise;
 const next=await rawOpen(name,3);assert.equal(events.at(-1).state,'versionchange');gate.resolve(audio);
 await assert.rejects(running,{name:'StorageClosedError'});assert.equal(generations,1);await assert.rejects(store.saveDraft({text:'Must not overwrite'}),{name:'StorageClosedError'});
 const check=await openManagedDatabase({factory:indexedDB,name,version:3,upgrade(){}}),tx=check.transaction(['jobs','parts','prefs']);
 const get=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 const [saved,parts,draft]=await Promise.all([get(tx.objectStore('jobs').get(job.id)),get(tx.objectStore('parts').getAll()),get(tx.objectStore('prefs').get('draft'))]);
 assert.equal(saved.next,1);assert.equal(parts.length,1);assert.equal(draft.text,'Unchanged local draft');next.close();check.close();
});
test('actual main lifecycle handler interrupts generation, editors and exports while preserving source',async()=>{
 const main=await readFile('src/main.js','utf8'),start=main.indexOf('function storageStateChanged('),end=main.indexOf('const audition=',start),elements=new Map(),calls=[];
 const $=id=>{if(!elements.has(id))elements.set(id,{textContent:'',value:id==='text'?'Current unsaved source':'',pause(){calls.push('pause');}});return elements.get(id);};
 const context=vm.createContext({$,storageReady:true,cancelled:false,pauseRequested:false,draftTimer:1,podcastSaveTimer:2,clearTimeout(){},beginSelection(){calls.push('cancel selections and exports');},killWorker(){calls.push('kill worker');},takeEditor:{cancel(){calls.push('cancel take');}},status:message=>calls.push(message),controls(){calls.push('controls');}});
 vm.runInContext(main.slice(start,end),context);context.storageStateChanged({state:'versionchange',message:'Close other tabs and retry'});
 assert.equal(context.storageReady,false);assert.equal(context.cancelled,true);assert.equal(context.pauseRequested,true);assert.equal($('text').value,'Current unsaved source');assert.match($('save-status').textContent,/unsaved/);
 for(const expected of ['cancel selections and exports','kill worker','cancel take','pause','controls'])assert.ok(calls.includes(expected));
});
test('storage-only contract bridge keeps archived original and pronunciation recordings resumable',()=>{
 for(const matcher of [null,LEGACY_PRONUNCIATION_MATCHER,'literal-unicode-token-longest-v2']){
  const settings={voice:'af_sarah',speed:1,edition:'refined',delivery:'natural',pipeline:FOUNDATION_PIPELINE,...(matcher?{pronunciation:{...parsePronunciation('Paul => pawl'),matcher}}:{})};
  const manifest=currentManifest(settings);manifest.source=archived.source;assertSupportedManifest({...settings,renderManifest:manifest});
 }
});
test('actual bootstrap retries a failed open without replacing an unsaved draft',async()=>{
 const main=await readFile('src/main.js','utf8'),start=main.indexOf('async function initialize(){'),end=main.indexOf('\npronunciationEditor=createPronunciationEditor',start),elements=new Map();let attempts=0;
 const $=id=>{if(!elements.has(id))elements.set(id,{value:id==='text'?'Current unsaved exact text':'',textContent:''});return elements.get(id);};
 const context=vm.createContext({$,storageOpening:false,storageReady:false,store:null,dirty:true,selectionToken:0,
  controls(){},beginSelection(){return ++context.selectionToken;},storageStateChanged(){},
  async openStorage(){attempts++;if(attempts===1)throw Object.assign(Error('Close other tabs, then retry local storage.'),{name:'StorageBlockedError'});return {close(){},async draft(){return {text:'Older saved text'};}};},
  narratorNote(){},async refreshLibrary(){return [];},navigator:{storage:{}},status(){},warn:e=>e.message,busy:()=>false});
 vm.runInContext(main.slice(start,end),context);await context.initialize();assert.equal(context.storageReady,false);assert.equal(context.storageOpening,false);assert.match($('storage-state').textContent,/retry/);
 await $('retry-storage').onclick();assert.equal(attempts,2);assert.equal(context.storageReady,true);assert.equal($('text').value,'Current unsaved exact text');assert.match($('save-status').textContent,/current draft was kept/);
});
test('unexpected close notifies once and rejects new transactions while explicit close stays quiet',async()=>{
 let request,closes=0;const events=[],db={close(){closes++;},transaction(){return 'transaction';}};
 const pending=openManagedDatabase({factory:{open(){return request={};}},name:'close-fixture',version:2,upgrade(){},onState:s=>events.push(s.state)});
 request.result=db;request.onsuccess();const connection=await pending;assert.equal(connection.transaction('prefs'),'transaction');db.onclose();db.onclose();
 assert.equal(events.filter(x=>x==='closed').length,1);assert.throws(()=>connection.transaction('prefs'),{name:'StorageClosedError'});assert.equal(closes,1);
});
test('newer database version explains backup and compatible reload instead of retry loop',async()=>{
 const name='newer-'+crypto.randomUUID(),newer=await rawOpen(name,3);newer.close();const events=[];
 await assert.rejects(openStorage(indexedDB,name,{onState:s=>events.push(s)}),error=>error.name==='StorageVersionError'&&/unsaved text backup/.test(error.message)&&/Retry cannot downgrade/.test(error.message));assert.equal(events.at(-1).state,'versionerror');
});
test('late draft save cannot overwrite an invalidation warning or acknowledge a newer draft',async()=>{
 const main=await readFile('src/main.js','utf8'),flush=main.slice(main.indexOf('async function flushDraft(){'),main.indexOf('function queueSave()')),
  lifecycle=main.slice(main.indexOf('function storageStateChanged('),main.indexOf('const audition=')),save=deferred(),started=deferred(),elements=new Map();
 const $=id=>{if(!elements.has(id))elements.set(id,{checked:true,textContent:'',pause(){}});return elements.get(id);};
 const context=vm.createContext({$,storageReady:true,store:{async saveDraft(){started.resolve();await save.promise;}},draftRevision:1,saveChain:Promise.resolve(),draftTimer:0,podcastSaveTimer:0,clearTimeout(){},draft:()=>({text:'Draft A'}),MAX_DOCUMENT:2000000,warn:e=>e.message,cancelled:false,pauseRequested:false,beginSelection(){},killWorker(){},takeEditor:null,status(){},controls(){}});
 vm.runInContext(flush+'\n'+lifecycle,context);const pending=context.flushDraft();await started.promise;
 context.draftRevision=2;context.storageStateChanged({state:'versionchange',message:'Connection changed'});const warning=$('save-status').textContent;save.resolve();await pending;assert.equal($('save-status').textContent,warning);assert.match(warning,/unsaved/);
 const next=deferred();context.storageReady=true;context.store={saveDraft:()=>next.promise};const newer=context.flushDraft();await tick();context.draftRevision=3;$('save-status').textContent='Saving newer draft B';next.resolve();await newer;assert.equal($('save-status').textContent,'Saving newer draft B');
});
