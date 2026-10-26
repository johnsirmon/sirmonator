import test from 'node:test';
import assert from 'node:assert/strict';
import {createClonePanel} from '../src/cloning/panel.js';
import {CLONE_CONTRACT} from '../src/cloning/contract.js';
import {encodeWav} from '../src/core.js';
function fixture(factory){
 const nodes=new Map();
 const root={querySelector(id){if(!nodes.has(id))nodes.set(id,Object.assign(new EventTarget(),{value:'',checked:false,files:[],hidden:true,disabled:false,textContent:'',pause(){},load(){},removeAttribute(name){delete this[name];}}));return nodes.get(id);}};
 const $=id=>root.querySelector('#clone-'+id),panel=createClonePanel({root,engineFactory:factory});
 $('permission').checked=true;$('authority').value='synthetic';$('text').value='Synthetic local test.';
 $('file').files=[new Blob([encodeWav([Float32Array.from({length:72000},(_,i)=>.1*Math.sin(i/10))],24000)])];
 return {$,panel};
}
const runtime=overrides=>({sampleRate:24000,referenceContract:structuredClone(CLONE_CONTRACT),async cloneVoice(pcm,{name}){return name;},async generate(text,{onChunk}){onChunk(new Float32Array([0,.1,-.1]));return {};},destroy(){this.destroyed=true;},...overrides});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('panel rejects missing attestation before runtime; successful repeated readings revoke URLs on forget',async()=>{
 let loads=0;const f=fixture(async()=>{loads++;return runtime();});
 try{f.$('permission').checked=false;await f.$('generate').onclick();assert.match(f.$('status').textContent,/Confirm/);assert.equal(loads,0);
  f.$('permission').checked=true;await f.$('generate').onclick();assert.equal(f.$('output').hidden,false);const first=f.$('download').href;assert.equal((await fetch(first)).status,200);
  await f.$('generate').onclick();assert.equal(loads,2);await assert.rejects(fetch(first));assert.equal(f.$('output').hidden,false);
  const second=f.$('download').href;f.$('forget').onclick();assert.equal(f.$('output').hidden,true);assert.equal(f.$('permission').checked,false);assert.equal(f.$('text').value,'');await assert.rejects(fetch(second));
 }finally{f.panel.dispose();}
});
test('panel cancel discards late runtime and retry publishes only the replacement operation',async()=>{
 const entered=deferred(),late=deferred();let calls=0;const old=runtime();
 const f=fixture(async()=>{if(++calls===1){entered.resolve();return late.promise;}return runtime();});
 try{const pending=f.$('generate').onclick();await entered.promise;f.$('cancel').onclick();assert.equal(f.panel.busy,false);
  await f.$('generate').onclick();assert.equal(f.$('output').hidden,false);const latest=f.$('download').href;
  late.resolve(old);await pending;await new Promise(r=>setImmediate(r));assert.equal(old.destroyed,true);assert.equal(f.$('download').href,latest);
 }finally{f.panel.dispose();}
});
test('revoke during generation suppresses late output, clears attestation and file',async()=>{
 const entered=deferred(),late=deferred();const engine=runtime({async generate(text,{onChunk}){entered.resolve();await late.promise;onChunk(new Float32Array([.1]));return {};}});
 const f=fixture(async()=>engine);
 try{const pending=f.$('generate').onclick();await entered.promise;f.$('revoke').onclick();late.resolve();await pending;
  assert.equal(engine.destroyed,true);assert.equal(f.$('output').hidden,true);assert.equal(f.$('permission').checked,false);assert.equal(f.$('file').value,'');assert.match(f.$('status').textContent,/revoked/);
 }finally{f.panel.dispose();}
});
test('runtime errors leave retry available and never expose an output',async()=>{
 const f=fixture(async()=>{throw Error('Model unavailable');});
 try{await f.$('generate').onclick();assert.match(f.$('status').textContent,/Model unavailable/);assert.equal(f.panel.busy,false);assert.equal(f.$('generate').disabled,false);assert.equal(f.$('output').hidden,true);}finally{f.panel.dispose();}
});
