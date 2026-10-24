import {makeRecording} from './recording.js';
import {CONTINUITY_PIPELINE,validatePcm,encodePcmParts} from './continuity.js';

// Never trust persisted routing metadata to choose which manuscript words to skip.
export async function validateCheckpoint(store,job){
  const fail=()=>{throw Error('Saved recording checkpoint failed its text integrity check. Restore a backup or remove this recording and recreate it from your reviewed source.');};
  if(!job||typeof job.source!=='string'||!job.settings)fail();
  const expected=await makeRecording(job.source,job.settings);
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
    if(job.settings.pipeline===CONTINUITY_PIPELINE){
      try{validatePcm(part,part.blob.size);}catch{fail();}
      if((part.sampleCount&&part.sampleRate!==job.sampleRate)||Math.abs(part.seconds-part.sampleCount/part.sampleRate)>1e-9)fail();
    }else if(part.format==='pcm-s16le')fail();
  }
  return parts;
}

// A passage is complete only after its audio and progress commit in one transaction.
export async function runRecording({store,id,owner,generate,shouldPause=()=>false,onSaved=()=>{}}){
  let job=await store.job(id);if(!job)throw Error('Recording not found.');
  await validateCheckpoint(store,job);
  while(job.next<job.passages.length&&!shouldPause()){
    const index=job.next,p=job.passages[index];
    const audio=await generate(job.source.slice(p.start,p.end),job.settings,index===job.passages.length-1);
    job=await store.commit(id,index,audio,owner);await onSaved(job);
  }
  return job;
}
export async function recordingBlob(store,job,chapter=null,maxBytes=96*1024*1024,options={}){
  const parts=await validateCheckpoint(store,job);
  const blobs=[],pcmParts=[];let size=0,seconds=0;
  for(let i=0;i<job.next;i++){
    if(chapter!==null&&job.passages[i].chapter!==chapter)continue;
    const part=parts[i];if(!part)throw Error('A saved passage is missing. Resume or restore a backup.');
    size+=part.blob.size;if(job.settings.pipeline!==CONTINUITY_PIPELINE&&size>maxBytes)throw Error('This download is large. Choose an individual chapter instead.');
    pcmParts.push(part);
    if(part.blob.size)blobs.push(part.blob);seconds+=part.seconds;
  }
  if(!size)throw Error('No saved audio in this chapter yet.');
  return {blob:job.settings.pipeline===CONTINUITY_PIPELINE?await encodePcmParts(pcmParts,job.sampleRate,{...options,maxBytes}):new Blob(blobs,{type:'audio/mpeg'}),seconds};
}
