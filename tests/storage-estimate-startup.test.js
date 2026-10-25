import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {browserStorageEstimate,storageEstimateText} from '../src/storage-usage.js';
for(const mode of ['rejected','stalled'])test('actual startup restores local data even when optional estimate is '+mode,async()=>{
 const main=await readFile('src/main.js','utf8'),fn=main.slice(main.indexOf('async function initialize(){'),main.indexOf('\npronunciationEditor=createPronunciationEditor')),elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{value:id==='text'?'Preserved current source':'',textContent:''});return elements.get(id);},estimate=()=>mode==='rejected'?Promise.reject(Error('Estimate unavailable')):new Promise(()=>{});
 const context=vm.createContext({$,browserStorageEstimate:options=>browserStorageEstimate({...options,timeoutMs:5}),storageEstimateText,storageOpening:false,storageReady:false,storageStateChanged(){},store:null,controls(){},beginSelection:()=>0,openStorage:async()=>({draft:async()=>null}),dirty:true,narratorNote(){},refreshLibrary:async()=>[],selectionToken:0,navigator:{storage:{estimate}},status(){},warn:error=>error.message});vm.runInContext(fn,context);await context.initialize();assert.equal(context.storageReady,true);assert.equal(context.storageOpening,false);assert.match($('storage-state').textContent,/Local recordings connected/);assert.match($('storage-info').textContent,/estimate unavailable/);assert.doesNotMatch($('save-status').textContent,/could not be fully restored/);assert.equal($('text').value,'Preserved current source');
});
