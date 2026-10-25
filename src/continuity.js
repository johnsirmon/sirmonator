export const LEGACY_PIPELINE='mp3-passages-v1-2026-10-23';
export const CONTINUITY_PIPELINE='pcm-passages-v2-2026-10-24';
export const isPcmPipeline=pipeline=>pipeline===CONTINUITY_PIPELINE||pipeline==='pcm-manifest-v3-2026-10-24';
export function validatePcm({sampleRate,sampleCount,channels,format},bytes){
  if(format!=='pcm-s16le'||channels!==1||![22050,24000,44100,48000].includes(sampleRate)||
     !Number.isSafeInteger(sampleCount)||sampleCount<0||sampleCount>sampleRate*300||bytes!==sampleCount*2)
    throw Error('Invalid PCM checkpoint format or length.');
}
export function quantizePcm(samples){
  const bytes=new ArrayBuffer(samples.length*2),view=new DataView(bytes);
  for(let i=0;i<samples.length;i++){
    if(!Number.isFinite(samples[i]))throw Error('The voice produced invalid audio.');
    const v=Math.max(-1,Math.min(1,samples[i]));view.setInt16(i*2,v<0?v*32768:v*32767,true);
  }
  return bytes;
}
// One encoder per artifact, one PCM passage in flight, no whole-book PCM buffer.
export function assertActive({signal,isCurrent=()=>true}={}){if(signal?.aborted||!isCurrent())throw new DOMException('Audio preparation cancelled.','AbortError');}
export function abortable(promise,signal){
  if(!signal)return promise;
  return new Promise((resolve,reject)=>{
    const abort=()=>{cleanup();reject(new DOMException('Audio preparation cancelled.','AbortError'));};
    const cleanup=()=>signal.removeEventListener('abort',abort);
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
    if(signal.aborted)abort();
  });
}
export async function encodePcmParts(parts,sampleRate,{createWorker=()=>new Worker(new URL('./mp3-export-worker.js',import.meta.url),{type:'module'}),isCurrent=()=>true,signal,onMetrics=()=>{},maxBytes=96*1024*1024}={}){
  const started=performance.now();
  const check=()=>assertActive({signal,isCurrent});check();
  const worker=createWorker();let pending;
  const abort=()=>{worker.terminate();pending?.reject(new DOMException('Audio preparation cancelled.','AbortError'));pending=null;};
  signal?.addEventListener('abort',abort,{once:true});
  worker.onmessage=({data})=>{const waiter=pending;pending=null;data.error?waiter?.reject(Error(data.error)):waiter?.resolve(data);};
  worker.onerror=event=>{pending?.reject(Error(event.message||'MP3 export failed.'));pending=null;};
  const send=(data,transfer=[])=>new Promise((resolve,reject)=>{pending={resolve,reject};try{worker.postMessage(data,transfer);}catch(error){pending=null;reject(error);}});
  try{
    await send({type:'start',sampleRate,maxBytes});check();
    for(const part of parts){
      check();
      validatePcm(part,part.blob.size);
      if(!part.sampleCount)continue;
      if(part.sampleRate!==sampleRate)throw Error('PCM checkpoint sample rate changed.');
      const bytes=await abortable(part.blob.arrayBuffer(),signal);check();await send({type:'part',bytes},[bytes]);check();
    }
    check();const result=await send({type:'finish'});check();const blob=new Blob(result.parts,{type:'audio/mpeg'});
    if(result.metrics)onMetrics({...result.metrics,preparationMs:performance.now()-started,preparedAt:Date.now()});return blob;
  }finally{signal?.removeEventListener('abort',abort);worker.terminate();}
}
