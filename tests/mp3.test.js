import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {Mp3Encoder} from '@breezystack/lamejs';
import {encodeMp3,mp3Duration} from '../src/mp3.js';
const rate=24000;
test('MP3 parts are valid frame sequences with bounded size and no invalid samples',()=>{
 for(const sampleRate of [22050,24000,44100,48000]){
   const samples=Float32Array.from({length:sampleRate},(_,i)=>.2*Math.sin(2*Math.PI*440*i/sampleRate)),bytes=encodeMp3(samples,sampleRate,Mp3Encoder);
   assert.ok(bytes.length>7000&&bytes.length<12000);assert.ok(Math.abs(mp3Duration(bytes)-1)<.15);
 }
 assert.throws(()=>encodeMp3(new Float32Array([NaN]),rate,Mp3Encoder),/invalid audio/);
 assert.throws(()=>mp3Duration(new Uint8Array([255,255,255,255])),/Invalid|Unsupported|Incomplete/);
});
test('independently checkpointed MP3 passages concatenate and decode with preserved order',t=>{
 if(spawnSync('ffmpeg',['-version'],{windowsHide:true}).status!==0){t.skip('Optional decoder validation requires ffmpeg');return;}
 const tones=[220,440,880],parts=tones.map(hz=>encodeMp3(Float32Array.from({length:rate*2},(_,i)=>.2*Math.sin(2*Math.PI*hz*i/rate)),rate,Mp3Encoder));
 const encoded=Buffer.concat(parts),result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','mp3','-i','pipe:0','-f','f32le','-ac','1','-ar',String(rate),'pipe:1'],{input:encoded,maxBuffer:4e6,windowsHide:true});
 assert.equal(result.status,0,result.stderr.toString());const pcm=new Float32Array(result.stdout.buffer.slice(result.stdout.byteOffset,result.stdout.byteOffset+result.stdout.length));
 assert.ok(Math.abs(pcm.length/rate-parts.reduce((sum,p)=>sum+mp3Duration(p),0))<.1);
 let offset=0;for(let i=0;i<tones.length;i++){
   const start=Math.round((offset+.4)*rate),end=start+rate;let crossings=0,energy=0;
   for(let j=start+1;j<end;j++){energy+=pcm[j]**2;if(pcm[j-1]<=0&&pcm[j]>0)crossings++;}
   assert.ok(Math.abs(crossings-tones[i])<5,`passage ${i}: ${crossings} Hz`);assert.ok(energy/rate>.005);offset+=mp3Duration(parts[i]);
 }
});
