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
export const MP3_REQUEST_TIMEOUT_MS=180000;
export async function encodePcmParts(parts,sampleRate,{createWorker=()=>new Worker(new URL('./mp3-export-worker.js',import.meta.url),{type:'module'}),isCurrent=()=>true,signal,onMetrics=()=>{},onProgress=()=>{},maxBytes=96*1024*1024,requestTimeoutMs=MP3_REQUEST_TIMEOUT_MS,timers={setTimeout,clearTimeout},now=()=>performance.now()}={}){
  const started=performance.now();
  const check=()=>assertActive({signal,isCurrent});check();
  if(!Number.isFinite(requestTimeoutMs)||requestTimeoutMs<=0||!Number.isSafeInteger(maxBytes)||maxBytes<=0)throw Error('Invalid MP3 preparation limit.');
  let totalParts=0,totalSamples=0,completedParts=0,completedSamples=0,lastProgress=-Infinity;
  for(const part of parts){validatePcm(part,part.blob.size);if(part.sampleCount){if(part.sampleRate!==sampleRate)throw Error('PCM checkpoint sample rate changed.');totalParts++;totalSamples+=part.sampleCount;}}
  const progress=(phase,force=false)=>{check();const stamp=now();if(force||stamp-lastProgress>=250){lastProgress=stamp;try{onProgress({phase,completedParts,totalParts,completedSamples,totalSamples});}catch{}}};
  const worker=createWorker();let pending,nextId=0,terminal=null,termination=null;
  const terminate=()=>{if(termination)return termination;try{termination=Promise.resolve(worker.terminate()).catch(()=>{});}catch{termination=Promise.resolve();}return termination;};
  const settle=(waiter,error,value)=>{if(pending!==waiter)return;pending=null;timers.clearTimeout(waiter.timer);error?waiter.reject(error):waiter.resolve(value);};
  const failure=(message,name='Mp3PreparationError')=>Object.assign(Error(message+' Retry preparation, or choose a smaller chapter. Saved passages and selected takes were not changed.'),{name});
  const fail=error=>{if(terminal)return;terminal=error;terminate();if(pending)settle(pending,error);};
  const abort=()=>fail(new DOMException('Audio preparation cancelled.','AbortError'));
  signal?.addEventListener('abort',abort,{once:true});
  worker.onmessage=({data})=>{
    if(terminal||!pending)return;
    const waiter=pending;
    if(waiter.type==='read'||!data||data.id!==waiter.id||data.type!==waiter.type){fail(failure('MP3 worker returned an unexpected response.'));return;}
    if(data.error){fail(failure(data.error));return;}
    if(waiter.type!=='finish'&&data.ok!==true){fail(failure('MP3 worker did not acknowledge the completed request.'));return;}
    settle(waiter,null,data);
  };
  worker.onerror=event=>fail(failure(event.message||'MP3 worker failed.'));
  worker.onmessageerror=()=>fail(failure('MP3 worker response could not be read.'));
  const request=(type,action)=>{
    check();if(terminal)return Promise.reject(terminal);
    return new Promise((resolve,reject)=>{
      const waiter={type,id:++nextId,resolve,reject};pending=waiter;
      waiter.timer=timers.setTimeout(()=>fail(failure('MP3 preparation stopped responding during '+type+'. No partial download was created.','Mp3PreparationTimeoutError')),requestTimeoutMs);
      try{action(waiter);}catch(error){fail(failure('MP3 preparation request failed: '+error.message));}
    });
  };
  const send=(data,transfer=[])=>request(data.type,waiter=>worker.postMessage({...data,id:waiter.id},transfer));
  const read=blob=>request('read',waiter=>Promise.resolve(blob.arrayBuffer()).then(bytes=>settle(waiter,null,bytes),error=>fail(failure('Saved audio could not be read: '+error.message))));
  try{
    if(signal?.aborted)abort();progress('starting',true);await send({type:'start',sampleRate,maxBytes});check();progress('encoding',true);
    for(const part of parts){
      check();
      if(!part.sampleCount)continue;
      const bytes=await read(part.blob);check();if(!(bytes instanceof ArrayBuffer)||bytes.byteLength!==part.blob.size)throw failure('Saved PCM length changed while reading.');await send({type:'part',bytes},[bytes]);check();
      completedParts++;completedSamples+=part.sampleCount;progress('encoding');
    }
    check();progress('finalizing',true);const result=await send({type:'finish'});check();
    if(!Array.isArray(result.parts)||!result.parts.length||result.parts.some(p=>!(p instanceof Uint8Array))||!result.parts.reduce((n,p)=>n+p.byteLength,0)||result.parts.reduce((n,p)=>n+p.byteLength,0)>maxBytes)throw failure('Invalid or excessive MP3 worker output.');
    const blob=new Blob(result.parts,{type:'audio/mpeg'});progress('complete',true);
    if(result.metrics)onMetrics({...result.metrics,preparationMs:performance.now()-started,preparedAt:Date.now()});return blob;
  }catch(error){if(isCurrent())try{onProgress({phase:error.name==='AbortError'?'cancelled':'failed',completedParts,totalParts,completedSamples,totalSamples,error:error.message});}catch{}throw error;}
  finally{signal?.removeEventListener('abort',abort);if(pending)timers.clearTimeout(pending.timer);pending=null;worker.onmessage=()=>{};worker.onerror=()=>{};worker.onmessageerror=()=>{};await terminate();}
}
