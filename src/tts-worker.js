import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';
import { encodeWav } from './core.js';
env.backends.onnx.wasm.numThreads = 1;
let tts;
self.onmessage = async ({data}) => {
  try {
    if (!tts) tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype:'q8', device:'wasm', progress_callback: p => {
        if (p.status === 'progress') self.postMessage({type:'loading',file:p.file,progress:p.progress});
      }
    });
    const parts = []; let sampleRate = 24000;
    for (let i=0;i<data.chunks.length;i++) {
      const text = data.chunks[i];
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
