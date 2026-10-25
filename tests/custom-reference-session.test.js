import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeWav} from '../src/core.js';
import {prepareReference} from '../src/reference-provider.js';
import {createCustomReferenceSession} from '../scripts/custom-reference-session.mjs';
import {CUSTOM_REFERENCE_CONTRACT} from '../scripts/custom-reference-contract.mjs';
import {createPocketNode} from '../scripts/pocket-node.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const fixture=async()=>{
 const wav=encodeWav([Float32Array.from({length:72000},(_,i)=>.1*Math.sin(i*2*Math.PI*220/24000))],24000),file=new Blob([wav]);
 const receipt=await prepareReference(file,{label:'CC0 procedural fixture',authority:'synthetic',scope:'Synthetic runtime test only.',provenance:'Procedural sine wave generated in this test; no person; CC0-1.0.',permission:true,aiDisclosure:true});
 return {file,receipt};
};
function fake(overrides={}){
 const engine={sampleRate:24000,referenceContract:structuredClone(CUSTOM_REFERENCE_CONTRACT),destroyed:false,
  async cloneVoice(pcm,{name}){assert.equal(pcm.length,72000);return name;},
  async generate(text,{voice,onChunk}){assert.ok(voice.startsWith('synthetic:'));onChunk(new Float32Array([.1,.2,0]));return {audioDuration:3/24000};},
  destroy(){this.destroyed=true;},async waitForTerminations(){},...overrides};
 return {engine,session:createCustomReferenceSession({engineFactory:async()=>engine})};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('custom reference session binds exact validated bytes and immutable synthetic identity',async()=>{
 const {file,receipt}=await fixture(),{engine,session}=fake();let retained;
 engine.cloneVoice=async(pcm,{name})=>{retained=pcm;return name;};
 await session.prepare(file,receipt);assert.ok(retained.every(x=>x===0));
 receipt.consent.label='Changed outside session';const out=await session.generate('Exact test text.');
 assert.deepEqual([...out.samples],[Math.fround(.1),Math.fround(.2),0]);
 assert.equal(out.provenance.text,'Exact test text.');assert.equal(out.provenance.consent.label,'CC0 procedural fixture');
 assert.equal(out.provenance.contract.resumable,false);assert.equal(out.provenance.contract.personalSynthesisEnabled,false);
 session.revoke();await session.waitForDisposal();assert.equal(engine.destroyed,true);await assert.rejects(session.generate('Later'),{name:'AbortError'});
});
test('custom reference rejects changed file, personal receipt and unsupported contract before output',async()=>{
 const {file,receipt}=await fixture();let created=0;
 const s=createCustomReferenceSession({engineFactory:async()=>{created++;throw Error('Must not load');}});
 const changed=new Uint8Array(await file.arrayBuffer());changed[100]^=1;
 await assert.rejects(s.prepare(new Blob([changed]),receipt),/do not match/);assert.equal(created,0);
 const personal=await prepareReference(file,{...receipt.consent,authority:'self',permission:true,aiDisclosure:true});
 await assert.rejects(fake().session.prepare(file,personal),/synthetic fixtures only/);
 const {engine,session}=fake();engine.referenceContract.artifact='future';
 await assert.rejects(session.prepare(file,receipt),/Unsupported custom-reference/);assert.equal(engine.destroyed,true);
 await assert.rejects(createPocketNode({route:'custom-reference-v1'}),/offline mode/);
});
test('reference cancellation during deferred file read never loads runtime',async()=>{
 const {file,receipt}=await fixture(),read=deferred(),abort=new AbortController();let loads=0;
 const session=createCustomReferenceSession({engineFactory:async()=>{loads++;}});
 const pending=session.prepare({size:file.size,arrayBuffer:()=>read.promise},receipt,{signal:abort.signal});
 await new Promise(r=>setTimeout(r,10));abort.abort();await assert.rejects(pending,{name:'AbortError'});
 read.resolve(await file.arrayBuffer());await new Promise(r=>setImmediate(r));assert.equal(loads,0);
});
test('late runtime after revocation is destroyed and never enrolled',async()=>{
 const {file,receipt}=await fixture(),load=deferred(),entered=deferred();let cloned=false;
 const {engine}=fake({async cloneVoice(){cloned=true;}});
 const session=createCustomReferenceSession({engineFactory:()=>{entered.resolve();return load.promise;}});
 const pending=session.prepare(file,receipt);await entered.promise;session.revoke();await assert.rejects(pending,{name:'AbortError'});
 load.resolve(engine);await new Promise(r=>setImmediate(r));await session.waitForDisposal();
 assert.equal(engine.destroyed,true);assert.equal(cloned,false);
});
test('disposal requested before factory completion waits for late runtime termination',async()=>{
 const {file,receipt}=await fixture(),load=deferred(),entered=deferred(),termination=deferred();
 const {engine}=fake({waitForTerminations:()=>termination.promise});
 const session=createCustomReferenceSession({engineFactory:()=>{entered.resolve();return load.promise;}});
 const pending=session.prepare(file,receipt);await entered.promise;session.revoke();await assert.rejects(pending,{name:'AbortError'});
 let disposed=false;const waiting=session.waitForDisposal().then(()=>{disposed=true;});
 await new Promise(r=>setImmediate(r));assert.equal(disposed,false);assert.equal(engine.destroyed,false);
 load.resolve(engine);await new Promise(r=>setImmediate(r));assert.equal(engine.destroyed,true);assert.equal(disposed,false);
 termination.resolve();await waiting;assert.equal(disposed,true);
});
test('cancellation during conditioning clears input and rejects late completion',async()=>{
 const {file,receipt}=await fixture(),work=deferred(),entered=deferred(),abort=new AbortController();let input;
 const {engine,session}=fake({cloneVoice(pcm,{name}){input=pcm;entered.resolve();return work.promise.then(()=>name);}});
 const pending=session.prepare(file,receipt,{signal:abort.signal});await entered.promise;abort.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(engine.destroyed,true);assert.ok(input.every(x=>x===0));work.resolve();
});
test('cancelled generation cannot publish partial or late chunks and concurrent calls are rejected',async()=>{
 const {file,receipt}=await fixture(),work=deferred(),entered=deferred();let late;
 const {engine,session}=fake({generate(text,{onChunk}){late=onChunk;onChunk(new Float32Array([.1]));entered.resolve();return work.promise;}});
 await session.prepare(file,receipt);const pending=session.generate('Exact text.');await entered.promise;
 await assert.rejects(session.generate('Concurrent'),/already running/);session.revoke();
 await assert.rejects(pending,{name:'AbortError'});late(new Float32Array([.2]));work.resolve({});assert.equal(engine.destroyed,true);
});
test('invalid and excessive generated PCM dispose the in-memory runtime',async()=>{
 const {file,receipt}=await fixture();
 for(const samples of [new Float32Array([NaN]),new Float32Array([1.1]),new Float32Array(24000*60+1)]){
  const {engine,session}=fake({async generate(t,{onChunk}){onChunk(samples);return {};}});
  await session.prepare(file,receipt);await assert.rejects(session.generate('Test'));assert.equal(engine.destroyed,true);
 }
});
test('actual Node bridge stops cooperatively before native termination and suppresses late output',async()=>{
 const source=await readFile('scripts/pocket-node.mjs','utf8'),start=source.indexOf('  class BridgeWorker{'),end=source.indexOf('  const previous=',start),sent=[],handlers={};let terminated=0,published=0;
 class Worker{on(type,fn){handlers[type]=fn;}postMessage(data){sent.push(data);}async terminate(){terminated++;return 0;}}
 const context=vm.createContext({NodeWorker:Worker,pathToFileURL:x=>x,resolve:(...x)=>x.join('/'),runtimeCache:'test',custom:true,terminations:[],Promise,Set,Error});
 vm.runInContext(source.slice(start,end)+'\nglobalThis.Bridge=BridgeWorker;',context);
 const bridge=new context.Bridge();bridge.onmessage=()=>published++;bridge.postMessage({id:1,type:'generate'});
 const disposed=bridge.terminate();assert.equal(terminated,0);assert.equal(sent.at(-1).type,'stop');
 handlers.message({id:1,type:'chunk'});assert.equal(published,0);handlers.message({id:-1,type:'result'});assert.equal(terminated,0);
 handlers.message({id:1,type:'result'});await disposed;assert.equal(terminated,1);assert.throws(()=>bridge.postMessage({id:2}),/disposing/);
});
test('actual Node bridge removes a failed native send before disposal',async()=>{
 const source=await readFile('scripts/pocket-node.mjs','utf8'),start=source.indexOf('  class BridgeWorker{'),end=source.indexOf('  const previous=',start);let terminated=0;
 const failure=Error('Native postMessage failed');class Worker{on(){}postMessage(){throw failure;}async terminate(){terminated++;return 0;}}
 const context=vm.createContext({NodeWorker:Worker,pathToFileURL:x=>x,resolve:(...x)=>x.join('/'),runtimeCache:'test',custom:true,terminations:[],Promise,Set,Error});
 vm.runInContext(source.slice(start,end)+'\nglobalThis.Bridge=BridgeWorker;',context);const bridge=new context.Bridge();
 assert.throws(()=>bridge.postMessage({id:1,type:'generate'}),e=>e===failure);assert.equal(bridge.active.size,0);
 await bridge.terminate();assert.equal(terminated,1);
});
