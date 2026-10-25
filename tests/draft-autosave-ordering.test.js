import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const main=await readFile('src/main.js','utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{checked:true,textContent:'',value:''});return nodes.get(id);};let value={text:'Original saved source'},deletion,save;
 const trace=[],store={async saveDraft(data){trace.push('save-start');if(save)await save.promise;value=structuredClone(data);trace.push('save-done');},async deleteDraft(){trace.push('delete-start');if(deletion)await deletion.promise;value=undefined;trace.push('delete-done');}};
 const context=vm.createContext({$,store,storageReady:true,draftRevision:0,saveChain:Promise.resolve(),draftTimer:null,clearTimeout(){},draft:()=>({text:$('text').value}),MAX_DOCUMENT:2000000,warn:e=>e.message});
 const flush=main.slice(main.indexOf('async function flushDraft(){'),main.indexOf('function queueSave()'));
 const toggle=main.split('\n').find(line=>line.startsWith("$('remember').onchange="));
 vm.runInContext(flush+'\n'+toggle,context);
 return {$,context,trace,store,get saved(){return value;},holdDelete(){return deletion=deferred();},holdSave(){return save=deferred();},toggle(checked){$('remember').checked=checked;return $('remember').onchange();}};
}
test('off deletion and on save are serialized; a delayed older deletion cannot erase the newest draft',async()=>{
 const h=harness(),gate=h.holdDelete(),off=h.toggle(false);await turn();assert.deepEqual(h.trace,['delete-start']);h.$('text').value='Newest reviewed café e\u0301 source';const on=h.toggle(true);await turn();assert.deepEqual(h.trace,['delete-start'],'new save must wait for older deletion');gate.resolve();await Promise.all([off,on]);assert.equal(h.saved.text,h.$('text').value);assert.match(h.$('save-status').textContent,/Draft saved/);
});
test('failed older off request cannot overwrite a later successful on save',async()=>{
 const h=harness(),gate=h.holdDelete(),off=h.toggle(false);await turn();h.$('text').value='New source';const on=h.toggle(true);gate.reject(Error('Old deletion failed'));await Promise.all([off,on]);assert.equal(h.saved.text,'New source');assert.match(h.$('save-status').textContent,/Draft saved/);
});
test('pending save cannot acknowledge autosave after off and final off removes only the draft',async()=>{
 const h=harness(),gate=h.holdSave();h.$('text').value='Retained editor text';const pending=h.context.flushDraft();await turn();const off=h.toggle(false);gate.resolve();await Promise.all([pending,off]);assert.equal(h.saved,undefined);assert.equal(h.$('text').value,'Retained editor text');assert.match(h.$('save-status').textContent,/autosave off/i);
});
test('off request stays bound to its connection and preserves a newer lifecycle warning',async()=>{
 const h=harness(),gate=h.holdSave();const save=h.context.flushDraft();await turn();const off=h.toggle(false);let newDeletes=0;h.context.store={deleteDraft:async()=>newDeletes++,saveDraft:async()=>{}};h.context.storageReady=false;h.$('save-status').textContent='Connection changed; export text backup';gate.resolve();await Promise.all([save,off]);assert.equal(newDeletes,0);assert.equal(h.$('save-status').textContent,'Connection changed; export text backup');
});
test('repeated off/on/off settles in request order without dropping source',async()=>{
 const h=harness(),gate=h.holdDelete();h.$('text').value='Preserved source';const a=h.toggle(false);await turn();const b=h.toggle(true),c=h.toggle(false);gate.resolve();await Promise.all([a,b,c]);assert.equal(h.saved,undefined);assert.equal(h.$('text').value,'Preserved source');assert.match(h.$('save-status').textContent,/autosave off/i);assert.deepEqual(h.trace,['delete-start','delete-done','save-start','save-done','delete-start','delete-done']);
});
test('current deletion failure reports failure and keeps saved source for retry',async()=>{
 const h=harness(),gate=h.holdDelete(),off=h.toggle(false);await turn();gate.reject(Error('Draft deletion unavailable'));await off;assert.equal(h.saved.text,'Original saved source');assert.equal(h.$('save-status').textContent,'Draft deletion unavailable');
});
test('off while storage unavailable makes no deletion or false removal claim',async()=>{
 const h=harness();h.context.storageReady=false;await h.toggle(false);assert.equal(h.saved.text,'Original saved source');assert.deepEqual(h.trace,[]);assert.match(h.$('save-status').textContent,/could not be removed.*unavailable/);
});
