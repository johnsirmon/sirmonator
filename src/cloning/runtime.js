import {PocketTTS} from 'pocket-tts-js';
import {CLONE_CONTRACT} from './contract.js';
export class LocalCloneTTS extends PocketTTS{
 _ensureWorker(){
  if(this.worker)return;
  this.worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  this.worker.onmessage=e=>this._handleMessage(e.data);
  this.worker.onerror=e=>{const error=Error(e.message||'Local cloning worker failed.');this.destroy(error);};
 }
 destroy(error=new DOMException('Local cloning session closed.','AbortError')){
  for(const {reject} of this._pending.values())reject(error);
  super.destroy();
 }
}
export async function createCloneRuntime({signal,onProgress}={}){
 const engine=new LocalCloneTTS({language:'english_2026-04',quantized:true,voiceCloning:true,maxThreads:1,cacheName:'sirmonator-pocket-april-v1',modelBaseUrl:'https://huggingface.co/vlapky/pocket-tts-onnx/resolve/'+CLONE_CONTRACT.modelRevision+'/onnx',ortBaseUrl:'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/'});
 const abort=()=>engine.destroy();signal?.addEventListener('abort',abort,{once:true});
 const destroy=engine.destroy.bind(engine);engine.destroy=(...args)=>{signal?.removeEventListener('abort',abort);destroy(...args);};
 engine.referenceContract=structuredClone(CLONE_CONTRACT);
 try{if(signal?.aborted)throw new DOMException('Cancelled.','AbortError');await engine.load(onProgress);return engine;}catch(error){engine.destroy();throw error;}
}
