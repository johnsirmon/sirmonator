import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {voices} from '../src/voices.js';
test('every studio voice has a valid, audible, bounded WAV audition and manifest entry',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../public/auditions/manifest.json',import.meta.url),'utf8'));
 assert.deepEqual(manifest.voices.map(v=>v.id).sort(),voices.map(v=>v.id).sort());
 for(const voice of voices){
   const file=await readFile(new URL(`../public/auditions/${voice.id}.wav`,import.meta.url));
   assert.equal(file.toString('ascii',0,4),'RIFF',voice.id);assert.equal(file.toString('ascii',8,12),'WAVE',voice.id);
   assert.equal(file.readUInt32LE(40),file.length-44,voice.id);assert.equal(file.readUInt16LE(22),1);
   const seconds=(file.length-44)/2/file.readUInt32LE(24);assert.ok(seconds>1&&seconds<20,`${voice.id}: duration ${seconds}`);
   let energy=0;for(let i=44;i<file.length;i+=2)energy+=(file.readInt16LE(i)/32768)**2;
   assert.ok(Math.sqrt(energy/((file.length-44)/2))>.005,`${voice.id} must contain audible speech`);
   assert.ok(file.length<1500000,`${voice.id} should be a lightweight preview`);
 }
});
