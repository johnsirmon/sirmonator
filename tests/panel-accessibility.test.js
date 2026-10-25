import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {capturePanelFocus} from '../src/panel-focus.js';

test('lost disabled-action focus restores only after the target is enabled and never steals live focus',()=>{
 const previous=globalThis.document,doc={body:{id:'body'},activeElement:null},element=id=>({id,disabled:false,focus(){assert.equal(this.disabled,false);doc.activeElement=this;}}),button=element('action'),target=element('passage'),other=element('notes');globalThis.document=doc;
 try{doc.activeElement=button;const restore=capturePanelFocus(['action'],target);button.disabled=true;doc.activeElement=doc.body;restore();assert.equal(doc.activeElement,target);
  doc.activeElement=button;button.disabled=false;const after=capturePanelFocus(['action'],target);doc.activeElement=other;after(target);assert.equal(doc.activeElement,other);
  doc.activeElement=doc.body;after(target);assert.equal(doc.activeElement,target);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
test('source/spoken previews have distinct names, keyboard scrolling and associated error/disabled guidance',async()=>{
 const html=await readFile('index.html','utf8');
 for(const id of ['pronunciation-source','pronunciation-spoken','take-source','take-spoken','review-source','review-spoken','review-findings','reference-report']){
  const tag=html.match(new RegExp('<pre id="'+id+'"[^>]*>'))?.[0];assert.ok(tag,id);assert.match(tag,/tabindex="0"/);assert.match(tag,/role="region"/);assert.match(tag,/aria-label="[^"]+"/);assert.match(tag,/class="source-preview"/);
 }
 assert.match(html,/<textarea id="pronunciation-rules" aria-describedby="pronunciation-status"/);
 for(const [id,hint] of [['take-regenerate','take-action-hint'],['reference-save','reference-action-hint'],['review-transcript','review-status']])assert.match(html,new RegExp('id="'+id+'" aria-describedby="[^"]*'+hint));
 for(const id of ['pronunciation-status','take-status','review-status','reference-status'])assert.match(html,new RegExp('id="'+id+'"[^>]*role="status"[^>]*aria-atomic="true"'));
});
