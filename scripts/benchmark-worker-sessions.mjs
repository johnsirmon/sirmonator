// Actual production worker/encoder pipeline on Node CPU with existing cached weights.
import {createNodeWorkerFactory} from './worker-node.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {chunkText} from '../src/core.js';
import {mp3Duration} from '../src/mp3.js';
const mode=process.argv[2]??'before';if(!['before','after'].includes(mode))throw Error('Choose before or after.');
const root=new URL('../',import.meta.url);await mkdir(new URL('.cache/',root),{recursive:true});
const factory=await createNodeWorkerFactory(),createWorker=()=>factory.createWorker();
const paragraphs=[
 'This is the first part of a synthetic reading. Every supplied word remains in order.\n\n',
 'The second passage changes the wording. Numbers one, two, and three belong in this text.\n\n',
 'A final paragraph completes the reading. Nothing should be added, summarized, or removed.'
];
const source=paragraphs.join(''),chunks=chunkText(source);if(chunks.join('')!==source)throw Error('Source integrity failed');
const settings={voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,voiceRevision:1,pipeline:'mp3-passages-v1-2026-10-23'};
let client,active=null,requestId=0;
if(mode==='after'){const {createSynthesisClient}=await import('../src/synthesis-client.js');client=createSynthesisClient({createWorker,idleMs:30000});}
async function baseline(data){active??=createWorker();return new Promise((resolve,reject)=>{const id=++requestId;active.onmessage=({data:reply})=>{if(reply.requestId!==id)return;if(reply.type==='passage')resolve(reply);if(reply.type==='error')reject(Error(reply.message));};active.onerror=reject;active.postMessage({...data,requestId:id});});}
const report={kind:'Actual production TTS/MP3 worker adapted only for Node CPU transport/assets; existing model cache, not browser/GPU or export timing',mode,node:process.version,cpu:os.cpus()[0].model,backend:'Node CPU q8',model:'onnx-community/Kokoro-82M-v1.0-ONNX',voice:settings.voice,speed:1,sourceCharacters:source.length,sourceSHA256:createHash('sha256').update(source).digest('hex'),productionWorkerSHA256:factory.sourceSHA256,flows:[],baselineRSSMB:process.memoryUsage().rss/1048576,maxSampledRSSMB:0,memorySampling:"RSS sampled after each passage; not true peak. Cleanup RSS measured after awaited native worker exit."};
const started=performance.now();let combined=[];
try{for(let i=0;i<chunks.length;i++){
 const input={text:chunks[i],settings,last:i===chunks.length-1},start=performance.now();
 const result=mode==='after'?await client.generate(input,'kokoro'):await baseline(input);
 const encoded=new Uint8Array(result.bytes),seconds=mp3Duration(encoded),elapsedMs=performance.now()-start;combined.push(encoded);
 const row={passage:i+1,characters:input.text.length,elapsedMs,audioSeconds:seconds,RTF:elapsedMs/1000/seconds,bytes:encoded.length,sha256:createHash('sha256').update(encoded).digest('hex'),metrics:result.metrics??null,rssMB:process.memoryUsage().rss/1048576};report.flows.push(row);report.maxSampledRSSMB=Math.max(report.maxSampledRSSMB,row.rssMB);console.log(JSON.stringify(row));
 if(mode==='before'){await active.terminate();active=null;}else client.idle();
 }
}finally{if(active)await active.terminate();client?.cancel();await factory.waitForTerminations();}
report.elapsedMs=performance.now()-started;report.afterWorkerExitRSSMB=process.memoryUsage().rss/1048576;report.requestElapsedMs=report.flows.reduce((n,r)=>n+r.elapsedMs,0);report.workerCreations=factory.creations;report.totalAudioSeconds=report.flows.reduce((n,r)=>n+r.audioSeconds,0);report.sourceRoutedExactly=chunks.join('')===source;
await writeFile(new URL('.cache/session-'+mode+'.mp3',root),Buffer.concat(combined));await writeFile(new URL('.cache/session-'+mode+'.json',root),JSON.stringify(report,null,2));console.log(JSON.stringify({mode,workerCreations:factory.creations,elapsedMs:report.elapsedMs,audioSeconds:report.totalAudioSeconds}));
