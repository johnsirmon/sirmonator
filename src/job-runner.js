import {makeRecording,digest} from './recording.js';
import {spokenPassage} from './pronunciation.js';
import {isPcmPipeline,validatePcm,encodePcmParts,assertActive,abortable} from './continuity.js';
import {FOUNDATION_PIPELINE,assertSupportedManifest} from './render-provenance.js';
import {validFrozenMetrics,metricsSummary} from './render-metrics.js';
import {resolveTakes,takeRevision,selectedTake} from './take-selection.js';

// Never trust persisted routing metadata to choose which manuscript words to skip.
export async function validateCheckpoint(store,job,options={}){
  assertActive(options);
  const fail=()=>{throw Error('Saved recording checkpoint failed its text integrity check. Restore a backup or remove this recording and recreate it from your reviewed source.');};
  if(!job||typeof job.source!=='string'||!job.settings)fail();
  const expected=await makeRecording(job.source,job.settings);
  assertActive(options);
  if(job.settings.pipeline===FOUNDATION_PIPELINE&&job.renderManifestHash!==expected.renderManifestHash)fail();
  if(job.id!==expected.id||job.sourceHash!==expected.sourceHash||
     JSON.stringify(job.settings)!==JSON.stringify(expected.settings)||
     JSON.stringify(job.passages)!==JSON.stringify(expected.passages)||
     JSON.stringify(job.chapters)!==JSON.stringify(expected.chapters)||
     !Number.isInteger(job.next)||job.next<0||job.next>expected.passages.length)fail();
  const parts=await abortable(store.parts?store.parts(job.id,job.next):Promise.all(Array.from({length:job.next},(_,index)=>store.part(job.id,index))),options.signal);assertActive(options);
  if(parts.length!==job.next)fail();
  for(let index=0;index<job.next;index++){
    assertActive(options);
    const part=parts[index];
    if(!part||part.jobId!==job.id||part.index!==index||!Number.isFinite(part.seconds)||part.seconds<0||
       !(part.blob instanceof Blob)||
       (!part.blob.size&&job.source.slice(job.passages[index].start,job.passages[index].end).trim()))fail();
    if(isPcmPipeline(job.settings.pipeline)){
      try{validatePcm(part,part.blob.size);}catch{fail();}
      if((part.sampleCount&&part.sampleRate!==job.sampleRate)||Math.abs(part.seconds-part.sampleCount/part.sampleRate)>1e-9)fail();
    }else if(part.format==='pcm-s16le')fail();
    if(job.settings.pipeline===FOUNDATION_PIPELINE&&(!validFrozenMetrics(part.metrics,job.settings.renderManifest.engine,!job.source.slice(job.passages[index].start,job.passages[index].end).trim())||part.renderManifestHash!==job.renderManifestHash||part.metrics.format!==part.format||Math.abs(part.metrics.outputAudioSeconds-part.seconds)>1e-9))fail();
    if(job.settings.pronunciation&&part.spokenTextHash!==await abortable(digest(spokenPassage(job.source.slice(job.passages[index].start,job.passages[index].end),job.settings.pronunciation).text),options.signal))fail();
  }
  assertActive(options);const resolved=await resolveTakes(store,job,parts,options);assertActive(options);return resolved;
}

// A private, one-use validation capability. It belongs only to the current
// chapter plus its next-chapter preparation; compressed cache entries never own it.
const CHECKPOINT_SCOPE=Symbol('validated-checkpoint-operation');
function freezeMetadata(value){if(value&&typeof value==='object'&&!(value instanceof Blob)){for(const child of Object.values(value))freezeMetadata(child);Object.freeze(value);}return value;}
export async function createPlaybackPreparation(store,job,options={}){
  const frozen=freezeMetadata(structuredClone(job)),scope={active:true,store,job:frozen,parts:null};let used=false;
  const dispose=()=>{scope.active=false;scope.parts=null;scope.store=null;scope.job=null;};
  try{scope.parts=await validateCheckpoint(store,frozen,options);assertActive(options);for(const part of scope.parts)freezeMetadata(part);Object.freeze(scope.parts);}
  catch(error){dispose();throw error;}
  return {job:frozen,dispose,async prepare(cache,chapter,operation={}){
    if(used||!scope.active)throw Error('This chapter preparation was already consumed. Validate a fresh checkpoint.');used=true;
    let currentWork;
    try{
      assertActive(operation);currentWork=cache.get(frozen,chapter,{[CHECKPOINT_SCOPE]:scope});const artifact=await abortable(currentWork,operation.signal);assertActive(operation);
      if(frozen.passages.slice(0,frozen.next).some(p=>p.chapter===chapter+1)){
        // Register before yielding: Stop/selection clears the cache's own worker
        // signals. Release the shared metadata when the bounded prefetch settles.
        Promise.resolve(cache.prefetch(frozen,chapter+1,{[CHECKPOINT_SCOPE]:scope})).finally(dispose).catch(()=>{});
      }else dispose();
      return artifact;
    }catch(error){if(currentWork)Promise.resolve(currentWork).finally(dispose).catch(()=>{});else dispose();throw error;}
  }};
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
  assertActive(options);const scope=options[CHECKPOINT_SCOPE];
  if(scope&&(!scope.active||scope.store!==store||scope.job!==job||!scope.parts))throw Error('Chapter validation operation expired. Validate a fresh checkpoint.');
  const parts=scope?scope.parts:await abortable(validateCheckpoint(store,job,options),options.signal);assertActive(options);
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
    try{await abortable(store.savePreparation(job.id,{chapter,through:job.next,takeRevision:takeRevision(job),metrics}),options.signal);metricsPersisted=true;}
    catch(error){assertActive(options);options.onMetricPersistenceError?.(error);}
  }
  assertActive(options);return {blob,seconds,metrics,metricsPersisted,takeRevision:takeRevision(job)};
}
export async function renderReport(store,job){
 const parts=await validateCheckpoint(store,job);
 return {schema:1,recordingId:job.id,sourceHash:job.sourceHash,sourceCharacters:job.source.length,settings:job.settings,
  provenance:job.settings.renderManifest?'frozen-render-inputs':'legacy-historical-model-and-voice-revision-unrecorded',
  renderManifestHash:job.renderManifestHash??null,takeSelection:job.takeSelection??null,performance:metricsSummary(parts),preparations:job.preparations??[],
  passages:parts.map(part=>({index:part.index,takeId:selectedTake(job,part.index),spokenTextHash:part.spokenTextHash??null,audioHash:part.audioHash??null,sourceSliceHash:part.sourceSliceHash??null,executedBuildSourceSha:part.executedBuildSourceSha??null,start:job.passages[part.index].start,end:job.passages[part.index].end,seconds:part.seconds,format:part.format??'mp3',sampleRate:part.sampleRate??job.sampleRate,sampleCount:part.sampleCount??null,renderManifestHash:part.renderManifestHash??null,metrics:part.metrics??null})),
  limitations:'Expected upstream asset hashes are source metadata, not proof of runtime model-file hashing. Pinned inputs and decoding do not establish deterministic inference, spoken accuracy or voice rights.'};
}
