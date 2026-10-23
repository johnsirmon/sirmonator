// Run the pinned browser inference implementation on Node's CPU runtime for
// reproducible audition assets. These adaptations live only in ignored cache.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Worker as NodeWorker} from 'node:worker_threads';
import {PocketTTS} from 'pocket-tts-js';
const root=resolve(import.meta.dirname,'..'),cache=resolve(root,'.cache/pocket-node');
export async function createPocketNode(){
  await mkdir(cache,{recursive:true});
  const sourceDir=resolve(root,'node_modules/pocket-tts-js/src');
  let source=await readFile(resolve(sourceDir,'worker.js'),'utf8');
  for(const file of ['tokenizer.js','binary.js'])source=source.replace(`"./${file}"`,JSON.stringify(pathToFileURL(resolve(sourceDir,file)).href));
  source=source.replace(/async function loadOrt\(\) \{[\s\S]*?\n\}\n\nasync function createSession/,`async function loadOrt(){ort=await import('onnxruntime-node');precomputeFlowBuffers();}\n\nasync function createSession`);
  source=source.replace('executionProviders: ["wasm"]','executionProviders: ["cpu"], intraOpNumThreads: 4');
  await writeFile(resolve(cache,'inference.mjs'),source);
  await writeFile(resolve(cache,'entry.mjs'),`
import {parentPort} from 'node:worker_threads';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
globalThis.self=globalThis;
self.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);
const originalFetch=fetch;
globalThis.fetch=async(input,options)=>{
 const url=String(input);if(!url.startsWith('https://huggingface.co/vlapky/pocket-tts-onnx/resolve/'))return originalFetch(input,options);
 const path=resolve(${JSON.stringify(cache)},'models',new URL(url).pathname.split('/').slice(4).join('/'));
 try{return new Response(await readFile(path));}catch{}
 const response=await originalFetch(input,options);if(!response.ok)throw Error('Pocket model download '+response.status);
 const data=new Uint8Array(await response.arrayBuffer());await mkdir(dirname(path),{recursive:true});await writeFile(path,data);return new Response(data);
};
await import('./inference.mjs');
parentPort.on('message',data=>self.onmessage({data}));
`);
  class BridgeWorker{
    constructor(){this.worker=new NodeWorker(pathToFileURL(resolve(cache,'entry.mjs')));this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',error=>this.onerror?.(error));}
    postMessage(data,transfer){this.worker.postMessage(data,transfer);}
    terminate(){return this.worker.terminate();}
  }
  const previous=globalThis.Worker;globalThis.Worker=BridgeWorker;
  const tts=new PocketTTS({language:'english_2026-04',quantized:true,voiceCloning:true,maxThreads:1,modelBaseUrl:'https://huggingface.co/vlapky/pocket-tts-onnx/resolve/c469236dbc5f68287fa2fbf175b66de3b80123af/onnx'});
  tts._ensureWorker();globalThis.Worker=previous;
  await tts.load(p=>{if(p.type==='status')console.log(p.status);});
  return tts;
}
