import {encodeWav} from './core.js';
import {getVoice} from './voices.js';
import {characterEffect,pauseAfter} from './audio-effects.js';
let tts;
async function kokoro(text,voice,speed){
  if(!tts){
    const [{KokoroTTS},{env}]=await Promise.all([import('kokoro-js'),import('@huggingface/transformers')]);
    env.backends.onnx.wasm.numThreads=1;
    let gpu=false;try{gpu=!!await navigator.gpu?.requestAdapter();}catch{}
    const load=device=>KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{
      dtype:device==='webgpu'?'fp32':'q8',device,progress_callback:p=>{if(p.status==='progress')self.postMessage({type:'loading',file:p.file,progress:p.progress});}
    });
    try{tts=await load(gpu?'webgpu':'wasm');}catch(e){if(!gpu)throw e;tts=await load('wasm');}
  }
  const audio=await tts.generate(text,{voice,speed});return {samples:audio.audio,sampleRate:audio.sampling_rate};
}
self.onmessage=async({data})=>{
  try{
    const profile=getVoice(data.voice);
    self.postMessage({type:'stage',message:'Waking up your narrator. First use downloads the free voice model…'});
    const parts=[];let sampleRate=24000;
    for(let i=0;i<data.chunks.length;i++){
      const text=data.chunks[i];
      self.postMessage({type:'stage',message:`Voicing passage ${i+1} of ${data.chunks.length}. Keep this page open.`});
      if(text.trim()){
        const speed=data.speed*(profile.pace??1)/(profile.pitch??1);
        const progress=message=>self.postMessage({type:'stage',message});
        const audio=profile.engine==='supertonic'
          ?await (await import('./supertonic-engine.js')).supertonic(text,profile.base,speed,progress)
          :await kokoro(text,profile.base,speed);
        if(!audio.samples?.length)throw Error('A passage produced no audio. No completed file was created.');
        sampleRate=audio.sampleRate;
        parts.push(characterEffect(audio.samples,sampleRate,profile));
        if(i<data.chunks.length-1){const pause=pauseAfter(text,data.delivery);if(pause)parts.push(new Float32Array(Math.round(pause*sampleRate)));}
      }
      self.postMessage({type:'progress',done:i+1,total:data.chunks.length});
    }
    const wav=encodeWav(parts,sampleRate);self.postMessage({type:'complete',wav},[wav]);
  }catch(e){self.postMessage({type:'error',message:e.message});}
};
