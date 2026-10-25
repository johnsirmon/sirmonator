import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {openStorage} from '../src/storage.js';
import {makeRecording} from '../src/recording.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';
import {syntheticPassage} from '../scripts/integration-fixture.mjs';
import {createSpeechReviewEditor} from '../src/speech-review-editor.js';

globalThis.IDBKeyRange=IDBKeyRange;
globalThis.Option=class{constructor(text,value){this.textContent=text;this.value=value;}};
test('actual review editor hands repair focus to the enabled take selector after its busy lifecycle',async()=>{
 const previous=globalThis.document,doc={body:{},activeElement:null},map=new Map(),$=id=>{
  if(!map.has(id)){let disabled=false;const element={id,value:'0',checked:false,textContent:'',addEventListener(){},replaceChildren(){},add(){},focus(){assert.equal(this.disabled,false,'Cannot focus disabled '+id);doc.activeElement=this;}};
   Object.defineProperty(element,'disabled',{get:()=>disabled,set:value=>{disabled=value;if(value&&doc.activeElement===element)doc.activeElement=doc.body;}});map.set(id,element);
  }return map.get(id);
 };
 const store=await openStorage(indexedDB,'panel-focus-'+crypto.randomUUID());globalThis.document=doc;
 try{const initial=await makeRecording('Exact synthetic passage.',{voice:'af_sarah',edition:'refined',speed:1,delivery:'natural',pipeline:FOUNDATION_PIPELINE});await store.ensureJob(initial);await store.claim('fixture');const job=await store.commit(initial.id,0,await syntheticPassage({text:initial.source,settings:initial.settings,last:true}),'fixture');
  let editor,repairs=0;editor=createSpeechReviewEditor({$,getStore:()=>store,getJob:()=>job,getSelection:()=>0,isBusy:()=>false,onBusy:()=>{$('take-passage').disabled=editor?.busy??false;},onListen:()=>{},onRepair:()=>{repairs++;assert.equal($('take-passage').disabled,true);},onExport:()=>{},repository:{load:async()=>null}});
  await editor.update(job);$('review-repair').focus();await $('review-repair').onclick();assert.equal(repairs,1);assert.equal(doc.activeElement,$('take-passage'));assert.equal(editor.busy,false);
  $('review-transcript').value='';$('review-compare').focus();await $('review-compare').onclick();assert.equal(doc.activeElement,$('review-compare'));assert.match($('review-status').textContent,/transcript|words/i);
  $('review-refresh').focus();await $('review-refresh').onclick();assert.equal(doc.activeElement,$('review-refresh'));
 }finally{store.close();if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
