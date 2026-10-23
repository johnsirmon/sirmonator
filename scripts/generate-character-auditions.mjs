import {readFile,writeFile} from 'node:fs/promises';
import {createPocketNode} from './pocket-node.mjs';
import {decodePcmWav,concatenate} from '../src/pcm.js';
import {encodeWav} from '../src/core.js';
const tts=await createPocketNode();
try{
 for(const id of ['prime','fenix']){
   console.log('Cloning',id);
   const file=await readFile(new URL(`../public/references/${id}.wav`,import.meta.url));
   const {samples,sampleRate}=decodePcmWav(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength));
   const voice=await tts.cloneVoice(samples,{inputSampleRate:sampleRate,name:id});
   const chunks=[];
   const result=await tts.generate('Good morning, church. Take a breath. Now, let us begin.',{voice,onChunk:audio=>chunks.push(audio)});
   const output=concatenate(chunks);if(!output.length)throw Error('No cloned audio');
   await writeFile(new URL(`../public/auditions/${id}.wav`,import.meta.url),new Uint8Array(encodeWav([output],tts.sampleRate)));
   console.log(id,JSON.stringify(result),output.length);
 }
}finally{tts.destroy();}
