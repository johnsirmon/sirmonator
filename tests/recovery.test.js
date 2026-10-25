import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechRunner} from '../src/speech-runner.js';
import {createAuditionPlayer,auditionUrl} from '../src/audition-player.js';
test('GPU lost DURING inference retries identical text on CPU, then stays on CPU',async()=>{
 const calls=[],loads=[],released=[],notices=[];
 const run=createSpeechRunner({initialProvider:'webgpu',load:async provider=>{loads.push(provider);return provider;},
 infer:async(provider,input)=>{calls.push({provider,input});if(provider==='webgpu')throw Error("failed to call OrtRun(): Device was lost before MapAsync completed");return input;},
 release:async e=>{released.push(e);throw Error('device already lost');}});
 const input={text:'John 3:16. Read every word.',voice:'M1',speed:1};
 assert.equal(await run(input,m=>notices.push(m)),input);assert.equal(await run(input),input);
 assert.deepEqual(loads,['webgpu','wasm']);assert.deepEqual(calls.map(c=>c.provider),['webgpu','wasm','wasm']);
 assert.ok(calls.every(c=>c.input===input));assert.deepEqual(released,['webgpu']);assert.equal(notices.length,1);
});
test('GPU load errors recover, but CPU errors surface without an infinite retry',async()=>{
 const loads=[];
 const run=createSpeechRunner({initialProvider:'webgpu',load:async provider=>{loads.push(provider);if(provider==='webgpu')throw Error('GPU unavailable');return provider;},infer:async()=>{throw Error('CPU error');}});
 await assert.rejects(run({text:'Amen.'}),/CPU error/);assert.deepEqual(loads,['webgpu','wasm']);
});
test('audition plays immediately without a synthesis engine and unlocks controls on finish',async()=>{
 const states=[],messages=[],audio={pause(){},play(){this.started=true;return Promise.resolve();}};
 const player=createAuditionPlayer({audio,setBusy:v=>states.push(v),notify:m=>messages.push(m)});
 await player.play(auditionUrl('prime','/sirmonator/'));
 assert.equal(audio.src,'/sirmonator/auditions/prime.wav?v=3');assert.equal(audio.started,true);assert.equal(audio.hidden,false);
 assert.equal(states.at(-1),true);audio.onended();assert.equal(states.at(-1),false);assert.match(messages.at(-1),/finished/);
});
test('autoplay block offers native play control; missing audio and stop unlock controls',async()=>{
 const states=[],messages=[],audio={pause(){},async play(){throw Object.assign(Error('blocked'),{name:'NotAllowedError'});}};
 const player=createAuditionPlayer({audio,setBusy:v=>states.push(v),notify:m=>messages.push(m)});
 await player.play(auditionUrl('fenix'));assert.equal(states.at(-1),false);assert.match(messages.at(-1),/Press Play/);
 assert.equal(audio.onerror,null);audio.play=async()=>{};await player.play(auditionUrl('fenix'));
 audio.onerror();assert.equal(states.at(-1),false);assert.match(messages.at(-1),/could not load/);
 player.stop();assert.equal(audio.onended,null);assert.equal(audio.onerror,null);assert.equal(states.at(-1),false);
 assert.throws(()=>auditionUrl('../arbitrary'));
});
