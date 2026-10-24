// Exercise the production export worker with the same encoder in Node tests.
import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
export function createNodeExportWorker(){
  const source=readFileSync(new URL('../src/mp3-export-worker.js',import.meta.url),'utf8').replace("const path='../vendor/lamejs.js';",`const path=${JSON.stringify(new URL('../public/vendor/lamejs.js',import.meta.url).href)};`);
  const wrapper=`import {parentPort} from 'node:worker_threads';globalThis.self=globalThis;self.postMessage=(data,transfer)=>parentPort.postMessage(data,transfer);${source}\nparentPort.on('message',data=>self.onmessage({data}));`;
  const native=new Worker(new URL('data:text/javascript,'+encodeURIComponent(wrapper))),facade={postMessage:(...args)=>native.postMessage(...args),terminate:()=>native.terminate()};
  native.on('message',data=>facade.onmessage?.({data}));native.on('error',error=>facade.onerror?.(error));return facade;
}
