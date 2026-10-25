import {browserStorageEstimate,storageEstimateText,usageAnchor} from './storage-usage.js';
import {abortable,assertActive} from './continuity.js';
import {capturePanelFocus} from './panel-focus.js';
const formatBytes=bytes=>bytes<1024?bytes+' B':bytes<1048576?(bytes/1024).toFixed(1)+' KiB':(bytes/1048576).toFixed(2)+' MiB';
export function createStorageUsageEditor({$,getStore,getJob,getSelection,isBusy,onBusy=()=>{},estimate}){
 let controller=null,generation=0,context='';const status=text=>$('recording-usage-status').textContent=text;
 function controls(){$('recording-usage-refresh').disabled=isBusy()||!!controller||!getJob();$('recording-usage-cancel').disabled=!controller;}
 function cancel(){generation++;if(controller)controller.abort();$('recording-usage-summary').textContent='';status('Storage measurement is not current. Refresh for the selected recording. Saved data was unchanged.');controls();}
 $('recording-usage-cancel').onclick=cancel;
 $('recording-usage-refresh').onclick=async()=>{
  if(isBusy()||controller||!getJob())return;const store=getStore(),job=getJob(),anchor=usageAnchor(job),selection=getSelection(),token=++generation,active=new AbortController(),restore=capturePanelFocus(['recording-usage-refresh'],$('recording-usage-refresh'));controller=active;$('recording-usage-summary').textContent='';status('Reading local metadata and Blob sizes only. No audio is decoded or uploaded.');onBusy();controls();
  const check=()=>assertActive({signal:active.signal,isCurrent:()=>token===generation&&selection===getSelection()&&store===getStore()&&anchor===usageAnchor(getJob())});
  try{const [usage,browser]=await Promise.all([store.usage(job.id,{signal:active.signal}),browserStorageEstimate({signal:active.signal,estimate})]);check();const latest=await abortable(store.job(job.id),active.signal);check();if(!latest||usage.anchor!==anchor||usageAnchor(latest)!==usage.anchor)throw Error('Recording changed while measuring. Load latest saved audio, then refresh storage usage. No selection was changed.');
   const partial=!usage.scanComplete||usage.unmeasurableAudioRows>0,metadata=usage.metadataComplete&&usage.scanComplete?formatBytes(usage.metadataJsonBytes)+' serialized JSON (approximate)':'unknown / measurement budget reached',total=!partial&&usage.metadataComplete?` Measured payload: ${formatBytes(usage.originalBytes+usage.alternativeBytes+usage.metadataJsonBytes)}; this is not actual disk allocation.`:'';
   $('recording-usage-summary').textContent=`${partial?'Partial scan — at least these measured sizes. ':''}Original audio: ${formatBytes(usage.originalBytes)} in ${usage.originalRows} parts. Alternative takes: ${formatBytes(usage.alternativeBytes)} in ${usage.alternativeRows} rows. Recording metadata: ${metadata}.${total} Snapshot at ${new Date(usage.measuredAt).toLocaleTimeString()} through passage ${usage.through}, take revision ${usage.takeRevision}. Scan used ${usage.requests} requests for ${usage.rowsFetched} rows, plus one freshness read; no application audio-byte reads. ${storageEstimateText(browser)}`;
   status(partial?'Storage scan reached its limit or encountered unmeasurable rows. Recording totals remain unknown. Saved data was unchanged.':'Read-only storage snapshot measured. Other data/caches and browser overhead are excluded from recording payload sizes; a new snapshot is needed after changes.');
  }catch(error){if(token===generation)status(error.name==='AbortError'?'Storage measurement cancelled. Saved data was unchanged.':error.message);}
  finally{active.abort();if(controller===active)controller=null;onBusy();controls();if(selection===getSelection()&&getJob()?.id===job.id)restore();}
 };
 return {controls,cancel,get busy(){return !!controller;},update(job){const next=usageAnchor(job);if(next!==context){cancel();context=next;}}};
}
