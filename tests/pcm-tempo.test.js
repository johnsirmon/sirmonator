import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decodePcmWav} from '../src/pcm.js';
import {changeTempo} from '../src/tempo.js';
test('character references decode as audible mono speech with adequate conditioning duration',async()=>{
 for(const id of ['prime','fenix']){
  const bytes=await readFile(new URL(`../public/references/${id}.wav`,import.meta.url));
  const {samples,sampleRate}=decodePcmWav(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  assert.equal(sampleRate,24000);assert.ok(samples.length/sampleRate>=4&&samples.length/sampleRate<=10);
  assert.ok(samples.some(n=>Math.abs(n)>.05));
 }
 assert.throws(()=>decodePcmWav(new ArrayBuffer(44)));
});
test('reading speed changes duration while keeping the voice pitch',()=>{
 const rate=24000,input=Float32Array.from({length:rate*3},(_,i)=>.2*Math.sin(2*Math.PI*220*i/rate));
 assert.equal(changeTempo(input,1,rate),input);
 for(const speed of [.8,1.2]){
  const result=changeTempo(input,speed,rate);assert.equal(result.length,Math.ceil(input.length/speed));
  let crossings=0;for(let i=1;i<rate;i++)if(result[i-1]<=0&&result[i]>0)crossings++;
  assert.ok(crossings>210&&crossings<230,`${speed}: ${crossings} Hz`);
  assert.ok(result.every(Number.isFinite));
 }
});
