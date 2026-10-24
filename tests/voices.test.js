import {KokoroTTS} from 'kokoro-js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {characterEffect,pauseAfter} from '../src/audio-effects.js';
import {voices,getVoice,voiceCapabilities} from '../src/voices.js';
import {chunkText} from '../src/core.js';
test('26 distinct studio choices include unfiltered reference-conditioned characters',()=>{
 assert.equal(voices.length,26);assert.equal(new Set(voices.map(v=>v.id)).size,26);
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

test('new free voices exist in the installed Kokoro runtime catalog and declare their capabilities',()=>{
 const runtime=new KokoroTTS(null,null).voices;
 for(const id of ['af_sarah','af_kore','bf_alice','bm_lewis']){
  assert.ok(runtime[id],id+' must be supported by the installed wrapper');
  assert.equal(getVoice(id).base,id);assert.equal(getVoice(id).engine,'kokoro');
  assert.equal(voiceCapabilities(id).license,'Apache-2.0 model weights');
  assert.equal(voiceCapabilities(id).language,'English');assert.equal(voiceCapabilities(id).download,true);
 }
});