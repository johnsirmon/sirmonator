import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceImporter} from '../src/source-importer.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture({read,persist=async()=>{}}={}){let revision=0,text='Current draft',status='',reading=false;const importer=createSourceImporter({read,getRevision:()=>revision,onIntent:()=>revision++,onReading:value=>reading=value,apply:result=>{text=result.text;revision++;},persist,notify:value=>status=value});return {importer,get text(){return text;},get status(){return status;},get reading(){return reading;},edit(value){text=value;revision++;status='New edit';}};}
test('cancel releases controls immediately and a late native read cannot overwrite edited text',async()=>{
 const gate=deferred();let signal;const state=fixture({read:(_file,options)=>{signal=options.signal;return gate.promise;}}),pending=state.importer.start({name:'synthetic.txt'});assert.equal(state.reading,true);state.importer.cancel();state.edit('Newer source');await pending;assert.equal(signal.aborted,true);assert.equal(state.reading,false);gate.resolve({text:'Old result'});await Promise.resolve();assert.equal(state.text,'Newer source');assert.equal(state.status,'New edit');
});
test('replacing an in-flight import ignores older success or failure and keeps the new read busy',async()=>{
 for(const fail of [false,true]){const a=deferred(),b=deferred(),state=fixture({read:file=>file.name==='A'?a.promise:b.promise}),first=state.importer.start({name:'A'}),second=state.importer.start({name:'B'});fail?a.reject(Error('late error')):a.resolve({text:'A'});await first;assert.equal(state.reading,true);b.resolve({text:'B'});await second;assert.equal(state.text,'B');assert.equal(state.reading,false);assert.match(state.status,/Document loaded/);}
});
test('a changed revision while reading discards the result instead of applying it',async()=>{
 const gate=deferred(),state=fixture({read:()=>gate.promise}),pending=state.importer.start({});state.edit('User edit');gate.resolve({text:'Old result'});await pending;assert.equal(state.text,'User edit');assert.match(state.status,/discarded.*current text was kept/);
});
test('late save completion or failure cannot overwrite the status of newer draft edits',async()=>{
 for(const fail of [false,true]){const save=deferred(),state=fixture({read:async()=>({text:'Imported'}),persist:()=>save.promise}),pending=state.importer.start({});await new Promise(setImmediate);assert.equal(state.reading,false);assert.equal(state.text,'Imported');state.edit('Later edit');fail?save.reject(Error('quota')):save.resolve();await pending;assert.equal(state.text,'Later edit');assert.equal(state.status,'New edit');}
});
test('read failure keeps source while failed persistence accurately identifies already loaded text',async()=>{
 const state=fixture({read:async()=>{throw Error('bad encoding');}});await state.importer.start({});assert.equal(state.text,'Current draft');assert.match(state.status,/not loaded.*kept.*bad encoding/);
 const loaded=fixture({read:async()=>({text:'Loaded source'}),persist:async()=>{throw Error('quota');}});await loaded.importer.start({});assert.equal(loaded.text,'Loaded source');assert.match(loaded.status,/Loaded text remains visible.*saving failed.*quota/);
});
