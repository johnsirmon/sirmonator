import test from 'node:test';
import assert from 'node:assert/strict';
import {createReferenceEditor} from '../src/reference-editor.js';

test('reference Cancel returns lost keyboard focus to the initiating action without publishing late metadata',async()=>{
 const previous=globalThis.document,doc={body:{},activeElement:null},map=new Map(),$=id=>{
  if(!map.has(id)){let disabled=false;const element={id,value:'',textContent:'',checked:false,addEventListener(){},focus(){assert.equal(this.disabled,false);doc.activeElement=this;}};
   Object.defineProperty(element,'disabled',{get:()=>disabled,set:value=>{disabled=value;if(value&&doc.activeElement===element)doc.activeElement=doc.body;}});map.set(id,element);
  }return map.get(id);
 };let resolve,started;const gate=new Promise(r=>resolve=r),entered=new Promise(r=>started=r),row={schema:1,version:0,receipt:null};let calls=0;
 globalThis.document=doc;
 try{const editor=createReferenceEditor({$,repository:{load:()=>++calls===1?Promise.resolve(row):(started(),gate)}});await editor.ready;
  $('reference-reload').focus();const pending=$('reference-reload').onclick();await entered;assert.equal(doc.activeElement,doc.body);$('reference-cancel').focus();$('reference-cancel').onclick();await pending;
  assert.equal(editor.busy,false);assert.equal(doc.activeElement,$('reference-reload'));assert.equal($('reference-save').disabled,true);assert.match($('reference-status').textContent,/cancelled/);resolve(row);await Promise.resolve();assert.equal($('reference-save').disabled,true);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
