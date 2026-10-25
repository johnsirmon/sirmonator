import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {openStorage} from '../src/storage.js';
import {chapterFixture} from '../scripts/chapter-benchmark-fixture.mjs';
import {spokenPassage} from '../src/pronunciation.js';
import {recordingBlob} from '../src/job-runner.js';
import {changePassage} from '../src/passage-takes.js';
import {createNodeExportWorker} from '../scripts/export-node.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
globalThis.IDBKeyRange=IDBKeyRange;
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(){
 const source=await chapterFixture(3),fault={armed:false},factory={open(...args){const request=indexedDB.open(...args);request.addEventListener('success',()=>{const db=request.result,transaction=db.transaction.bind(db);db.transaction=(...args)=>{const tx=transaction(...args),objectStore=tx.objectStore.bind(tx);tx.objectStore=name=>{const store=objectStore(name);if(!store.quotaWrapped){store.quotaWrapped=true;const put=store.put.bind(store);store.put=(...values)=>{if(name==='jobs'&&fault.armed){fault.armed=false;throw new DOMException('Injected storage quota exhaustion','QuotaExceededError');}return put(...values);};}return store;};return tx;};});return request;}},store=await openStorage(factory,'quota-'+crypto.randomUUID());
 const job={...source.job,next:0,bytes:0,seconds:0,state:'paused'};delete job.takeSelection;await store.ensureJob(job);await store.claim('owner');
 const audio=async index=>{const part=source.parts[index],p=job.passages[index];return {...part,bytes:await part.blob.arrayBuffer(),renderManifest:job.settings.renderManifest,spokenText:spokenPassage(job.source.slice(p.start,p.end),job.settings.pronunciation).text};};
 return {store,job,fault,audio};
}
test('quota after queued audio add rolls back the whole passage and retry cannot duplicate parts',async()=>{
 const {store,job,fault,audio}=await fixture();try{
  const first=await store.commit(job.id,0,await audio(0),'owner'),before=await recordingBlob(store,first,null,undefined,{createWorker:createNodeExportWorker});fault.armed=true;
  await assert.rejects(store.commit(job.id,1,await audio(1),'owner'),{name:'QuotaExceededError'});await tick();assert.equal((await store.job(job.id)).next,1);assert.equal((await store.parts(job.id)).length,1);
  const partial=await recordingBlob(store,await store.job(job.id),null,undefined,{createWorker:createNodeExportWorker});assert.deepEqual(await partial.blob.arrayBuffer(),await before.blob.arrayBuffer());
  const resumed=await store.commit(job.id,1,await audio(1),'owner');assert.equal(resumed.next,2);await store.commit(job.id,1,await audio(1),'owner');assert.equal((await store.parts(job.id)).length,2);
 }finally{store.close();}
});
test('quota during take selection rolls back alternative and revision; retry adds exactly one take',async()=>{
 const {store,job,fault,audio}=await fixture();try{
  for(let i=0;i<3;i++)await store.commit(job.id,i,await audio(i),'owner');const original=(await store.parts(job.id))[1].blob;fault.armed=true;
  const generate=()=>audio(1);await assert.rejects(changePassage({store,id:job.id,index:1,owner:'owner',revision:0,generate}),{name:'QuotaExceededError'});assert.equal((await store.takes(job.id)).length,0);assert.equal((await store.job(job.id)).takeSelection,undefined);
  const retried=await changePassage({store,id:job.id,index:1,owner:'owner',revision:0,generate});assert.equal(retried.takeSelection.revision,1);assert.equal((await store.takes(job.id)).length,1);assert.deepEqual(await (await store.part(job.id,1)).blob.arrayBuffer(),await original.arrayBuffer());
 }finally{store.close();}
});
test('optional timing quota and observer exceptions never block intact audio export',async()=>{
 const {store,job,audio}=await fixture();try{
  const saved=await store.commit(job.id,0,await audio(0),'owner'),expected=await recordingBlob(store,saved,null,undefined,{createWorker:createNodeExportWorker});let observed=0;
  const result=await recordingBlob({...store,async savePreparation(){throw new DOMException('Quota','QuotaExceededError');}},saved,null,undefined,{createWorker:createNodeExportWorker,onMetrics(){throw Error('Optional timing observer failed');},onMetricPersistenceError(){observed++;throw Error('Optional failure observer failed');}});
  assert.equal(result.metricsPersisted,false);assert.equal(observed,1);assert.deepEqual(await result.blob.arrayBuffer(),await expected.blob.arrayBuffer());
 }finally{store.close();}
});
test('unresponsive optional timing write is bounded without cancelling prepared audio',async()=>{
 const {store,job,audio}=await fixture(),entered=deferred(),controller=new AbortController();let guard;
 try{const saved=await store.commit(job.id,0,await audio(0),'owner'),pending=recordingBlob({...store,savePreparation(){entered.resolve();return new Promise(()=>{});}},saved,null,undefined,{createWorker:createNodeExportWorker,signal:controller.signal,metricTimeoutMs:5});await entered.promise;guard=setTimeout(()=>controller.abort(),250);const artifact=await pending;assert.ok(artifact.blob.size);assert.equal(artifact.metricsPersisted,false);assert.equal(controller.signal.aborted,false);}
 finally{clearTimeout(guard);controller.abort();store.close();}
});
test('quota warning reports recovery and preserved committed passages',async()=>{
 const main=await readFile('src/main.js','utf8'),line=main.split('\n').find(line=>line.startsWith('const warn=')),context=vm.createContext({});vm.runInContext(line+'\nglobalThis.warning=warn;',context);assert.match(context.warning(new DOMException('Quota','QuotaExceededError')),/Saved passages are safe.*Download.*resume/);
});
test('cancel during optional timing persistence rejects the export and aborts its write signal',async()=>{
 const {store,job,audio}=await fixture(),entered=deferred(),controller=new AbortController();let writeSignal,observed=0;
 try{const saved=await store.commit(job.id,0,await audio(0),'owner'),pending=recordingBlob({...store,savePreparation(_id,_value,{signal}){writeSignal=signal;entered.resolve();return new Promise(()=>{});}},saved,null,undefined,{createWorker:createNodeExportWorker,signal:controller.signal,onMetricPersistenceError(){observed++;}});await entered.promise;controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(writeSignal.aborted,true);assert.equal(observed,0);assert.equal((await store.job(job.id)).next,1);}
 finally{controller.abort();store.close();}
});
test('preparation writes honor an already aborted signal without altering recording metadata',async()=>{
 const {store,job,audio}=await fixture(),controller=new AbortController();try{await store.commit(job.id,0,await audio(0),'owner');controller.abort();await assert.rejects(store.savePreparation(job.id,{metrics:{unexpected:true}},{signal:controller.signal}),{name:'AbortError'});assert.equal((await store.job(job.id)).preparations,undefined);assert.equal((await store.job(job.id)).next,1);}finally{store.close();}
});
