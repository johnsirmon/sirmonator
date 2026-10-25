// Run the pinned browser inference implementation on Node's CPU runtime for
// reproducible audition assets. These adaptations live only in ignored cache.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Worker as NodeWorker} from 'node:worker_threads';
import {CharacterTTS} from '../src/pocket-client.js';
import {PocketTTS} from 'pocket-tts-js';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {CUSTOM_REFERENCE_CONTRACT} from './custom-reference-contract.mjs';
const root=resolve(import.meta.dirname,'..'),cache=resolve(root,'.cache/pocket-node');
export async function createPocketNode({offline=false,signal,route='character'}={}){
  if(!['character','custom-reference-v1'].includes(route))throw Error('Unknown Pocket runtime route');
  const custom=route==='custom-reference-v1';
  if(custom&&!offline)throw Error('Custom reference experiment requires offline mode');
  if(custom){
    const inventoryText=(await readFile(resolve(root,'evidence/reference-model-inventory.json'),'utf8')).replaceAll('\r\n','\n');
    if(createHash('sha256').update(inventoryText).digest('hex')!==CUSTOM_REFERENCE_CONTRACT.modelInventorySha256)throw Error('Custom reference model inventory changed');
    const inventory=JSON.parse(inventoryText);
    const runtime=JSON.parse(await readFile(resolve(root,'node_modules/onnxruntime-node/package.json'),'utf8'));
    if(runtime.version!=='1.21.0')throw Error('Unsupported custom reference ONNX runtime');
    for(const file of inventory.files){
      if(signal?.aborted)throw new DOMException('Reference verification cancelled.','AbortError');
      const hash=createHash('sha256');
      for await(const bytes of createReadStream(resolve(cache,'models',inventory.revision,'onnx/english_2026-04',file.name))){if(signal?.aborted)throw new DOMException('Reference verification cancelled.','AbortError');hash.update(bytes);}
      if(file.verified!==true||hash.digest('hex')!==file.sha256)throw Error('Custom reference cached model changed: '+file.name);
    }
  }
  const runtimeCache=custom?resolve(cache,'custom-reference-v1'):cache;
  await mkdir(runtimeCache,{recursive:true});
  const sourceDir=resolve(root,custom?'node_modules/pocket-tts-js/src':'src/vendor/pocket');
  let source=await readFile(resolve(sourceDir,'worker.js'),'utf8');
  source=source.replace(/\r\n/g,'\n');
  if(custom&&createHash('sha256').update(source).digest('hex')!==CUSTOM_REFERENCE_CONTRACT.workerSha256)throw Error('Unsupported custom reference worker; originals remain unchanged');
  for(const file of ['tokenizer.js','binary.js'])source=source.replace(`"./${file}"`,JSON.stringify(pathToFileURL(resolve(sourceDir,file)).href));
  source=source.replace('"../../character-settings.js"',JSON.stringify(pathToFileURL(resolve(root,'src/character-settings.js')).href));
  source=source.replace(/async function loadOrt\(\) \{[\s\S]*?\n\}\n\nasync function createSession/,`async function loadOrt(){ort=await import('onnxruntime-node');precomputeFlowBuffers();}\n\nasync function createSession`);
  source=source.replace('executionProviders: ["wasm"]','executionProviders: ["cpu"], intraOpNumThreads: 4');
  await writeFile(resolve(runtimeCache,'inference.mjs'),source);
  await writeFile(resolve(runtimeCache,'entry.mjs'),`
import {parentPort} from 'node:worker_threads';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
globalThis.self=globalThis;
self.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);
const originalFetch=fetch;
globalThis.fetch=async(input,options)=>{
 const url=String(input);if(!url.startsWith('https://huggingface.co/vlapky/pocket-tts-onnx/resolve/')){if(${JSON.stringify(offline)})throw Error('External network disabled for reference verification');return originalFetch(input,options);}
 const path=resolve(${JSON.stringify(cache)},'models',new URL(url).pathname.split('/').slice(4).join('/'));
 try{return new Response(await readFile(path));}catch{}
 if(${JSON.stringify(offline)})throw Error('Required Pocket asset is not in the existing local cache');
 const response=await originalFetch(input,options);if(!response.ok)throw Error('Pocket model download '+response.status);
 const data=new Uint8Array(await response.arrayBuffer());await mkdir(dirname(path),{recursive:true});await writeFile(path,data);return new Response(data);
};
await import('./inference.mjs');
parentPort.on('message',data=>self.onmessage({data}));
`);
  const terminations=[];
  class BridgeWorker{
    constructor(){
      this.active=new Set();this.closing=false;this.termination=null;
      this.worker=new NodeWorker(pathToFileURL(resolve(runtimeCache,'entry.mjs')));
      this.worker.on('message',data=>{
        if(['result','error'].includes(data.type))this.active.delete(data.id);
        if(!this.closing)this.onmessage?.({data});
        if(this.closing&&!this.active.size)this.finishTermination();
      });
      this.worker.on('error',error=>{this.active.clear();if(!this.closing)this.onerror?.(error);else this.finishTermination();});
    }
    postMessage(data,transfer){if(this.closing)throw Error('Pocket runtime is disposing');this.active.add(data.id);this.worker.postMessage(data,transfer);}
    finishTermination(){if(this.terminating)return;this.terminating=true;this.worker.terminate().then(this.resolveTermination,this.rejectTermination);}
    terminate(){
      if(this.termination)return this.termination;
      this.closing=true;this.termination=new Promise((resolve,reject)=>{this.resolveTermination=resolve;this.rejectTermination=reject;});terminations.push(this.termination);
      // Native ONNX sessions must finish their active call before terminating a
      // Node worker. Publication is already rejected; ignore all late messages.
      if(custom&&this.active.size)this.worker.postMessage({id:-1,type:'stop',payload:{}});
      else this.finishTermination();
      return this.termination;
    }
  }
  const previous=globalThis.Worker;globalThis.Worker=BridgeWorker;
  const Runtime=custom?PocketTTS:CharacterTTS;
  const tts=new Runtime({language:'english_2026-04',quantized:true,voiceCloning:true,maxThreads:1,modelBaseUrl:'https://huggingface.co/vlapky/pocket-tts-onnx/resolve/c469236dbc5f68287fa2fbf175b66de3b80123af/onnx'});
  if(custom)tts.referenceContract=structuredClone(CUSTOM_REFERENCE_CONTRACT);
  try{tts._ensureWorker();}finally{globalThis.Worker=previous;}
  const destroy=tts.destroy.bind(tts),abort=()=>tts.destroy();
  tts.destroy=()=>{signal?.removeEventListener('abort',abort);for(const pending of tts._pending.values())pending.reject(new DOMException('Pocket verification cancelled.','AbortError'));destroy();};
  tts.waitForTerminations=()=>Promise.all(terminations);
  signal?.addEventListener('abort',abort,{once:true});
  try{if(signal?.aborted)throw new DOMException('Pocket verification cancelled.','AbortError');await tts.load(p=>{if(p.type==='status')console.log(p.status);});}catch(error){tts.destroy();await tts.waitForTerminations();throw error;}
  return tts;
}
