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
 const context=vm.createContext({$,store,storageReady:true,draftRevision:0,saveChain:Promise.resolve(),draftTimer:null,dirty:false,quickListener:{stop(){}},audition:{stop(){}},setTimeout:()=>1,clearTimeout(){},draft:()=>({text:$('text').value}),MAX_DOCUMENT:2000000,warn:e=>e.message});
 const flush=main.slice(main.indexOf('async function flushDraft(){'),main.indexOf('function queueSave()'));
 const toggle=main.split('\n').find(line=>line.startsWith("$('remember').onchange="));
 const schedule=main.slice(main.indexOf('function scheduleSave('),main.indexOf('async function flushDraft('));vm.runInContext(flush+'\n'+schedule+'\n'+toggle,context);
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
 const h=harness(),gate=h.holdDelete(),off=h.toggle(false);await turn();gate.reject(Error('Draft deletion unavailable'));await off;assert.equal(h.saved.text,'Original saved source');assert.match(h.$('save-status').textContent,/Draft deletion unavailable.*may remain/);
});
test('off while storage unavailable makes no deletion or false removal claim',async()=>{
 const h=harness();h.context.storageReady=false;await h.toggle(false);assert.equal(h.saved.text,'Original saved source');assert.deepEqual(h.trace,[]);assert.match(h.$('save-status').textContent,/not confirmed.*unavailable/);
});
for(const outcome of ['failure','success'])test('editing text while off preserves current deletion '+outcome+' ownership',async()=>{
 const h=harness(),gate=h.holdDelete(),off=h.toggle(false);await turn();h.$('text').value='Further editor change while off';h.context.scheduleSave();
 if(outcome==='failure')gate.reject(Error('Draft deletion unavailable'));else gate.resolve();await off;
 assert.equal(h.$('text').value,'Further editor change while off');
 if(outcome==='failure'){assert.equal(h.saved.text,'Original saved source');assert.match(h.$('save-status').textContent,/Draft deletion unavailable.*may remain/);h.context.scheduleSave();assert.match(h.$('save-status').textContent,/removal is not confirmed/);}
 else{assert.equal(h.saved,undefined);assert.match(h.$('save-status').textContent,/autosave off/i);assert.doesNotMatch(h.$('save-status').textContent,/not confirmed/);}
});
test('unavailable off intent survives real initialize/reconnect without silent deletion or lost warning',async()=>{
 const h=harness();h.context.storageReady=false;h.$('text').value='Keep unsaved editor text';await h.toggle(false);
 Object.assign(h.context,{storageOpening:false,dirty:true,busy:()=>false,selectionToken:0,openStorage:async()=>({...h.store,close(){},draft:async()=>h.saved}),controls(){},beginSelection:()=>0,storageStateChanged(){},narratorNote(){},refreshLibrary:async()=>[],browserStorageEstimate:async()=>undefined,storageEstimateText:()=>'',navigator:{storage:{}},status(){}});h.store.close=()=>{};
 const init=main.slice(main.indexOf('async function initialize(){'),main.indexOf('\npronunciationEditor=createPronunciationEditor'));vm.runInContext(init,h.context);await h.$('retry-storage').onclick();
 assert.equal(h.$('remember').checked,false);assert.equal(h.saved.text,'Original saved source');assert.equal(h.$('text').value,'Keep unsaved editor text');assert.match(h.$('save-status').textContent,/removal is not confirmed/);assert.deepEqual(h.trace,[]);
 await h.toggle(true);await h.toggle(false);assert.equal(h.saved,undefined);assert.doesNotMatch(h.$('save-status').textContent,/not confirmed/);
});
