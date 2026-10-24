import {encodeMp3,mp3Duration} from './mp3.js';
import {characterVoice} from './character-settings.js';
import {getVoice} from './voices.js';
import {quantizePcm,LEGACY_PIPELINE,CONTINUITY_PIPELINE} from './continuity.js';
import {characterEffect,pauseAfter} from './audio-effects.js';
import {createSpeechRunner} from './speech-runner.js';
let kokoroRunner,kokoroLoads=0,kokoroProvider=null;
async function kokoro(text,voice,speed,progress){
  if(!kokoroRunner){
    const [{KokoroTTS},{env}]=await Promise.all([import('kokoro-js'),import('@huggingface/transformers')]);
    env.backends.onnx.wasm.numThreads=1;
    let gpu=false;try{gpu=!!await navigator.gpu?.requestAdapter();}catch{}
    const load=device=>{kokoroLoads++;kokoroProvider=device;return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{
      dtype:device==='webgpu'?'fp32':'q8',device,progress_callback:p=>{if(p.status==='progress')self.postMessage({type:'loading',file:p.file,progress:p.progress});}
    });};
    kokoroRunner=createSpeechRunner({load,initialProvider:gpu?'webgpu':'wasm',
      infer:async(tts,{text,voice,speed})=>{const audio=await tts.generate(text,{voice,speed});return {samples:audio.audio,sampleRate:audio.sampling_rate};},
      release:tts=>tts.model.dispose()
    });
  }
  return kokoroRunner({text,voice,speed},progress);
}
self.onmessage=async({data})=>{
  const requestId=data.requestId,started=performance.now(),initialLoads=kokoroLoads;
  const progress=message=>self.postMessage({type:'stage',requestId,message});
  try{
    if(!data.text.trim()){
      const pcm=data.settings.pipeline===CONTINUITY_PIPELINE;
      self.postMessage({type:'passage',requestId,bytes:new ArrayBuffer(0),seconds:0,...(pcm?{format:'pcm-s16le',sampleCount:0,channels:1,sampleRate:getVoice(data.settings.voice).engine==='supertonic'?44100:24000}:{})});return;
    }
    const profile=getVoice(data.settings.voice),speed=data.settings.speed;
    progress('Synthesizing this passage. First use may need to load the voice model.');
    const audio=profile.engine==='pocket'
      ?await (await import('./pocket-engine.js')).pocket(data.text,characterVoice(profile.base,data.settings.edition),speed,progress)
      :profile.engine==='supertonic'
      ?await (await import('./supertonic-engine.js')).supertonic(data.text,profile.base,speed,progress)
      :await kokoro(data.text,profile.base,speed,progress);
    if(!audio.samples?.length)throw Error('A passage produced no audio.');
    const synthesized=performance.now();
    const samples=characterEffect(audio.samples,audio.sampleRate,profile);
    const pipeline=data.settings.pipeline??LEGACY_PIPELINE;
    if(![LEGACY_PIPELINE,CONTINUITY_PIPELINE].includes(pipeline))throw Error('Unknown audio pipeline.');
    const pause=data.last?0:pauseAfter(data.text,data.settings.delivery);
    const padded=new Float32Array(samples.length+Math.round(pause*audio.sampleRate));padded.set(samples);
    if(pipeline===CONTINUITY_PIPELINE){
      const bytes=quantizePcm(padded);
      self.postMessage({type:'passage',requestId,bytes,seconds:padded.length/audio.sampleRate,sampleRate:audio.sampleRate,sampleCount:padded.length,channels:1,format:'pcm-s16le'},[bytes]);return;
    }
    progress('Encoding this passage as MP3…');
    const encoderPath='../vendor/lamejs.js';
    const {Mp3Encoder}=await import(/* @vite-ignore */ new URL(encoderPath,import.meta.url).href);
    const encodingStarted=performance.now();
    const encoded=encodeMp3(padded,audio.sampleRate,Mp3Encoder),seconds=mp3Duration(encoded);
    self.postMessage({type:'passage',requestId,bytes:encoded.buffer,seconds,sampleRate:audio.sampleRate,metrics:{renderMs:synthesized-started,encodingMs:performance.now()-encodingStarted,totalMs:performance.now()-started,modelLoads:kokoroLoads-initialLoads,provider:profile.engine==='kokoro'?kokoroProvider:'wasm'}},[encoded.buffer]);
  }catch(error){self.postMessage({type:'error',requestId,message:error.message});}
};
