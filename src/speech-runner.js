// Recover from GPU failure during either loading OR inference. Retrying returns
// one successful passage; callers never append audio from a failed attempt.
export function createSpeechRunner({load,infer,release=async()=>{},initialProvider='wasm',onMetrics=()=>{},now=()=>performance.now()}){
  let engine,provider=initialProvider;
  return async (input,notify=()=>{})=>{
    const metrics={loadMs:0,inferenceMs:0,modelLoadAttempts:0,retries:0};
    const timedLoad=async()=>{metrics.modelLoadAttempts++;const start=now();try{return await load(provider,notify);}finally{metrics.loadMs+=now()-start;}};
    const timedInfer=async()=>{const start=now();try{return await infer(engine,input);}finally{metrics.inferenceMs+=now()-start;}};
    const success=audio=>{onMetrics({...metrics,provider});return audio;};
    try{
      engine??=await timedLoad();
      return success(await timedInfer());
    }catch(error){
      if(provider!=='webgpu'||error.retryableGPU===false)throw error;
      metrics.retries++;
      notify('The graphics device stopped responding. Retrying this same passage on the CPU…');
      if(engine)try{await release(engine);}catch{/* Lost devices may reject release. */}
      engine=undefined;provider='wasm';
      engine=await timedLoad();
      return success(await timedInfer());
    }
  };
}
