import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {chaptersFor,selectedText,MAX_READING} from '../src/recording.js';
import {WORD_BOUNDARIES,LEGACY_BOUNDARIES} from '../src/text-boundaries.js';
test('actual engine handler clears reviewed acknowledgment when either engine changes selected chapter source',async()=>{
 const main=await readFile('src/main.js','utf8'),planner=main.slice(main.indexOf('const draftBoundaryPolicy='),main.indexOf('function preflight(){')),handler=main.split('\n').find(line=>line.startsWith("$('engine').onchange=")),map=new Map(),$=id=>{if(!map.has(id))map.set(id,{value:'0',checked:false,textContent:'',replaceChildren(){},add(){}});return map.get(id);};
 $('text').value=('x'.repeat(235)+' John ').repeat(35);$('engine').value='device';$('text-boundaries').value=WORD_BOUNDARIES;
 const context=vm.createContext({$,WORD_BOUNDARIES,LEGACY_BOUNDARIES,chaptersFor,selectedText,MAX_READING,chapters:[],boundaryError:'',pronunciationEditor:{refresh(){}},scheduleSave(){},preflight(){},fillVoices(){},narratorNote(){},Option:class{}});vm.runInContext(planner+'\n'+handler,context);context.updateText({resetRange:false});const device=context.rangeText();assert.equal(device.length,5996);
 $('review').checked=true;$('engine').value='studio';$('engine').onchange();const studio=context.rangeText();assert.equal(studio.length,5784);assert.notEqual(studio,device);assert.equal($('review').checked,false);
 $('review').checked=true;$('engine').value='device';$('engine').onchange();assert.equal(context.rangeText(),device);assert.equal($('review').checked,false);
});
