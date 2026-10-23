import {test} from 'node:test';
import assert from 'node:assert/strict';
import {characterEffect,pauseAfter} from '../src/audio-effects.js';
import {voices,getVoice} from '../src/voices.js';
import {chunkText} from '../src/core.js';
test('22 distinct studio choices include both requested character-inspired treatments',()=>{
 assert.equal(voices.length,22);assert.equal(new Set(voices.map(v=>v.id)).size,22);
 for(const id of ['prime','fenix']){const profile=getVoice(id);assert.ok(profile.pitch<1);assert.equal(profile.engine,'supertonic');}
 assert.throws(()=>getVoice('unknown'));
});
test('natural delivery preserves short paragraphs and gives them room to breathe',()=>{
 const source='Good morning, church.\n\nLet us begin.\n\nAmen.';
 const parts=chunkText(source);assert.equal(parts.join(''),source);assert.equal(parts.length,3);
 assert.ok(pauseAfter(parts[0])>pauseAfter('Let us begin. '));
 assert.ok(pauseAfter(parts[0],'reflective')>pauseAfter(parts[0]));assert.equal(pauseAfter(parts[0],'continuous'),0);
});
test('character effect lowers a known tone without nonfinite samples or clipping',()=>{
 const rate=24000,input=Float32Array.from({length:rate},(_,i)=>.2*Math.sin(2*Math.PI*220*i/rate));
 const profile=getVoice('prime'),out=characterEffect(input,rate,profile);
 assert.equal(out.length,Math.ceil(input.length/profile.pitch));assert.ok(out.every(n=>Number.isFinite(n)&&Math.abs(n)<=.98));
 let crossings=0;for(let i=1;i<out.length;i++)if(out[i-1]<=0&&out[i]>0)crossings++;
 const frequency=crossings/(out.length/rate);assert.ok(frequency>160&&frequency<190);
 assert.equal(characterEffect(input,rate,{}),input);
});
