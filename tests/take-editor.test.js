import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTakeEditor} from '../src/take-editor.js';
import {makeRecording} from '../src/recording.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';
globalThis.Option=class{constructor(text,value){this.textContent=text;this.value=value;}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function elements(){const map=new Map();return id=>{if(!map.has(id))map.set(id,{value:'0',options:[],textContent:'',replaceChildren(...options){this.options=options;this.value=options[0]?.value??'';},add(option){this.options.push(option);},get selectedOptions(){return this.options.filter(o=>o.value===this.value);}});return map.get(id);};}
async function job(text='First exact sentence.\n\nSecond exact sentence.'){const j=await makeRecording(text,{voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE});return {...j,next:j.passages.length};}
test('actual take editor shows exact selected text, busy/Stop cancellation, and keeps original selected after deferred cancellation',async()=>{
 const current=await job(),$=elements(),started=deferred(),gate=deferred(),messages=[];let commits=0;
 const store={takes:async()=>[],job:async()=>current,parts:async()=>{throw Error('invalid fixture');}};
 // Cancellation before a delayed storage read must not call inference or commit.
 store.job=async()=>{started.resolve();await gate.promise;return current;};store.changeTake=async()=>{commits++;};
 const editor=createTakeEditor({$,getStore:()=>store,getJob:()=>current,isBusy:()=>false,withLease:fn=>fn(()=>false),generate:()=>{throw Error('must not synthesize');},owner:'test',onChanged:()=>{},notify:m=>messages.push(m),onBusy:()=>{}});
 await editor.update(current);assert.equal($('take-regenerate').disabled,false);assert.equal($('take-select').disabled,true);assert.equal($('take-undo').disabled,true);
 $('take-passage').value='1';$('take-passage').onchange();assert.equal($('take-source').textContent,current.source.slice(current.passages[1].start,current.passages[1].end));
 const pending=$('take-regenerate').onclick();await started.promise;assert.equal(editor.busy,true);assert.equal($('take-regenerate').disabled,true);editor.cancel();await pending;gate.resolve();assert.equal(editor.busy,false);assert.equal(commits,0);assert.match(messages.at(-1),/stopped/);assert.match($('take-status').textContent,/Original.*Revision 0/);
});
test('late old take inventory cannot overwrite a newly selected recording; legacy mutation controls stay disabled',async()=>{
 const A=await job(),B=await job('Different authored text.'),gate=deferred(),$=elements();let current=A;
 const editor=createTakeEditor({$,getStore:()=>({takes:id=>id===A.id?gate.promise:Promise.resolve([])}),getJob:()=>current,isBusy:()=>false,withLease:()=>{},generate:()=>{},owner:'test',onChanged:()=>{},notify:()=>{},onBusy:()=>{}});
 const old=editor.update(A);current=B;await editor.update(B);gate.resolve([]);await old;assert.equal($('take-source').textContent,B.source);assert.equal($('take-regenerate').disabled,false);
 const legacy={...B,id:'legacy',settings:{...B.settings,pipeline:'mp3-passages-v1-2026-10-23'}};current=legacy;await editor.update(legacy);assert.equal($('take-regenerate').disabled,true);assert.equal($('take-select').disabled,true);assert.equal($('take-undo').disabled,true);assert.match($('take-status').textContent,/frozen/);
});
test('finishing original creation enables takes without reopening the same recording',async()=>{
 const full=await job(),$=elements();let current={...full,next:0};
 const editor=createTakeEditor({$,getStore:()=>({takes:async()=>[]}),getJob:()=>current,isBusy:()=>false,withLease:()=>{},generate:()=>{},owner:'test',onChanged:()=>{},notify:()=>{},onBusy:()=>{}});
 await editor.update(current);assert.equal($('take-regenerate').disabled,true);current=full;await editor.update(current);assert.equal($('take-regenerate').disabled,false);
});
