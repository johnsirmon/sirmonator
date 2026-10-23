import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {characterVoice,characterSettings} from '../src/character-settings.js';
import {auditionUrl} from '../src/audition-player.js';
import {decodePcmWav} from '../src/pcm.js';

test('editions route auditions and synthesis to matching distinct voice references',()=>{
 for(const id of ['prime','fenix'])for(const edition of ['refined','previous']){
   const ref=characterVoice(id,edition);
   assert.equal(auditionUrl(id,'/sirmonator/',edition),`/sirmonator/auditions/${ref}.wav?v=3`);
   const settings=characterSettings(ref);
   assert.equal(settings.steps,edition==='previous'?1:4);
   assert.ok(settings.temperature>0&&settings.temperature<=0.7);
 }
 assert.deepEqual(characterSettings('prime-v2'),{steps:1,temperature:0.7});
 assert.throws(()=>characterVoice('prime','invalid'));
 assert.throws(()=>characterVoice('unknown'));
 assert.throws(()=>characterSettings('unknown'));
});

test('preserved and refined character assets are audible, unclipped and bounded',async()=>{
 for(const id of ['prime','fenix','prime-v2','fenix-v2'])for(const folder of ['references','auditions']){
   const data=await readFile(new URL(`../public/${folder}/${id}.wav`,import.meta.url));
   const {samples,sampleRate}=decodePcmWav(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
   const seconds=samples.length/sampleRate;
   assert.ok(seconds>=3&&seconds<=10,`${folder}/${id}: ${seconds}s`);
   let square=0,clipped=0;
   for(const sample of samples){assert.ok(Number.isFinite(sample));square+=sample*sample;if(Math.abs(sample)>=.999)clipped++;}
   assert.ok(Math.sqrt(square/samples.length)>.005,`${id} is audible`);
   assert.ok(clipped/samples.length<.001,`${id} has no sustained clipping`);
 }
 const prime=await readFile(new URL('../public/references/prime.wav',import.meta.url));
 assert.deepEqual(prime,await readFile(new URL('../public/references/prime-v2.wav',import.meta.url)),'accepted Prime reference is preserved');
 const fenix=await readFile(new URL('../public/references/fenix.wav',import.meta.url));
 assert.notDeepEqual(fenix,await readFile(new URL('../public/references/fenix-v2.wav',import.meta.url)),'Marcus uses a different delivery reference');
});
