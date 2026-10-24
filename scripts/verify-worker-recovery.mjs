import {createSynthesisClient} from '../src/synthesis-client.js';
import {createNodeWorkerFactory} from './worker-node.mjs';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {mp3Duration} from '../src/mp3.js';
const factory=await createNodeWorkerFactory(),client=createSynthesisClient({createWorker:()=>factory.createWorker()});
const input={text:'A final paragraph completes the reading. Nothing should be added, summarized, or removed.',settings:{voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,voiceRevision:1,pipeline:'mp3-passages-v1-2026-10-23'},last:true};
const sha=value=>createHash('sha256').update(new Uint8Array(value)).digest('hex');
try{
 const first=await client.generate(input,'kokoro');console.log('Warm-up complete. Cancelling an actual pending inference.');
 const pending=client.generate(input,'kokoro'),started=performance.now();setTimeout(()=>client.cancel(),50);let cancellation;
 try{await pending;throw Error('Inference completed before cancellation fixture fired');}catch(error){if(!error.message.includes('cancelled'))throw error;cancellation=error.message;}
 const cancelMs=performance.now()-started,retry=await client.generate(input,'kokoro');
 if(sha(first.bytes)!==sha(retry.bytes))throw Error('Retry changed deterministic audio bytes');
 const report={kind:'Actual production worker Node CPU inference cancellation and same-text retry; no acoustic word verification',sourceExact:input.text,voice:input.settings.voice,cancelMs,cancellation,workerCreations:factory.creations,firstSHA256:sha(first.bytes),retrySHA256:sha(retry.bytes),audioSeconds:mp3Duration(new Uint8Array(retry.bytes)),retryMetrics:retry.metrics};
 await writeFile('.cache/session-recovery.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{client.cancel();}
