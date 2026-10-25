import {CharacterTTS} from './pocket-client.js';
import {decodePcmWav,concatenate} from './pcm.js';
import {changeTempo} from './tempo.js';
import {verifiedBytes} from './asset-integrity.js';
let tts;const prepared=new Map();
export async function pocket(text,voice,speed,progress,{reference}={}){
  const loading=performance.now(),modelLoadAttempts=tts?.ready?0:1;
  if(!tts){tts=new CharacterTTS({language:'english_2026-04',quantized:true,voiceCloning:true,maxThreads:1,
    modelBaseUrl:'https://huggingface.co/vlapky/pocket-tts-onnx/resolve/c469236dbc5f68287fa2fbf175b66de3b80123af/onnx',cacheName:'sirmonator-pocket-april-v1'});}
  if(!tts.ready)await tts.load(p=>{
    if(p.label)progress(`Loading free character voices: ${p.label} · ${p.total?Math.round(p.loaded/p.total*100)+'%':((p.loaded??0)/1048576).toFixed(1)+' MB'}. First use downloads about 150 MB.`);
  });
  const loadMs=performance.now()-loading;
  if(!prepared.has(voice)){
    progress('Preparing the natural character voice from its speech reference…');
    const response=await fetch(new URL('../references/'+voice+'.wav?v=3',import.meta.url));
    if(!response.ok)throw Error('Could not load this character voice reference.');
    const bytes=await response.arrayBuffer();if(reference)await verifiedBytes(bytes,reference);
    const {samples,sampleRate}=decodePcmWav(bytes);
    prepared.set(voice,await tts.cloneVoice(samples,{inputSampleRate:sampleRate,name:voice}));
  }
  progress('Reading your words in the reference-conditioned character voice…');
  const inferenceStarted=performance.now(),parts=[];
  const metrics=await tts.generate(text,{voice:prepared.get(voice),onChunk:audio=>parts.push(audio)});
  if(metrics.stopped)throw Error('Character reading was interrupted. No complete audio was created.');
  return {samples:changeTempo(concatenate(parts),speed,tts.sampleRate),sampleRate:tts.sampleRate,runtime:{provider:'wasm',dtype:'quantized',loadMs,inferenceMs:performance.now()-inferenceStarted,modelLoadAttempts,retries:0}};
}
