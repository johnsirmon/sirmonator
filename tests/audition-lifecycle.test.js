import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuditionPlayer} from '../src/audition-player.js';
test('a settled audition ignores duplicate terminal events after the user changes context',async()=>{
 const messages=[],states=[],audio={pause(){},play:async()=>{}};const player=createAuditionPlayer({audio,setBusy:value=>states.push(value),notify:value=>messages.push(value)});
 await player.play('synthetic.wav');const ended=audio.onended,error=audio.onerror;ended();messages.push('New source selected');const count=states.length;error();assert.equal(messages.at(-1),'New source selected');assert.equal(states.length,count);
});
test('late rejection and callbacks from a stopped audition cannot unlock or relabel a replacement',async()=>{
 let reject;const pending=new Promise((_yes,no)=>reject=no),messages=[],states=[],audio={pause(){},play:()=>pending};const player=createAuditionPlayer({audio,setBusy:value=>states.push(value),notify:value=>messages.push(value)});
 const old=player.play('old.wav'),end=audio.onended,error=audio.onerror;player.stop();audio.play=async()=>{};await player.play('new.wav');const count=states.length,message=messages.at(-1);
 end();error();reject(Error('late blocked play'));await old;assert.equal(states.length,count);assert.equal(states.at(-1),true);assert.equal(messages.at(-1),message);audio.onended();assert.equal(states.at(-1),false);
});
for(const terminal of ['end','error'])test('NotAllowedError keeps guarded native Play listeners through '+terminal+' without another controlled play',async()=>{
 let controlledPlays=0;const messages=[],states=[],audio={pause(){},play(){controlledPlays++;return Promise.reject(Object.assign(Error('blocked'),{name:'NotAllowedError'}));}};
 const player=createAuditionPlayer({audio,setBusy:value=>states.push(value),notify:value=>messages.push(value)});
 await player.play('synthetic.wav');assert.equal(controlledPlays,1);assert.match(messages.at(-1),/Press Play/);assert.equal(states.at(-1),false);
 const ended=audio.onended,error=audio.onerror;assert.equal(typeof ended,'function');assert.equal(typeof error,'function');
 // Native controls retry the existing src; they do not call player.play again.
 (terminal==='end'?ended:error)();assert.match(messages.at(-1),terminal==='end'?/Audition finished/:/could not load/);assert.equal(controlledPlays,1);assert.equal(audio.onended,null);assert.equal(audio.onerror,null);
 messages.push('New source');ended();error();assert.equal(messages.at(-1),'New source');
});
test('a stopped autoplay-blocked audition cannot publish native retry events over a newer audition',async()=>{
 const messages=[],audio={pause(){},play:async()=>{throw Object.assign(Error('blocked'),{name:'NotAllowedError'});}},player=createAuditionPlayer({audio,setBusy(){},notify:value=>messages.push(value)});
 await player.play('old.wav');const ended=audio.onended,error=audio.onerror;player.stop();audio.play=async()=>{};await player.play('new.wav');const message=messages.at(-1);ended();error();assert.equal(messages.at(-1),message);audio.onended();assert.match(messages.at(-1),/finished/);
});
