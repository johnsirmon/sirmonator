import {browserStorageEstimate,storageEstimateText} from '../src/storage-usage.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {WORD_BOUNDARIES,LEGACY_BOUNDARIES} from '../src/text-boundaries.js';
const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
test('preflight explains boundary errors and legacy-preview gating before the Create action',()=>{
 const fn=main.slice(main.indexOf('function preflight(){'),main.indexOf('function draft(){')),map=new Map(),$=id=>{if(!map.has(id))map.set(id,{value:'studio',textContent:''});return map.get(id);},context=vm.createContext({browserStorageEstimate,storageEstimateText,$,WORD_BOUNDARIES,boundaryError:'Oversized cluster. No text was changed.',draftBoundaryPolicy:()=>WORD_BOUNDARIES});vm.runInContext(fn,context);context.preflight();assert.equal($('preflight').textContent,context.boundaryError);context.boundaryError='';context.draftBoundaryPolicy=()=>LEGACY_BOUNDARIES;context.preflight();assert.match($('preflight').textContent,/Legacy preview mode/);
});
test('custom preview reports the source boundary error rather than claiming the preserved draft is empty',async()=>{
 const fn=main.slice(main.indexOf("$('custom-preview').onclick="),main.indexOf("$('engine').onchange=")),button={};let status='',focused=false;const context=vm.createContext({browserStorageEstimate,storageEstimateText,$:id=>id==='custom-preview'?button:{focus(){focused=true;}},busy:()=>false,boundaryError:'Oversized source token.',status:value=>status=value});vm.runInContext(fn,context);await button.onclick();assert.equal(status,context.boundaryError);assert.equal(focused,true);
});
test('new Studio creation refuses legacy preview or oversized source before changing a recording',async()=>{
 const fn=main.slice(main.indexOf('async function createAudio('),main.indexOf('function quickListen(')),map=new Map();let message='',focus='';const $=id=>{if(!map.has(id))map.set(id,{value:id==='engine'?'studio':'Original source',checked:true,focus(){focus=id;}});return map.get(id);};
 const context=vm.createContext({browserStorageEstimate,storageEstimateText,$,WORD_BOUNDARIES,boundaryError:'',draftBoundaryPolicy:()=>LEGACY_BOUNDARIES,busy:()=>false,status:value=>message=value});vm.runInContext(fn,context);await context.createAudio();assert.match(message,/Choose New text boundaries/);assert.equal(focus,'text-boundaries');assert.equal($('text').value,'Original source');
 context.draftBoundaryPolicy=()=>WORD_BOUNDARIES;context.boundaryError='A token exceeds the passage limit.';await context.createAudio();assert.equal(message,context.boundaryError);assert.equal(focus,'text');
});
for(const policy of [undefined,WORD_BOUNDARIES])test('bootstrap preserves '+(policy??'historical')+' draft preview policy without overwriting source',async()=>{
 const fn=main.slice(main.indexOf('async function initialize(){'),main.indexOf('\npronunciationEditor=createPronunciationEditor')),map=new Map(),$=id=>{if(!map.has(id))map.set(id,{value:'',options:[],checked:false,textContent:''});return map.get(id);},saved={text:'Old exact source.',title:'Preserved',settings:{voice:'af_sarah'},...(policy?{boundaryPolicy:policy}:{})};let observed;
 const context=vm.createContext({browserStorageEstimate,storageEstimateText,$,WORD_BOUNDARIES,LEGACY_BOUNDARIES,storageOpening:false,storageReady:false,storageStateChanged(){},store:null,controls(){},beginSelection:()=>0,openStorage:async()=>({draft:async()=>saved}),dirty:false,pronunciationEditor:{restoreDraft(){}},fillVoices(){},updateText(){observed=$('text-boundaries').value;},chapters:[],updateRange(){},document:{body:{classList:{toggle(){},add(){}}}},narratorNote(){},refreshLibrary:async()=>[],selectionToken:0,navigator:{},warn:error=>error.message,status(){}});
 vm.runInContext(fn,context);await context.initialize();assert.equal(observed,policy??LEGACY_BOUNDARIES);assert.equal($('text').value,saved.text);assert.equal($('title').value,saved.title);
});
