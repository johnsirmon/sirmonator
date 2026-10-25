import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {openReferenceStorage} from '../src/reference-storage.js';
import {openReviewStorage} from '../src/review-storage.js';
import {createRepositoryAccess} from '../src/repository-access.js';
import {prepareReference} from '../src/reference-provider.js';
import {encodeWav} from '../src/core.js';
import {captureReview} from '../src/speech-review.js';
import {chapterFixture} from '../scripts/chapter-benchmark-fixture.mjs';
import {createReferenceEditor} from '../src/reference-editor.js';
globalThis.IDBKeyRange=IDBKeyRange;
const rawOpen=(name,version)=>new Promise((resolve,reject)=>{const request=indexedDB.open(name,version);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const value=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
for(const [kind,open] of [['reference',openReferenceStorage],['review',openReviewStorage]])test(`${kind} blocked open rejects and closes an abandoned late connection`,async()=>{
 let request,closed=0;const pending=open({open(){return request={};}},'synthetic-blocked');request.onblocked();await assert.rejects(pending,{name:'StorageBlockedError'});request.result={close(){closed++;}};request.onsuccess();assert.equal(closed,1);
});
test('both side databases close on versionchange, preserve saved records and reject incompatible reopen',async()=>{
 const file=new Blob([encodeWav([Float32Array.from({length:72000},(_,i)=>.1*Math.sin(i*.1))],24000)]),receipt=await prepareReference(file,{label:'Synthetic fixture',authority:'synthetic',scope:'Local tests only',provenance:'Procedural test tone; CC0-1.0; no person.',permission:true,aiDisclosure:true});
 const refName='reference-lifecycle-'+crypto.randomUUID(),reviewName='review-lifecycle-'+crypto.randomUUID(),events=[],ref=await openReferenceStorage(indexedDB,refName,{onState:s=>events.push(s)}),review=await openReviewStorage(indexedDB,reviewName,{onState:s=>events.push(s)});
 await ref.save(receipt,0);const fixture=await chapterFixture(3),snapshot=await captureReview(fixture.store,fixture.job.id,0),payload={schema:1,snapshot,transcript:snapshot.spoken,notes:'Keep these manual synthetic notes',listenedByUser:false,noWordsHeard:false,automaticTranscription:false,audioVerified:false,comparison:null};await review.save(payload);
 const a=await rawOpen(refName,2),b=await rawOpen(reviewName,2);assert.equal(ref.active,false);assert.equal(review.active,false);await assert.rejects(ref.load(),{name:'StorageClosedError'});await assert.rejects(review.load(snapshot),{name:'StorageClosedError'});
 assert.equal((await value(a.transaction('metadata').objectStore('metadata').get('current'))).receipt.id,receipt.id);
 assert.equal((await value(b.transaction('reviews').objectStore('reviews').get([fixture.job.id,snapshot.key]))).payload.notes,payload.notes);a.close();b.close();
 await assert.rejects(openReferenceStorage(indexedDB,refName),{name:'StorageVersionError'});await assert.rejects(openReviewStorage(indexedDB,reviewName),{name:'StorageVersionError'});assert.equal(events.filter(s=>s.state==='versionchange').length,2);
});
test('repository access retries rejected opens and reconnects inactive factories once',async()=>{
 let calls=0;const active={active:true},get=createRepositoryAccess(undefined,async()=>{calls++;if(calls===1)throw Error('Blocked');return active;});await assert.rejects(get(),/Blocked/);assert.equal(await get(),active);assert.equal(calls,2);
 active.active=false;const next={active:true},other=createRepositoryAccess(()=>calls++===2?active:next,()=>{});assert.equal(await other(),next);assert.equal(calls,4);
 const fixed=createRepositoryAccess(active,()=>{throw Error('Must not replace explicit object');});await assert.rejects(fixed(),/reload the page/);
});
test('reference editor Reload retries a failed open without clearing unsaved consent fields',async()=>{
 const map=new Map(),$=id=>{if(!map.has(id))map.set(id,{value:'',disabled:false,textContent:'',checked:false,addEventListener(){}});return map.get(id);};let calls=0;
 const editor=createReferenceEditor({$,repository:async()=>{if(++calls===1)throw Error('Synthetic blocked open');return {active:true,async load(){return {schema:1,version:0,receipt:null};}};}});await editor.ready;
 $('reference-scope').value='Keep this unsaved permitted use';assert.match($('reference-status').textContent,/blocked/);await $('reference-reload').onclick();assert.equal(calls,2);assert.equal($('reference-scope').value,'Keep this unsaved permitted use');assert.match($('reference-status').textContent,/Saved metadata loaded/);
});
