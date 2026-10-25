import {sha256Bytes} from './asset-integrity.js';
import {assertActive,abortable} from './continuity.js';
import {captureReview,compareTranscript} from './speech-review.js';
import {validateCheckpoint} from './job-runner.js';
export const ASR_LIMIT_SECONDS=30;
export const ASR_CAPTURE_TIMEOUT_MS=30000;
export const ASR_NOTE='Experimental English-only local Whisper Tiny q8. Differences are uncertain review hints: recognition can omit, invent or mishear words, especially names, numbers, silence and religious language. No certification, acoustic accuracy score or automatic correction. Listen and use manual review.';
// Bounded area-average resampling avoids point-sampling aliasing. No audio decoder,
// microphone, remote URL or external audio upload is involved.
export function asrPcm(bytes,sampleRate){
 if(!(bytes instanceof ArrayBuffer)||bytes.byteLength%2||![22050,24000,44100,48000].includes(sampleRate))throw Error('Local ASR needs a supported saved PCM16 passage. Use manual review for legacy MP3.');
 const count=bytes.byteLength/2;if(!count||count>sampleRate*ASR_LIMIT_SECONDS)throw Error('Local ASR supports nonempty passages up to 30 seconds. Use manual review for longer passages.');
 const view=new DataView(bytes),ratio=sampleRate/16000,result=new Float32Array(Math.floor(count/ratio));
 for(let i=0;i<result.length;i++){const from=i*ratio,to=(i+1)*ratio;let sum=0;for(let j=Math.floor(from);j<Math.ceil(to);j++)sum+=view.getInt16(j*2,true)/32768*(Math.min(to,j+1)-Math.max(from,j));result[i]=sum/ratio;}
 return result;
}
export async function captureAsr(store,snapshot,{signal,timeoutMs=ASR_CAPTURE_TIMEOUT_MS}={}){
 assertActive({signal});if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Invalid ASR capture deadline.');
 const active=new AbortController(),cancel=()=>active.abort();let timedOut=false;
 signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 const timer=setTimeout(()=>{timedOut=true;active.abort();},timeoutMs);
 // Race every native read/hash, including helpers with their own internal awaits.
 // Native operations may finish later; their handlers stay observed and cannot
 // continue capture, create a worker, or publish after cancellation/deadline.
 const wait=action=>{assertActive({signal:active.signal});return abortable(Promise.resolve().then(()=>{assertActive({signal:active.signal});return action();}),active.signal);};
 try{
  const fresh=await wait(()=>captureReview(store,snapshot.anchor.recordingId,snapshot.anchor.passage,{signal:active.signal}));
  if(fresh.key!==snapshot.key)throw Error('Audio selection changed. Load current passage.');
  const job=await wait(()=>store.job(snapshot.anchor.recordingId)),parts=await wait(()=>validateCheckpoint(store,job,{signal:active.signal})),part=parts[snapshot.anchor.passage];
  if(part.format!=='pcm-s16le')throw Error('Local ASR supports saved PCM only. Use manual review for legacy MP3.');
  const bytes=await wait(()=>part.blob.arrayBuffer());
  if(await wait(()=>sha256Bytes(bytes))!==snapshot.anchor.audioHash)throw Error('Audio selection changed. Load current passage.');
  assertActive({signal:active.signal});const samples=asrPcm(bytes,part.sampleRate),pcmHash=await wait(()=>sha256Bytes(samples.buffer));assertActive({signal:active.signal});
  return {samples,pcmHash,sampleRate:16000,seconds:samples.length/16000};
 }catch(error){if(timedOut&&!signal?.aborted)throw Error('Local ASR audio capture timed out. Retry or use manual review.');throw error;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
export async function compareAsr(snapshot,audio,transcript,{signal}={}){
 const comparison=await compareTranscript(snapshot,transcript,{signal,noWordsHeard:!transcript.trim()});
 return {...comparison,method:'local-whisper-comparison-v1',automaticTranscription:true,audioVerified:false,pcmHash:audio.pcmHash,asrSampleRate:16000,seconds:audio.seconds,limitations:ASR_NOTE};
}
export function createAsrClient({makeWorker=()=>new Worker(new URL('./local-asr-worker.js',import.meta.url),{type:'module'}),timeoutMs=180000}={}){
 let active=null;
 return {cancel(){active?.cancel();},run(samples,{signal,onProgress=()=>{}}={}){
  if(active)return Promise.reject(Error('Local ASR is already running.'));
  try{assertActive({signal});}catch(error){return Promise.reject(error);}
  return new Promise((resolve,reject)=>{
   let worker,timer,settled=false;const abort=()=>finish(new DOMException('Local ASR cancelled.','AbortError'));
   const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker?.terminate();active=null;error?reject(error):resolve(value);};
   active={cancel:abort};signal?.addEventListener('abort',abort,{once:true});
   try{worker=makeWorker();timer=setTimeout(()=>finish(Error('Local ASR timed out. Retry or use manual review.')),timeoutMs);
    worker.onmessage=({data})=>{if(settled)return;if(data.type==='progress'){try{onProgress(data.message);}catch{}}else if(data.type==='result')finish(null,data);else if(data.type==='error')finish(Error(data.message));};
    worker.onerror=()=>finish(Error('Local ASR worker failed. Retry or use manual review.'));
    worker.onmessageerror=()=>finish(Error('Local ASR response could not be read. Retry or use manual review.'));
    const copy=samples.slice();worker.postMessage({samples:copy},[copy.buffer]);
   }catch(error){finish(error);}
  });
 }};
}
