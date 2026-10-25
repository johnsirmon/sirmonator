import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createSourceImporter} from '../src/source-importer.js';
import {chaptersFor,selectedText,MAX_READING} from '../src/recording.js';
import {WORD_BOUNDARIES,LEGACY_BOUNDARIES} from '../src/text-boundaries.js';
const main=await readFile('src/main.js','utf8'),line=prefix=>main.split('\n').find(value=>value.startsWith(prefix));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
function elements(){const map=new Map();return id=>{if(!map.has(id))map.set(id,{value:'0',checked:false,textContent:'',hidden:false,replaceChildren(){},add(){},scrollIntoView(){}});return map.get(id);};}
test('actual narrator card replans Device chapter boundaries and invalidates the old review',()=>{
 const $=elements(),card={dataset:{voice:'synthetic'}},planner=main.slice(main.indexOf('const draftBoundaryPolicy='),main.indexOf('function preflight(){'));
 $('text').value=('x'.repeat(235)+' John ').repeat(35);$('engine').value='device';$('text-boundaries').value=WORD_BOUNDARIES;
 const context=vm.createContext({$,WORD_BOUNDARIES,LEGACY_BOUNDARIES,chaptersFor,selectedText,MAX_READING,chapters:[],boundaryError:'',pronunciationEditor:{refresh(){}},scheduleSave(){},preflight(){},fillVoices(){},narratorNote(){},Option:class{},document:{querySelectorAll:()=>[card]}});vm.runInContext(planner+'\n'+line("document.querySelectorAll('[data-voice]').forEach(b=>b.onclick="),context);
 context.updateText({resetRange:false});assert.equal(context.rangeText().length,5996);$('review').checked=true;card.onclick();assert.equal(context.rangeText().length,5784);assert.equal($('review').checked,false);
});
test('actual undo/edited source handlers clear stale acknowledgment and file-extraction labels',()=>{
 const $=elements(),context=vm.createContext({$,undo:{text:'Original source',title:'Original title',boundaryPolicy:WORD_BOUNDARIES},LEGACY_BOUNDARIES,updateText(){}});vm.runInContext(line("$('undo-clear').onclick=")+'\n'+line("$('text').oninput="),context);
 $('review').checked=true;$('import-note').hidden=false;$('undo-clear').onclick();assert.equal($('text').value,'Original source');assert.equal($('review').checked,false);assert.equal($('import-note').hidden,true);assert.match($('source').textContent,/Restored text/);
 $('review').checked=true;$('import-note').hidden=false;$('text').oninput();assert.equal($('review').checked,false);assert.equal($('import-note').hidden,true);assert.equal($('source').textContent,'Edited / pasted text');
});
for(const action of ['speed','file'])test('actual '+action+' intent prevents deferred startup restore from overwriting the current draft',async()=>{
 const $=elements(),restore=deferred(),read=deferred(),initializing=main.slice(main.indexOf('async function initialize(){'),main.indexOf('\npronunciationEditor=createPronunciationEditor'));
 const context=vm.createContext({$,createSourceImporter,draftRevision:0,dirty:false,importing:false,sourceImporter:null,importDocument:()=>read.promise,updateText(){context.draftRevision++;},flushDraft:async()=>{},status(){},warn:error=>error.message,controls(){},preflight(){},scheduleSave(){context.dirty=true;context.draftRevision++;},narratorNote(){},storageOpening:false,storageReady:false,storageStateChanged(){},store:null,beginSelection:()=>0,openStorage:async()=>({draft:()=>restore.promise}),refreshLibrary:async()=>[],selectionToken:0,browserStorageEstimate:async()=>null,storageEstimateText:()=> 'unavailable',navigator:{}});
 vm.runInContext(initializing+'\n'+line("for(const id of ['voice-edition'")+'\n'+line('sourceImporter=createSourceImporter')+'\n'+line("$('file').onchange="),context);$('text').value='Current source';$('speed').value='1.25';const pending=context.initialize();await Promise.resolve();
 let importing;if(action==='speed')$('speed').oninput();else{$('file').files=[{name:'synthetic.txt'}];$('file').value='chosen';importing=$('file').onchange();assert.equal($('file').value,'');assert.equal(context.importing,true);}
 restore.resolve({text:'Old saved source',settings:{speed:0.75}});await pending;assert.equal($('text').value,'Current source');assert.equal($('speed').value,'1.25');assert.equal(context.dirty,true);
 if(importing){context.sourceImporter.cancel();await importing;read.resolve({text:'Late file'});}
});
