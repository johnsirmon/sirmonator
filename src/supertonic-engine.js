import * as ort from 'onnxruntime-web/webgpu';
import {loadTextToSpeech,loadVoiceStyle} from './vendor/supertonic.js';
import {createSpeechRunner} from './speech-runner.js';
const assets='https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/aafc6e32416a594460b32413efc49d7fe4ce6d46';
const styles=new Map();
let runtime;
const run=createSpeechRunner({
  onMetrics:metrics=>{runtime={...metrics,dtype:'upstream-model'};},
  // Supertonic's multi-session GPU pipeline can lose its device on integrated
  // graphics. WASM is the compatible default, including embedded browsers.
  initialProvider:'wasm',
  load:async(provider,progress)=>{
    ort.env.wasm.numThreads=1;
    const {textToSpeech}=await loadTextToSpeech(`${assets}/onnx`,{executionProviders:[provider],graphOptimizationLevel:'all'},(name,current,total)=>progress(`Loading Supertonic 3: ${name} (${current}/${total}). First use downloads about 400 MB; please keep this page open.`));
    return textToSpeech;
  },
  infer:async(engine,{text,voice,speed,progress})=>{
    if(!styles.has(voice))styles.set(voice,await loadVoiceStyle([`${assets}/voice_styles/${voice}.json`]));
    progress('Giving your words a voice…');
    const {wav,duration}=await engine.batch([text],['en'],styles.get(voice),8,speed);
    return {samples:Float32Array.from(wav.slice(0,Math.floor(duration[0]*engine.sampleRate))),sampleRate:engine.sampleRate};
  },
  release:engine=>Promise.allSettled([engine.dpOrt,engine.textEncOrt,engine.vectorEstOrt,engine.vocoderOrt].map(s=>s.release()))
});
export async function supertonic(text,voice,speed,progress){
  const audio=await run({text,voice,speed,progress},progress);return {...audio,runtime};
}
