// Maintainer-only sample generation. No customer manuscript enters this script.
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {KokoroTTS} from 'kokoro-js';
import {voices} from '../src/voices.js';
import {characterEffect} from '../src/audio-effects.js';
import {encodeWav} from '../src/core.js';
const text='Good morning, church. Take a breath. Now, let us begin.';
const root=resolve(import.meta.dirname,'..'),cache=resolve(root,'.cache/auditions'),output=resolve(root,'public/auditions');
await mkdir(cache,{recursive:true});await mkdir(output,{recursive:true});
const helper=await readFile(resolve(root,'src/vendor/supertonic.js'),'utf8');
const nodeHelper=resolve(cache,'supertonic-node.mjs');
await writeFile(nodeHelper,helper.replace("import * as ort from 'onnxruntime-web/webgpu';","import * as ort from 'onnxruntime-node';"));
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
  const url=String(input);
  if(!url.startsWith('https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/'))return originalFetch(input,options);
  const parsed=new URL(url),path=resolve(cache,parsed.pathname.split('/').slice(5).join('/'));
  if(!path.startsWith(cache))throw Error('Invalid cache path');
  try{return new Response(await readFile(path));}catch{}
  const response=await originalFetch(input,options);if(!response.ok)throw Error(`Download ${response.status}: ${url}`);
  const bytes=new Uint8Array(await response.arrayBuffer());await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);return new Response(bytes);
};
const {loadTextToSpeech,loadVoiceStyle}=await import(pathToFileURL(nodeHelper));
const assets='https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/aafc6e32416a594460b32413efc49d7fe4ce6d46';
let supertonic,kokoro;const styles=new Map();const manifest=[];
for(const profile of voices){
  const destination=resolve(output,`${profile.id}.wav`);
  try{await access(destination);console.log(`Exists: ${profile.id}`);manifest.push({id:profile.id,file:`${profile.id}.wav`,text});continue;}catch{}
  console.log(`Rendering: ${profile.name}`);
  let samples,sampleRate;
  const speed=(profile.pace??1)/(profile.pitch??1);
  if(profile.engine==='supertonic'){
    supertonic??=(await loadTextToSpeech(`${assets}/onnx`,{executionProviders:['cpu'],intraOpNumThreads:4})).textToSpeech;
    if(!styles.has(profile.base))styles.set(profile.base,await loadVoiceStyle([`${assets}/voice_styles/${profile.base}.json`]));
    const audio=await supertonic.batch([text],['en'],styles.get(profile.base),8,speed);
    sampleRate=supertonic.sampleRate;samples=Float32Array.from(audio.wav.slice(0,Math.floor(audio.duration[0]*sampleRate)));
  }else{
    kokoro??=await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{dtype:'q8',device:'cpu'});
    const audio=await kokoro.generate(text,{voice:profile.base,speed});samples=audio.audio;sampleRate=audio.sampling_rate;
  }
  if(!samples.length)throw Error(`Empty sample: ${profile.id}`);
  const wav=encodeWav([characterEffect(samples,sampleRate,profile)],sampleRate);
  await writeFile(destination,new Uint8Array(wav));manifest.push({id:profile.id,file:`${profile.id}.wav`,text});
}
await writeFile(resolve(output,'manifest.json'),JSON.stringify({text,voices:manifest},null,2)+'\n');
console.log(`Saved ${manifest.length} auditions.`);
