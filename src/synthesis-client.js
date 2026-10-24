// One worker/model family at a time. A short idle window avoids restarting the
// model between previews, completed recordings and passage-safe Pause/Resume.
export function createSynthesisClient({createWorker,idleMs=30000,onStage=()=>{},onLoading=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
 let worker=null,family=null,pending=null,sequence=0,timer=null,idleGeneration=0;
 const clearIdle=()=>{idleGeneration++;if(timer!==null)clearTimer(timer);timer=null;};
 function cancel(message='Current passage cancelled. Saved passages were kept.'){
  clearIdle();const active=worker;worker=null;family=null;active?.terminate();
  const waiting=pending;pending=null;if(waiting)waiting.reject(Error(message));
 }
 function idle(){clearIdle();const generation=idleGeneration;if(worker&&!pending)timer=setTimer(()=>{if(generation!==idleGeneration||pending)return;timer=null;cancel();},idleMs);}
 function attach(nextFamily){
  const active=createWorker();worker=active;family=nextFamily;
  active.onmessage=({data})=>{
   if(worker!==active||!pending)return;
   if(data.type==='loading'){onLoading(data);return;}
   if(data.requestId!==pending.id)return;
   if(data.type==='stage'){onStage(data.message);return;}
   if(data.type==='error'){cancel(data.message||'Voice worker failed.');return;}
   if(data.type==='passage'){const waiting=pending;pending=null;idle();waiting.resolve(data);}
  };
  active.onerror=error=>{if(worker===active)cancel(error.message||'Voice worker failed.');};
 }
 function generate(input,nextFamily){
  if(pending)return Promise.reject(Error('Another passage is already being created.'));
  clearIdle();if(worker&&family!==nextFamily)cancel();
  try{if(!worker)attach(nextFamily);}catch(error){cancel();return Promise.reject(error);}
  return new Promise((resolve,reject)=>{const id=++sequence;pending={id,resolve,reject};try{worker.postMessage({...input,requestId:id});}catch(error){cancel(error.message);}});
 }
 return {generate,idle,cancel};
}
