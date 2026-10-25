import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {makeRecording} from '../src/recording.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';
import {assertSupportedManifest,currentManifest} from '../src/render-provenance.js';
import archived from '../src/render-contract-59fbedd.json' with {type:'json'};

const source=await readFile('src/storage-usage.js','utf8'),context=vm.createContext({Blob,TextEncoder,ArrayBuffer});
vm.runInContext(source.slice(source.indexOf('function metadataBytes('),source.indexOf('// One readonly'))+'\nglobalThis.measure=metadataBytes;',context);
test('every sparse or undefined array slot consumes metadata budget before traversal can grow',()=>{
 for(const array of [new Array(1000000),Array(10).fill(undefined)]){
  let reads=0,checks=0;const observed=new Proxy(array,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver);}});
  assert.throws(()=>context.measure(observed,{nodes:1,units:0},()=>checks++),/budget exceeded/);
  assert.equal(reads,1);assert.equal(checks,1);
 }
});
test('small sparse arrays retain truthful JSON byte counts and periodic cancellation checks',()=>{
 for(const array of [new Array(3),[undefined,null,'é',,2]])assert.equal(context.measure(array,{nodes:100,units:100},()=>{}),new TextEncoder().encode(JSON.stringify(array)).length);
 let checks=0;assert.throws(()=>context.measure(new Array(1000),{nodes:2000,units:0},()=>{checks++;throw Error('cancelled');}),/cancelled/);assert.equal(checks,1);
});
test('the prior storage build remains resumable with its frozen Word boundary manifest',async()=>{
 const settings={voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE,boundaryPolicy:'word-grapheme-240-v2'};
 const manifest=currentManifest(settings);manifest.source=archived.source;
 const job=await makeRecording('Synthetic words stay frozen.',{...settings,renderManifest:manifest});assertSupportedManifest(job.settings);
});
