// Adapt the production browser worker for local CPU verification without changing
// manuscript routing, inference, pause handling, encoder or reply protocol.
import {Worker} from 'node:worker_threads';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function createNodeWorkerFactory({offline=false,cacheDir}={}){
 const root=new URL('../',import.meta.url);await mkdir(new URL('.cache/',root),{recursive:true});
 const original=await readFile(new URL('src/tts-worker.js',root),'utf8');let source=original.replaceAll("from './",`from '${root.href}src/`).replaceAll("import('./",`import('${root.href}src/`);
 source=source.replace('kokoroProvider=device;',"kokoroProvider='cpu';").replace("dtype:device==='webgpu'?'fp32':'q8',device,","dtype:'q8',device:'cpu',");
 source=source.replace("const encoderPath='../vendor/lamejs.js';",`const encoderPath=${JSON.stringify(new URL('public/vendor/lamejs.js',root).href)};`);
 const offlineSetup=offline?`import {env} from '@huggingface/transformers';import {readFile as readLocalVoice} from 'node:fs/promises';env.allowRemoteModels=false;${cacheDir?`env.cacheDir=${JSON.stringify(cacheDir)};`:''}globalThis.caches={open:async()=>({match:async url=>{const file=new URL(url).pathname.split('/').at(-1);if(!/^[a-z]{2}_[a-z]+\\.bin$/.test(file))throw Error('Unexpected offline voice request');return new Response(await readLocalVoice(new URL('node_modules/kokoro-js/voices/'+file,${JSON.stringify(root.href)})));}})};globalThis.fetch=async()=>{throw Error('Network disabled for foundation verification');};`:'';
 const file=new URL('.cache/session-worker.mjs',root);await writeFile(file,`import {parentPort} from 'node:worker_threads';\n${offlineSetup}\nglobalThis.self=globalThis;self.postMessage=(data,transfer)=>parentPort.postMessage(data,transfer);\n${source}\nparentPort.on('message',data=>self.onmessage({data}));\n`);
 let creations=0;const terminations=[];
 return {sourceSHA256:createHash('sha256').update(original).digest('hex'),get creations(){return creations;},waitForTerminations:()=>Promise.all(terminations),createWorker(){creations++;const native=new Worker(file),facade={postMessage:data=>native.postMessage(data),terminate:()=>{const done=native.terminate();terminations.push(done);return done;}};native.on('message',data=>facade.onmessage?.({data}));native.on('error',error=>facade.onerror?.(error));return facade;}};
}
