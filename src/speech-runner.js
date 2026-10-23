// Recover from GPU failure during either loading OR inference. Retrying returns
// one successful passage; callers never append audio from a failed attempt.
export function createSpeechRunner({load,infer,release=async()=>{},initialProvider='wasm'}){
  let engine,provider=initialProvider;
  return async (input,notify=()=>{})=>{
    try{
      engine??=await load(provider,notify);
      return await infer(engine,input);
    }catch(error){
      if(provider!=='webgpu')throw error;
      notify('The graphics device stopped responding. Retrying this same passage on the CPU…');
      if(engine)try{await release(engine);}catch{/* Lost devices may reject release. */}
      engine=undefined;provider='wasm';
      engine=await load(provider,notify);
      return await infer(engine,input);
    }
  };
}
