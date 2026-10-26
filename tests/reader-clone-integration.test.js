import test from 'node:test';
import assert from 'node:assert/strict';
import {attachOptionalClone} from '../src/reader-flow.js';
import {createClonePanel} from '../src/cloning/panel.js';
import {CLONE_CONTRACT} from '../src/cloning/contract.js';
import {encodeWav} from '../src/core.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(generate){
 const nodes=new Map(),root={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,Object.assign(new EventTarget(),{value:'',checked:false,files:[],hidden:true,disabled:false,textContent:'',pause(){},load(){},removeAttribute(name){delete this[name];},click(){if(!this.disabled)this.onclick?.();}}));return nodes.get(selector);}},$=id=>root.querySelector('#clone-'+id);
 let destroyed=0;const panel=createClonePanel({root,engineFactory:async()=>({sampleRate:24000,referenceContract:structuredClone(CLONE_CONTRACT),async cloneVoice(_pcm,{name}){return name;},generate,destroy(){destroyed++;}})});
 $('permission').checked=true;$('authority').value='synthetic';$('text').value='Synthetic stage integration.';$('file').files=[new Blob([encodeWav([Float32Array.from({length:72000},(_,i)=>.1*Math.sin(i/10))],24000)])];
 const manual={value:'Untouched supplied transcript'},voice={children:[],append(node){this.children.push(node);}},document={getElementById(id){return id==='local-cloning'?root:id==='review-transcript'?manual:id.startsWith('clone-')?root.querySelector('#'+id):null;}};
 return {$,root,panel,manual,voice,route:attachOptionalClone(document,voice),get destroyed(){return destroyed;}};
}
test('Voice owns the same cloning root; navigating away cancels actual pending panel and rejects late publication',async()=>{
 const gate=deferred(),started=deferred(),f=fixture(async(_text,{onChunk})=>{started.resolve();await gate.promise;onChunk(new Float32Array([0,.1,0]));return {};});
 try{assert.equal(f.voice.children[0],f.root);const running=f.$('generate').onclick();await started.promise;f.route('choose-voice');assert.equal(f.panel.busy,true);f.route('create-audio');await running;assert.equal(f.panel.busy,false);assert.equal(f.destroyed,1);assert.match(f.$('status').textContent,/Cancelled/);assert.equal(f.$('output').hidden,true);assert.equal(f.manual.value,'Untouched supplied transcript');gate.resolve();await new Promise(r=>setImmediate(r));assert.equal(f.$('output').hidden,true);}finally{gate.resolve();f.panel.dispose();}
});
test('completed session preview survives stage navigation without clearing manual review or reusing a worker',async()=>{
 const f=fixture(async(_text,{onChunk})=>{onChunk(new Float32Array([0,.1,0]));return {};});try{await f.$('generate').onclick();const url=f.$('audio').src;assert.equal(f.$('output').hidden,false);assert.equal(f.$('cancel').disabled,true);for(const stage of ['listen','add-text','choose-voice'])f.route(stage);assert.equal(f.$('audio').src,url);assert.equal(f.$('output').hidden,false);assert.equal(f.manual.value,'Untouched supplied transcript');assert.equal(f.destroyed,1);}finally{f.panel.dispose();}
});
test('stage navigation without the optional clone panel changes no other controls',()=>{
 let appends=0,reads=0;const route=attachOptionalClone({getElementById:()=>{reads++;return null;}},{append(){appends++;}});for(const stage of ['add-text','choose-voice','create-audio','listen'])route(stage);assert.equal(appends,0);assert.equal(reads,5);
});
