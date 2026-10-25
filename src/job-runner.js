import {makeRecording} from './recording.js';
import {isPcmPipeline,validatePcm,encodePcmParts,assertActive,abortable} from './continuity.js';
import {FOUNDATION_PIPELINE,assertSupportedManifest} from './render-provenance.js';
import {validFrozenMetrics,metricsSummary} from './render-metrics.js';

// Never trust persisted routing metadata to choose which manuscript words to skip.
export async function validateCheckpoint(store,job){
  const fail=()=>{throw Error('Saved recording checkpoint failed its text integrity check. Restore a backup or remove this recording and recreate it from your reviewed source.');};
  if(!job||typeof job.source!=='string'||!job.settings)fail();
  const expected=await makeRecording(job.source,job.settings);
  if(job.settings.pipeline===FOUNDATION_PIPELINE&&job.renderManifestHash!==expected.renderManifestHash)fail();
  if(job.id!==expected.id||job.sourceHash!==expected.sourceHash||
     JSON.stringify(job.settings)!==JSON.stringify(expected.settings)||
     JSON.stringify(job.passages)!==JSON.stringify(expected.passages)||
     JSON.stringify(job.chapters)!==JSON.stringify(expected.chapters)||
     !Number.isInteger(job.next)||job.next<0||job.next>expected.passages.length)fail();
  const parts=store.parts?await store.parts(job.id,job.next):await Promise.all(Array.from({length:job.next},(_,index)=>store.part(job.id,index)));
  if(parts.length!==job.next)fail();
  for(let index=0;index<job.next;index++){
    const part=parts[index];
    if(!part||part.jobId!==job.id||part.index!==index||!Number.isFinite(part.seconds)||part.seconds<0||
       !(part.blob instanceof Blob)||
       (!part.blob.size&&job.source.slice(job.passages[index].start,job.passages[index].end).trim()))fail();
    if(isPcmPipeline(job.settings.pipeline)){
      try{validatePcm(part,part.blob.size);}catch{fail();}
      if((part.sampleCount&&part.sampleRate!==job.sampleRate)||Math.abs(part.seconds-part.sampleCount/part.sampleRate)>1e-9)fail();
    }else if(part.format==='pcm-s16le')fail();
    if(job.settings.pipeline===FOUNDATION_PIPELINE&&(!validFrozenMetrics(part.metrics,job.settings.renderManifest.engine,!job.source.slice(job.passages[index].start,job.passages[index].end).trim())||part.renderManifestHash!==job.renderManifestHash||part.metrics.format!==part.format||Math.abs(part.metrics.outputAudioSeconds-part.seconds)>1e-9))fail();
  }
  return parts;
}

// A passage is complete only after its audio and progress commit in one transaction.
export async function runRecording({store,id,owner,generate,shouldPause=()=>false,onSaved=()=>{}}){
  let job=await store.job(id);if(!job)throw Error('Recording not found.');
  await validateCheckpoint(store,job);
  if(job.next<job.passages.length)assertSupportedManifest(job.settings);
  while(job.next<job.passages.length&&!shouldPause()){
    const index=job.next,p=job.passages[index];
    const audio=await generate(job.source.slice(p.start,p.end),job.settings,index===job.passages.length-1);
    job=await store.commit(id,index,audio,owner);await onSaved(job);
  }
  return job;
}
export async function recordingBlob(store,job,chapter=null,maxBytes=96*1024*1024,options={}){
  assertActive(options);const parts=await abortable(validateCheckpoint(store,job),options.signal);assertActive(options);
  const blobs=[],pcmParts=[];let size=0,seconds=0;
  for(let i=0;i<job.next;i++){
    if(chapter!==null&&job.passages[i].chapter!==chapter)continue;
    const part=parts[i];if(!part)throw Error('A saved passage is missing. Resume or restore a backup.');
    size+=part.blob.size;if(!isPcmPipeline(job.settings.pipeline)&&size>maxBytes)throw Error('This download is large. Choose an individual chapter instead.');
    pcmParts.push(part);
    if(part.blob.size)blobs.push(part.blob);seconds+=part.seconds;
  }
  if(!size)throw Error('No saved audio in this chapter yet.');
  let metrics;
  const blob=isPcmPipeline(job.settings.pipeline)?await encodePcmParts(pcmParts,job.sampleRate,{...options,maxBytes,onMetrics:value=>{metrics=value;options.onMetrics?.(value);}}):new Blob(blobs,{type:'audio/mpeg'});
  assertActive(options);
  let metricsPersisted=false;
  if(metrics&&store.savePreparation){
    try{await abortable(store.savePreparation(job.id,{chapter,through:job.next,metrics}),options.signal);metricsPersisted=true;}
    catch(error){assertActive(options);options.onMetricPersistenceError?.(error);}
  }
  assertActive(options);return {blob,seconds,metrics,metricsPersisted};
}
export async function renderReport(store,job){
 const parts=await validateCheckpoint(store,job);
 return {schema:1,recordingId:job.id,sourceHash:job.sourceHash,sourceCharacters:job.source.length,settings:job.settings,
  provenance:job.settings.renderManifest?'frozen-render-inputs':'legacy-historical-model-and-voice-revision-unrecorded',
  renderManifestHash:job.renderManifestHash??null,performance:metricsSummary(parts),preparations:job.preparations??[],
  passages:parts.map(part=>({index:part.index,start:job.passages[part.index].start,end:job.passages[part.index].end,seconds:part.seconds,format:part.format??'mp3',sampleRate:part.sampleRate??job.sampleRate,sampleCount:part.sampleCount??null,renderManifestHash:part.renderManifestHash??null,metrics:part.metrics??null})),
  limitations:'Expected upstream asset hashes are source metadata, not proof of runtime model-file hashing. Pinned inputs and decoding do not establish deterministic inference, spoken accuracy or voice rights.'};
}
