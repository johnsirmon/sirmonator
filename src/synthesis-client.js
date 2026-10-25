// One worker/model family at a time. A short idle window avoids restarting the
// model between previews, completed recordings and passage-safe Pause/Resume.
export function createSynthesisClient({createWorker,idleMs=30000,onStage=()=>{},onLoading=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
 let worker=null,family=null,pending=null,sequence=0,timer=null,idleGeneration=0;
 const clearIdle=()=>{idleGeneration++;const previous=timer;timer=null;if(previous!==null)try{clearTimer(previous);}catch{}};
 const dispose=active=>{try{Promise.resolve(active?.terminate()).catch(()=>{});}catch{}};
 const observe=(callback,value)=>{try{callback(value);}catch{}};
 function cancel(message='Current passage cancelled. Saved passages were kept.'){
  clearIdle();const active=worker,waiting=pending;worker=null;family=null;pending=null;
  // Reject publication before attempting disposal. A native-adapter termination
  // failure cannot strand the request or keep the client marked busy.
  if(waiting)waiting.reject(Error(message));dispose(active);
 }
 function idle(){clearIdle();const generation=idleGeneration;if(worker&&!pending)try{timer=setTimer(()=>{if(generation!==idleGeneration||pending)return;timer=null;cancel();},idleMs);}catch{cancel();}}
 function attach(nextFamily){
  const active=createWorker();worker=active;family=nextFamily;
  active.onmessage=({data})=>{
   if(worker!==active||!pending)return;
   if(!data||typeof data!=='object'){cancel('Voice worker returned an invalid response.');return;}
   // Legacy loaders have no request tag; tagged progress must belong to this
   // request. Worker identity always guards progress from cancelled sessions.
   if(data.type==='loading'){if(data.requestId!==undefined&&data.requestId!==pending.id)return;observe(onLoading,data);return;}
   if(data.requestId!==pending.id)return;
   if(data.type==='stage'){observe(onStage,data.message);return;}
   if(data.type==='error'){cancel(data.message||'Voice worker failed.');return;}
   if(data.type==='passage'){const waiting=pending;pending=null;waiting.resolve(data);idle();}
  };
  active.onerror=error=>{if(worker===active)cancel(error.message||'Voice worker failed.');};
  active.onmessageerror=()=>{if(worker===active)cancel('Voice worker response could not be read.');};
 }
 function generate(input,nextFamily){
  if(pending)return Promise.reject(Error('Another passage is already being created.'));
  clearIdle();if(worker&&family!==nextFamily)cancel();
  try{if(!worker)attach(nextFamily);}catch(error){cancel();return Promise.reject(error);}
  return new Promise((resolve,reject)=>{const id=++sequence;pending={id,resolve,reject};try{worker.postMessage({...input,requestId:id});}catch(error){cancel(error.message);}});
 }
 return {generate,idle,cancel};
}
