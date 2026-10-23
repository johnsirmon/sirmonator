import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';
import { encodeWav } from './core.js';
env.backends.onnx.wasm.numThreads = 1;
let tts;
self.onmessage = async ({data}) => {
  try {
    self.postMessage({type:'stage',message:'Loading the voice engine. First use can take several minutes…'});
    if (!tts) {
      let gpu=false;
      try { gpu=!!(await navigator.gpu?.requestAdapter()); } catch {}
      const load = device => KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype:device==='webgpu'?'fp32':'q8', device, progress_callback: p => {
        if (p.status === 'progress') self.postMessage({type:'loading',file:p.file,progress:p.progress});
      }
      });
      self.postMessage({type:'stage',message:gpu?'Loading accelerated natural voices…':'Loading CPU natural voices. Creation may be slow on this device; Quick listen is immediate.'});
      try { tts=await load(gpu?'webgpu':'wasm'); }
      catch(e) { if(!gpu)throw e;self.postMessage({type:'stage',message:'GPU unavailable. Loading CPU voice engine instead…'});tts=await load('wasm'); }
    }
    const parts = []; let sampleRate = 24000;
    for (let i=0;i<data.chunks.length;i++) {
      const text = data.chunks[i];
      self.postMessage({type:'stage',message:`Voicing passage ${i+1} of ${data.chunks.length}. Keep this page open; local speech generation can be slower than playback.`});
      if (text.trim()) {
        const audio = await tts.generate(text,{voice:data.voice,speed:data.speed});
        if (!audio.audio?.length) throw new Error('A passage produced no audio. No completed file was created.');
        sampleRate = audio.sampling_rate; parts.push(audio.audio);
      }
      self.postMessage({type:'progress',done:i+1,total:data.chunks.length});
    }
    const wav = encodeWav(parts,sampleRate);
    self.postMessage({type:'complete',wav},[wav]);
  } catch(e) { self.postMessage({type:'error',message:e.message}); }
};
