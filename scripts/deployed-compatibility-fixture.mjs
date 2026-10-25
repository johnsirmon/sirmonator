import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
import {prepareCompatibilitySnapshot} from './prepare-compatibility-snapshot.mjs';
const prepared=prepareCompatibilitySnapshot();
export async function deployedModules(){const snapshot=await prepared,load=path=>import(pathToFileURL(resolve(snapshot.root,'src',path)).href);return {...snapshot,Mp3Encoder:(await import(pathToFileURL(resolve(snapshot.root,'public/vendor/lamejs.js')).href)).Mp3Encoder,recording:await load('recording.js'),storage:await load('storage.js'),runner:await load('job-runner.js'),continuity:await load('continuity.js'),metrics:await load('render-metrics.js'),mp3:await load('mp3.js')};}
export function snapshotWorker(root){return ()=>{
 const source=readFileSync(resolve(root,'src/mp3-export-worker.js'),'utf8').replace("const path='../vendor/lamejs.js';",`const path=${JSON.stringify(pathToFileURL(resolve(root,'public/vendor/lamejs.js')).href)};`),wrapper=`import {parentPort} from 'node:worker_threads';globalThis.self=globalThis;self.postMessage=(data,transfer)=>parentPort.postMessage(data,transfer);${source}\nparentPort.on('message',data=>self.onmessage({data}));`,worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(wrapper))),facade={postMessage:(...args)=>worker.postMessage(...args),terminate:()=>worker.terminate()};worker.on('message',data=>facade.onmessage?.({data}));worker.on('error',error=>facade.onerror?.(error));return facade;
 };}
export async function seedDeployed({factory=globalThis.indexedDB,name,pipeline,partial=false,unsupported=false,keepOpen=false}){
 const old=await deployedModules(),settings={voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline};
 if(unsupported){const base=await old.recording.makeRecording('manifest only',settings);settings.renderManifest=structuredClone(base.settings.renderManifest);settings.renderManifest.source.sha256='b'.repeat(64);}
 const source='Old deployed exact words: John 3:16.\r\n\r\nSecond café e\u0301 passage.\n\nLast 😀 passage.',initial=await old.recording.makeRecording(source,settings,'SYNTHETIC deployed compatibility'),store=await old.storage.openStorage(factory,name),owner='compatibility';let job=initial;
 const draft={text:source+'\nDraft only.',title:'Preserved old draft',settings:initial.settings,engine:'studio',review:true,from:0,to:0};await store.saveDraft(draft);await store.ensureJob(job);await store.claim(owner);
 const generate=async(text,config,last)=>{const samples=Float32Array.from({length:2400},(_,i)=>.1*Math.sin(i*.1)),sampleRate=24000,pcm=old.continuity.isPcmPipeline(config.pipeline),encoded=pcm?new Uint8Array(old.continuity.quantizePcm(samples)):old.mp3.encodeMp3(samples,sampleRate,old.Mp3Encoder),seconds=pcm?samples.length/sampleRate:old.mp3.mp3Duration(encoded),metrics=old.metrics.renderMetrics({started:0,synthesized:0,finished:0,audio:{samples,sampleRate,runtime:{provider:'none',dtype:'procedural-cc0-compatibility',loadMs:0,inferenceMs:0,modelLoadAttempts:0,retries:0}},outputSeconds:seconds,format:pcm?'pcm-s16le':'mp3',engine:'kokoro'});return {bytes:encoded.buffer.slice(encoded.byteOffset,encoded.byteOffset+encoded.byteLength),seconds,sampleRate,metrics,...(pcm?{format:'pcm-s16le',sampleCount:samples.length,channels:1}:{}),...(config.renderManifest?{renderManifest:config.renderManifest}:{})};};
 for(let i=0;i<(partial?1:job.passages.length);i++)job=await store.commit(job.id,i,await generate(source.slice(job.passages[i].start,job.passages[i].end),job.settings,i===job.passages.length-1),owner);
 const parts=await store.parts(job.id);if(!keepOpen)store.close();return {old,job,parts,draft,store,owner,generate};
}
