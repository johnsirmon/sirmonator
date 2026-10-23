import * as ort from 'onnxruntime-web/webgpu';
import {loadTextToSpeech,loadVoiceStyle} from './vendor/supertonic.js';
const assets='https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/aafc6e32416a594460b32413efc49d7fe4ce6d46';
let engine;
const styles=new Map();
export async function supertonic(text,voice,speed,progress){
  if(!engine){
    ort.env.wasm.numThreads=1;
    let gpu=false;try{gpu=!!await navigator.gpu?.requestAdapter();}catch{}
    const load=provider=>loadTextToSpeech(`${assets}/onnx`,{executionProviders:[provider],graphOptimizationLevel:'all'},(name,current,total)=>progress(`Loading Supertonic 3: ${name} (${current}/${total}). First use downloads about 400 MB; please keep this page open.`));
    try{({textToSpeech:engine}=await load(gpu?'webgpu':'wasm'));}
    catch(e){if(!gpu)throw e;progress('GPU could not load this model. Trying CPU…');({textToSpeech:engine}=await load('wasm'));}
  }
  if(!styles.has(voice))styles.set(voice,await loadVoiceStyle([`${assets}/voice_styles/${voice}.json`]));
  progress('Giving your words a voice…');
  // batch() avoids the vendor call() text splitter; our integrity-checked passages
  // go directly to inference. No expressive tags or extra words are inserted.
  const {wav,duration}=await engine.batch([text],['en'],styles.get(voice),8,speed);
  return {samples:Float32Array.from(wav.slice(0,Math.floor(duration[0]*engine.sampleRate))),sampleRate:engine.sampleRate};
}
