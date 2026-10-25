// Node transport for the production optional-diagnostics codec wrapper; no model.
import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
export function createNodeReviewExportWorker({failDiagnostics=false}={}){
 const source=readFileSync(new URL('../src/mp3-export-worker.js',import.meta.url),'utf8').replace("const path='../vendor/lamejs.js';",`const path=${JSON.stringify(new URL('../public/vendor/lamejs.js',import.meta.url).href)};`);
 const failure=failDiagnostics===true?'start':failDiagnostics;
 const wrapper=`import {parentPort} from 'node:worker_threads';import {installPcmReviewWorker,createPcmReviewStats} from ${JSON.stringify(new URL('../src/pcm-review.js',import.meta.url).href)};globalThis.self=globalThis;self.postMessage=(data,transfer)=>parentPort.postMessage(data,transfer);${source}\ninstallPcmReviewWorker(self,${failure?`{createStats:options=>{if(${JSON.stringify(failure)}==='start')throw Error('Synthetic optional diagnostics failure');const stats=createPcmReviewStats(options);stats[${JSON.stringify(failure==='part'?'addPcm16':'finish')}]=()=>{throw Error('Synthetic optional diagnostics failure');};return stats;}}`:'{}'});parentPort.on('message',data=>self.onmessage({data}));`;
 const native=new Worker(new URL('data:text/javascript,'+encodeURIComponent(wrapper))),facade={postMessage:(...args)=>native.postMessage(...args),terminate:()=>native.terminate()};native.on('message',data=>facade.onmessage?.({data}));native.on('error',error=>facade.onerror?.(error));native.on('messageerror',error=>facade.onmessageerror?.(error));return facade;
}
