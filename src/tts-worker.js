import {encodeMp3,mp3Duration} from './mp3.js';
import {characterVoice} from './character-settings.js';
import {getVoice} from './voices.js';
import {quantizePcm,LEGACY_PIPELINE,CONTINUITY_PIPELINE,isPcmPipeline} from './continuity.js';
import {FOUNDATION_PIPELINE,assertSupportedManifest} from './render-provenance.js';
import {renderMetrics} from './render-metrics.js';
import {characterEffect,pauseAfter} from './audio-effects.js';
import {createSpeechRunner} from './speech-runner.js';
import {spokenPassage} from './pronunciation.js';
let kokoroRunner,kokoroLoads=0,kokoroProvider=null,kokoroRuntime,family=null;
async function kokoro(text,voice,speed,progress,frozen){
  if(!kokoroRunner){
    const [{KokoroTTS},{env}]=await Promise.all([import('kokoro-js'),import('@huggingface/transformers')]);
    env.backends.onnx.wasm.numThreads=1;
    let gpu=false;try{gpu=!!await navigator.gpu?.requestAdapter();}catch{}
    const load=async device=>{kokoroLoads++;kokoroProvider=device;const options={
      dtype:device==='webgpu'?'fp32':'q8',device,progress_callback:p=>{if(p.status==='progress')self.postMessage({type:'loading',file:p.file,progress:p.progress});}
    };return frozen?(await import('./pinned-kokoro.js')).loadPinnedKokoro(options):KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',options);};
    kokoroRunner=createSpeechRunner({load,initialProvider:gpu?'webgpu':'wasm',
      onMetrics:m=>{kokoroRuntime={...m,provider:kokoroProvider,dtype:kokoroProvider==='webgpu'?'fp32':'q8'};},
      infer:async(tts,{text,voice,speed})=>{const audio=await tts.generate(text,{voice,speed});return {samples:audio.audio,sampleRate:audio.sampling_rate};},
      release:tts=>tts.model.dispose()
    });
  }
  const audio=await kokoroRunner({text,voice,speed},progress);return {...audio,runtime:kokoroRuntime};
}
self.onmessage=async({data})=>{
  const requestId=data.requestId,started=performance.now();
  const progress=message=>self.postMessage({type:'stage',requestId,message});
  try{
    const profile=getVoice(data.settings.voice),speed=data.settings.speed,pipeline=data.settings.pipeline??LEGACY_PIPELINE;
    if(![LEGACY_PIPELINE,CONTINUITY_PIPELINE,FOUNDATION_PIPELINE].includes(pipeline))throw Error('Unknown audio pipeline.');
    assertSupportedManifest(data.settings);
    const frozen=pipeline===FOUNDATION_PIPELINE,nextFamily=profile.engine+':'+(frozen?'frozen':'legacy');
    if(family&&family!==nextFamily)throw Error('Changing render families requires a fresh worker.');family=nextFamily;
    const provenance=frozen?{renderManifest:data.settings.renderManifest}:{};
    const spoken=spokenPassage(data.text,data.settings.pronunciation).text;
    if(data.settings.pronunciation)provenance.spokenText=spoken;
    if(!data.text.trim()){
      const sampleRate=profile.engine==='supertonic'?44100:24000,pcm=isPcmPipeline(pipeline)&&!data.preview;
      const audio={samples:new Float32Array(0),sampleRate,runtime:{provider:'none',dtype:'none',loadMs:0,inferenceMs:0,modelLoadAttempts:0,retries:0}};
      const metrics=renderMetrics({started,synthesized:started,finished:performance.now(),audio,outputSeconds:0,format:pcm?'pcm-s16le':'mp3',engine:'empty'});
      self.postMessage({type:'passage',requestId,bytes:new ArrayBuffer(0),seconds:0,metrics,...provenance,...(pcm?{format:'pcm-s16le',sampleCount:0,channels:1,sampleRate}:{})});return;
    }
    progress('Synthesizing this passage. First use may need to load the voice model.');
    const audio=profile.engine==='pocket'
      ?await (await import('./pocket-engine.js')).pocket(spoken,characterVoice(profile.base,data.settings.edition),speed,progress,{reference:frozen?data.settings.renderManifest.model.reference:undefined})
      :profile.engine==='supertonic'
      ?await (await import('./supertonic-engine.js')).supertonic(spoken,profile.base,speed,progress)
      :await kokoro(spoken,profile.base,speed,progress,frozen);
    if(!audio.samples?.length)throw Error('A passage produced no audio.');
    const synthesized=performance.now(),samples=characterEffect(audio.samples,audio.sampleRate,profile);
    const pause=data.last?0:pauseAfter(data.text,data.settings.delivery);
    const padded=new Float32Array(samples.length+Math.round(pause*audio.sampleRate));padded.set(samples);
    if(isPcmPipeline(pipeline)&&!data.preview){
      const bytes=quantizePcm(padded),seconds=padded.length/audio.sampleRate;
      const metrics=renderMetrics({started,synthesized,finished:performance.now(),audio,outputSeconds:seconds,format:'pcm-s16le',engine:profile.engine});
      self.postMessage({type:'passage',requestId,bytes,seconds,sampleRate:audio.sampleRate,sampleCount:padded.length,channels:1,format:'pcm-s16le',metrics,...provenance},[bytes]);return;
    }
    progress('Encoding this passage as MP3.');
    const encoderPath='../vendor/lamejs.js';
    const {Mp3Encoder}=await import(/* @vite-ignore */ new URL(encoderPath,import.meta.url).href);
    const encodingStarted=performance.now(),encoded=encodeMp3(padded,audio.sampleRate,Mp3Encoder),seconds=mp3Duration(encoded),encodingMs=performance.now()-encodingStarted;
    const metrics=renderMetrics({started,synthesized,finished:performance.now(),audio,encodingMs,outputSeconds:seconds,format:'mp3',engine:profile.engine});
    self.postMessage({type:'passage',requestId,bytes:encoded.buffer,seconds,sampleRate:audio.sampleRate,metrics:{...metrics,modelLoads:metrics.modelLoadAttempts},...provenance},[encoded.buffer]);
  }catch(error){self.postMessage({type:'error',requestId,message:error.message});}
};
