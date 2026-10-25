import {assertActive} from './continuity.js';
export const USAGE_ROW_LIMIT=10000,USAGE_BATCH_SIZE=128,USAGE_TIMEOUT_MS=5000;
const anchorField=value=>value==null||['string','number','boolean'].includes(typeof value)?value:typeof value==='bigint'?value.toString()+'n':'unsupported-'+typeof value;
export const usageAnchor=job=>JSON.stringify([job?.id,job?.createdAt,job?.next,job?.bytes,job?.takeSelection?.revision??0].map(anchorField));
const usageError=(name,message)=>Object.assign(Error(message),{name});

// JSON representation only, not IndexedDB/disk allocation. Binary values are
// excluded; metadata traversal/string work has independent finite budgets.
function metadataBytes(value,budget,check){
 const active=new WeakSet(),encoder=new TextEncoder();
 const visit=(item,depth=0)=>{
  if(--budget.nodes<0||depth>64)throw Error('Metadata budget exceeded');if((budget.nodes&255)===0)check();
  if(item===null)return 4;
  if(typeof item==='string'){budget.units-=item.length;if(budget.units<0)throw Error('Metadata budget exceeded');return encoder.encode(JSON.stringify(item)).length;}
  if(typeof item==='number'||typeof item==='boolean')return JSON.stringify(item).length;
  if(item===undefined)return 0;
  if(item instanceof Blob)throw Error('Nested binary metadata is not measured');
  if(typeof item!=='object'||item instanceof ArrayBuffer||ArrayBuffer.isView(item)||active.has(item))throw Error('Unsupported metadata representation');
  active.add(item);let bytes=2,count=0;
  if(Array.isArray(item)){for(let i=0;i<item.length;i++){const child=item[i];bytes+=(count++?1:0)+visit(child===undefined?null:child,depth+1);}}
  else{if(Object.getPrototypeOf(item)!==Object.prototype&&Object.getPrototypeOf(item)!==null)throw Error('Unsupported metadata representation');for(const key in item){if(!Object.hasOwn(item,key)||item[key]===undefined||item[key] instanceof Blob)continue;bytes+=(count++?1:0)+visit(key,depth+1)+1+visit(item[key],depth+1);}}
  active.delete(item);return bytes;
 };
 return visit(value);
}

