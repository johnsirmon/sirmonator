import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {chaptersFor} from '../src/recording.js';
import {createQuickListener} from '../src/quick-listener.js';

const main=await readFile('src/main.js','utf8');
function harness({speak,pause,resume,voices}={}){
 const spoken=[],messages=[],elements=new Map(),allVoices=voices??[{name:'Chosen',lang:'en-US',voiceURI:'chosen'},{name:'Other',lang:'en-US',voiceURI:'other'}];let cancelled=0;
 const $=id=>{if(!elements.has(id))elements.set(id,{value:id==='voice'?'0':id==='speed'?'1':'',checked:true});return elements.get(id);};
 const speech={getVoices:()=>allVoices,speak:u=>{spoken.push(u);speak?.(u);},cancel(){cancelled++;},pause:pause??(()=>{}),resume:resume??(()=>{})};
 const context=vm.createContext({$,chaptersFor,createQuickListener,window:{speechSynthesis:speech},SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},status:message=>messages.push(message),controls(){},killWorker(){},cancelPreparations(){},audition:{stop(){}},deviceVoices:allVoices,clearTimeout(){},setTimeout:()=>1});
 const quick=main.slice(main.indexOf('function quickListen('),main.indexOf('async function exportAudio(')),handlers=main.split('\n').filter(line=>line.startsWith("$('stop').onclick=")||line.startsWith("$('pause').onclick=")).join('\n');
 const initialization=main.split('\n').find(line=>line.startsWith('const quickListener='))??'';
 const schedule=main.slice(main.indexOf('function scheduleSave('),main.indexOf('async function flushDraft('));
 vm.runInContext(`let quick=false,quickPaused=false,creating=false,importing=false,cancelled=false,pauseRequested=false,renderToken=0,dirty=false,draftRevision=0,draftTimer=null;${initialization}\n${quick}\n${handlers}\n${schedule}\nglobalThis.api={start:quickListen,state:()=>({quick,quickPaused,dirty,draftRevision}),change:scheduleSave};`,context);
 return {$,spoken,messages,context,voices:allVoices,...context.api,get cancels(){return cancelled;}};
}
const long=prefix=>(prefix+' words remain in their original order. ').repeat(15);

test('late end/error from a stopped Quick listen cannot advance or stop its replacement',()=>{
 const h=harness();h.start(long('Old'));const old=h.spoken[0],end=old.onend,error=old.onerror;h.$('stop').onclick();h.start(long('New'));const count=h.spoken.length,message=h.messages.at(-1);
 end();assert.equal(h.spoken.length,count);error();assert.equal(h.state().quick,true);assert.equal(h.messages.at(-1),message);
});
test('a synchronous speak exception releases Quick listen controls and reports interruption',()=>{
 const h=harness({speak(){throw Error('synthetic speak failure');}});assert.doesNotThrow(()=>h.start('Exact reviewed text.'));assert.equal(h.state().quick,false);assert.match(h.messages.at(-1),/interrupt|could not/i);
});
test('Quick listen rejects an unavailable selected voice instead of invoking an OS default',()=>{
 const h=harness();h.$('voice').value='99';h.start('Exact reviewed text.');assert.equal(h.spoken.length,0);assert.equal(h.state().quick,false);assert.match(h.messages.at(-1),/voice/i);
});
test('a run freezes its voice and rate even when the system list and selection change',()=>{
 const h=harness();h.start(long('Source'));const original=h.spoken[0].voice;h.context.deviceVoices=[h.voices[1],h.voices[0]];h.$('speed').value='1.3';h.spoken[0].onend();assert.equal(h.spoken[1].voice,original);assert.equal(h.spoken[1].rate,1);
});
test('duplicate utterance completion cannot skip a passage or publish completion twice',()=>{
 const h=harness();h.start(long('Source'));const end=h.spoken[0].onend;end();const count=h.spoken.length;end();assert.equal(h.spoken.length,count);
});
test('synchronous completion preserves the terminal status rather than restoring a playing status',()=>{
 const h=harness({speak:u=>u.onend()});h.start('One short passage.');assert.equal(h.state().quick,false);assert.match(h.messages.at(-1),/finished/i);
});

