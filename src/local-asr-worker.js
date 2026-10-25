import {pipeline,env} from '@huggingface/transformers';
import {ASR_MODEL,loadAsrAssets} from './asr-cache.js';
// These URLs resolve through Transformers.js's nested ORT, not the separate
// runtime used by other engines. Vite emits both assets on the same origin.
import wasmUrl from '../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';
import wasmModuleUrl from '../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url';
self.onmessage=async({data})=>{
 const progress=message=>self.postMessage({type:'progress',message});let transcriber;
 try{
  if(!(data.samples instanceof Float32Array)||data.samples.length<1||data.samples.length>480000||data.samples.some(x=>!Number.isFinite(x)))throw Error('Invalid ASR PCM input.');
  const started=performance.now();env.useBrowserCache=false;env.useFSCache=false;env.useCustomCache=true;env.customCache=await loadAsrAssets({onProgress:progress});env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath='/models/';
  env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
  env.backends.onnx.wasm.wasmPaths={wasm:wasmUrl,mjs:wasmModuleUrl};
  // A cache miss must never fall back to an unverified local/remote model file.
  // Only the two bundled same-origin runtime assets may be fetched from here.
  const fetchRuntime=self.fetch.bind(self),runtimeUrls=new Set([wasmUrl,wasmModuleUrl].map(url=>new URL(url,self.location.href).href));
  self.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url??String(input),self.location.href);if(url.origin!==self.location.origin||!runtimeUrls.has(url.href))throw Error('Unverified ASR asset request blocked. Use manual review.');return fetchRuntime(input,options);};
  progress('Loading local English ASR (cancel remains available)…');
  transcriber=await pipeline('automatic-speech-recognition',ASR_MODEL.model,{revision:ASR_MODEL.revision,device:'wasm',dtype:'q8',local_files_only:true});
  progress('Transcribing locally (up to 30 seconds; cancel remains available)…');
  const output=await transcriber(data.samples,{max_new_tokens:128,return_timestamps:false});
  if(typeof output.text!=='string')throw Error('Local ASR returned no transcript.');
  self.postMessage({type:'result',transcript:output.text,model:ASR_MODEL.model,revision:ASR_MODEL.revision,dtype:'q8',device:'wasm',elapsedMs:performance.now()-started,tokenLimit:128});
 }catch(error){self.postMessage({type:'error',message:error.message});}finally{try{await transcriber?.dispose();}catch{}}
};
