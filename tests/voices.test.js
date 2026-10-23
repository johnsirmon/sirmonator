import {test} from 'node:test';
import assert from 'node:assert/strict';
import {characterEffect,pauseAfter} from '../src/audio-effects.js';
import {voices,getVoice} from '../src/voices.js';
import {chunkText} from '../src/core.js';
test('22 distinct studio choices include unfiltered reference-conditioned characters',()=>{
 assert.equal(voices.length,22);assert.equal(new Set(voices.map(v=>v.id)).size,22);
 for(const id of ['prime','fenix']){const profile=getVoice(id);assert.equal(profile.engine,'pocket');assert.equal(profile.pitch,undefined);assert.equal(profile.bass,undefined);assert.equal(profile.grit,undefined);assert.equal(profile.metal,undefined);}
 assert.throws(()=>getVoice('unknown'));
});
test('natural delivery preserves short paragraphs and gives them room to breathe',()=>{
 const source='Good morning, church.\n\nLet us begin.\n\nAmen.';
 const parts=chunkText(source);assert.equal(parts.join(''),source);assert.equal(parts.length,3);
 assert.ok(pauseAfter(parts[0])>pauseAfter('Let us begin. '));
 assert.ok(pauseAfter(parts[0],'reflective')>pauseAfter(parts[0]));assert.equal(pauseAfter(parts[0],'continuous'),0);
});
test('character references are not pitch shifted or masked by DSP',()=>{
 const rate=24000,input=Float32Array.from({length:rate},(_,i)=>.2*Math.sin(2*Math.PI*220*i/rate));
 for(const id of ['prime','fenix'])assert.equal(characterEffect(input,rate,getVoice(id)),input);
 assert.equal(characterEffect(input,rate,{}),input);
});