// One readonly transaction gives a consistent job/parts/takes snapshot. Batches
// carry Blob handles/sizes only: never arrayBuffer(), stream(), slice() or decode.
export function scanRecordingUsage(db,id,{signal,rowLimit=USAGE_ROW_LIMIT,timeoutMs=USAGE_TIMEOUT_MS,metadataUnits=1000000,metadataNodes=200000}={}){
 assertActive({signal});if(typeof id!=='string'||!id||!Number.isInteger(rowLimit)||rowLimit<1||rowLimit>USAGE_ROW_LIMIT||!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>USAGE_TIMEOUT_MS||!Number.isInteger(metadataUnits)||metadataUnits<0||metadataUnits>1000000||!Number.isInteger(metadataNodes)||metadataNodes<0||metadataNodes>200000)throw Error('Invalid storage measurement limits.');
 return new Promise((resolve,reject)=>{
  let tx,timer,settled=false,reason,job;const started=performance.now(),deadline=Date.now()+timeoutMs,budget={units:metadataUnits,nodes:metadataNodes},result={schema:1,originalBytes:0,alternativeBytes:0,originalRows:0,alternativeRows:0,unmeasurableAudioRows:0,metadataJsonBytes:0,metadataComplete:true,scanComplete:true,rowsFetched:0,requests:0,audioByteReads:0,rowLimit,batchSize:USAGE_BATCH_SIZE};
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const fail=error=>{if(settled)return;settled=true;reason=error;cleanup();try{tx?.abort();}catch{}reject(error);};
  const abort=()=>fail(new DOMException('Storage measurement cancelled. Saved data was unchanged.','AbortError'));
  const check=()=>{assertActive({signal});if(Date.now()>=deadline)throw usageError('StorageUsageTimeoutError','Storage measurement timed out. Saved data was unchanged. Retry when this browser is less busy.');};
  const metadata=row=>{if(!result.metadataComplete)return;try{result.metadataJsonBytes+=metadataBytes(row,budget,check);}catch(error){if(error.name==='AbortError'||error.name==='StorageUsageTimeoutError')throw error;result.metadataComplete=false;}};
  const scan=(name,lower)=>{
   check();const remaining=rowLimit-result.rowsFetched;if(!remaining){result.scanComplete=false;return;}
   const take=name==='takes',upper=take?[id,Number.MAX_SAFE_INTEGER,'\uffff']:[id,Number.MAX_SAFE_INTEGER],range=IDBKeyRange.bound(lower??(take?[id,0,'']:[id,0]),upper,!!lower,false),count=Math.min(USAGE_BATCH_SIZE,remaining),request=tx.objectStore(name).getAll(range,count);result.requests++;
   request.onerror=()=>fail(request.error??Error('Storage measurement failed.'));
   request.onsuccess=()=>{if(settled)return;try{check();const rows=request.result;result.rowsFetched+=rows.length;
    for(const row of rows){check();result[take?'alternativeRows':'originalRows']++;if(row.blob instanceof Blob)result[take?'alternativeBytes':'originalBytes']+=row.blob.size;else result.unmeasurableAudioRows++;metadata(row);}
    if(rows.length===count){const last=rows.at(-1);scan(name,take?[id,last.index,last.takeId]:[id,last.index]);}
    else if(!take)scan('takes');
   }catch(error){fail(error);}};
  };
  try{tx=db.transaction(['jobs','parts','takes'],'readonly');const request=tx.objectStore('jobs').get(id);result.requests++;
   request.onerror=()=>fail(request.error??Error('Recording metadata could not be read.'));
   request.onsuccess=()=>{if(settled)return;try{check();job=request.result;if(!job)throw Error('This recording no longer exists. Reload My recordings.');metadata(job);scan('parts');}catch(error){fail(error);}};
   tx.oncomplete=()=>{if(settled)return;try{check();const summary={...result,metadataComplete:result.metadataComplete&&result.scanComplete,anchor:usageAnchor(job),recordingId:id,through:job.next,takeRevision:job.takeSelection?.revision??0,measuredAt:Date.now(),elapsedMs:performance.now()-started};settled=true;cleanup();resolve(summary);}catch(error){fail(error);}};
   tx.onabort=()=>fail(reason??tx.error??Error('Storage measurement interrupted. Saved data was unchanged.'));tx.onerror=()=>{};
   signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>fail(usageError('StorageUsageTimeoutError','Storage measurement timed out. Saved data was unchanged. Retry when this browser is less busy.')),timeoutMs);if(signal?.aborted)abort();
  }catch(error){fail(error);}
 });
}

export async function browserStorageEstimate({estimate=()=>globalThis.navigator?.storage?.estimate?.(),signal,timeoutMs=2000}={}){
 assertActive({signal});if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>2000)throw Error('Invalid storage estimate timeout.');let timer,abort;const stopped=new Promise((resolve,reject)=>{abort=()=>reject(new DOMException('Storage estimate cancelled.','AbortError'));signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>resolve(null),timeoutMs);});
 try{const value=await Promise.race([Promise.resolve().then(estimate).catch(()=>null),stopped]);assertActive({signal});return value&&Number.isFinite(value.usage)&&value.usage>=0&&Number.isFinite(value.quota)&&value.quota>0?{usage:value.usage,quota:value.quota}:null;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export function storageEstimateText(value){return value?`Browser estimate for this shared origin: ${(value.usage/1048576).toFixed(1)} MiB used / ${(value.quota/1048576).toFixed(1)} MiB quota. Approximate, including other local data and caches where the browser counts them; individual model-cache costs are unknown. Remaining quota is not device memory or a guarantee that generation will succeed.`:'Browser storage estimate unavailable. Per-recording measurements exclude unknown model caches, other local data and browser overhead. Available space and successful generation cannot be guaranteed.';}