test('Pause holds a just-completed passage until Resume and Stop rejects its saved callbacks',()=>{
 const h=harness();h.start(long('Source'));const oldEnd=h.spoken[0].onend;
 h.$('pause').onclick();assert.equal(h.state().quickPaused,true);oldEnd();assert.equal(h.spoken.length,1);assert.equal(h.state().quick,true);
 h.$('pause').onclick();assert.equal(h.state().quickPaused,false);assert.equal(h.spoken.length,2);
 const end=h.spoken[1].onend,error=h.spoken[1].onerror;h.$('pause').onclick();h.$('stop').onclick();end();error();assert.equal(h.spoken.length,2);assert.equal(h.state().quick,false);assert.equal(h.state().quickPaused,false);
});
for(const phase of ['pause','resume'])test('throwing '+phase+' releases the device run without changing reviewed source',()=>{
 const h=harness({[phase](){throw Error('synthetic '+phase);}});h.$('text').value='Reviewed source';h.start(long('Source'));h.$('pause').onclick();if(phase==='resume')h.$('pause').onclick();assert.equal(h.state().quick,false);assert.equal(h.$('text').value,'Reviewed source');assert.equal(h.$('review').checked,true);
});
test('no device API or empty voice list can call speak or lock controls',()=>{
 for(const absent of ['api','voices']){const h=harness({voices:[]});if(absent==='api')h.context.window.speechSynthesis=undefined;h.start('Source.');assert.equal(h.spoken.length,0);assert.equal(h.state().quick,false);}
});
test('source/voice/engine edits cancel device playback before stale completion can mark another draft finished',()=>{
 const h=harness();h.$('text').value='Reviewed source';h.start(long('Old'));const end=h.spoken[0].onend,error=h.spoken[0].onerror;
 h.$('text').value='New source';h.change();const message=h.messages.at(-1),count=h.spoken.length;end();error();assert.equal(h.spoken.length,count);assert.equal(h.state().quick,false);assert.equal(h.state().dirty,true);assert.equal(h.state().draftRevision,1);assert.equal(h.$('text').value,'New source');assert.equal(h.messages.at(-1),message);
});
test('voice list refresh preserves the selected voice identity when system ordering changes',()=>{
 const h=harness(),original=h.voices[1];h.$('engine').value='device';h.$('voice').value='1';h.context.window.speechSynthesis.getVoices=()=>[original,h.voices[0]];
 const fill=main.slice(main.indexOf('function fillVoices('),main.indexOf('function narratorNote('));
 const select=h.$('voice');select.replaceChildren=()=>{};select.add=()=>{};h.context.Option=class{};h.context.catalog=[];vm.runInContext(fill+'\nfillVoices();',h.context);
 assert.equal(select.value,'0');h.start('The selected voice stays selected.');assert.equal(h.spoken[0].voice,original);
});
test('a voice disappearing between passages stops rather than asking the OS for a default',()=>{
 const h=harness();h.start(long('Source'));h.context.window.speechSynthesis.getVoices=()=>[];h.spoken[0].onend();assert.equal(h.spoken.length,1);assert.equal(h.state().quick,false);assert.match(h.messages.at(-1),/voice became unavailable/);
});
test('repeated Start replaces only the owned device run and preserves exact current source order',()=>{
 const h=harness();h.start(long('First'));const old=h.spoken[0],end=old.onend;const text=long('Second');h.start(text);const start=1;end();
 let index=start;while(h.state().quick){assert.ok(index<h.spoken.length);h.spoken[index++].onend();}
 assert.equal(h.spoken.slice(start).map(u=>u.text).join(''),text);assert.equal(h.state().quickPaused,false);assert.equal(h.messages.filter(m=>/finished/.test(m)).length,1);
});
