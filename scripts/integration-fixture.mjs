// Procedural CC0 tones, never speech or a person's voice. Test harness only.
import {quantizePcm} from '../src/continuity.js';
import {renderMetrics} from '../src/render-metrics.js';
import {spokenPassage} from '../src/pronunciation.js';
import {getVoice} from '../src/voices.js';
import {pauseAfter} from '../src/audio-effects.js';
import {encodeMp3,mp3Duration} from '../src/mp3.js';
export const INTEGRATION_SOURCE='Paul arrived.\n\nPaul listened.\n\nPaul left.';
export async function syntheticPassage({text,settings,last=false,preview=false},ordinal=1){
 const sampleRate=24000,count=4800+ordinal*240,samples=Float32Array.from({length:count},(_,i)=>.1*Math.sin(2*Math.PI*(220+ordinal*15)*i/sampleRate)),padded=new Float32Array(count+(last?0:Math.round(pauseAfter(text,settings.delivery)*sampleRate)));padded.set(samples);
 let bytes=quantizePcm(padded),seconds=padded.length/sampleRate;
 if(preview){const path='/vendor/lamejs.js',module=typeof process!=='undefined'&&process.versions?.node?await import('@breezystack/lamejs'):await import(/* @vite-ignore */ path);const mp3=encodeMp3(padded,sampleRate,module.Mp3Encoder);bytes=mp3.buffer;seconds=mp3Duration(mp3);}
 const metrics=renderMetrics({started:0,synthesized:0,finished:0,audio:{samples,sampleRate,runtime:{provider:'none',dtype:'synthetic-tone-fixture',loadMs:0,inferenceMs:0,modelLoadAttempts:0,retries:0}},outputSeconds:seconds,format:preview?'mp3':'pcm-s16le',engine:getVoice(settings.voice).engine});metrics.fixture='Procedural CC0 tone; no model inference';
 return {bytes,seconds,sampleRate,metrics,renderManifest:settings.renderManifest,spokenText:spokenPassage(text,settings.pronunciation).text,...(!preview?{sampleCount:padded.length,channels:1,format:'pcm-s16le'}:{})};
}
export function createSyntheticWorker({delayMs=0,onInput=()=>{}}={}){
 let ordinal=0,closed=false;const timers=new Set();return {postMessage(data){onInput(data);this.onmessage?.({data:{type:'stage',requestId:data.requestId,message:'SIMULATION: procedural tone; no voice model or speech.'}});const timer=setTimeout(async()=>{timers.delete(timer);try{const audio=await syntheticPassage(data,++ordinal);if(!closed)this.onmessage?.({data:{...audio,type:'passage',requestId:data.requestId}});}catch(error){if(!closed)this.onmessage?.({data:{type:'error',requestId:data.requestId,message:error.message}});}},delayMs);timers.add(timer);},terminate(){closed=true;for(const timer of timers)clearTimeout(timer);timers.clear();}};
}
