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
