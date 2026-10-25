import {validateCheckpoint} from './job-runner.js';
import {requireTakeJob,takeRevision,validateTake,selectionState,TAKES_PER_PASSAGE,TAKE_COUNT,TAKE_BYTES} from './take-selection.js';
import {assertSupportedManifest,executedBuildSourceSha} from './render-provenance.js';
import {sha256Bytes} from './asset-integrity.js';
import {abortable,assertActive} from './continuity.js';
export async function changePassage({store,id,index,action='regenerate',takeId,owner,revision,generate,signal}){
 assertActive({signal});
 const job=await abortable(store.job(id),signal);assertActive({signal});requireTakeJob(job);
 await abortable(validateCheckpoint(store,job),signal);assertActive({signal});
 if(takeRevision(job)!==revision)throw Error('Passage selection changed. Reload this recording before trying again.');
 const state=selectionState(job);
 if(action==='undo'){const h=state.history.at(-1);if(!h)throw Error('No passage change to undo.');index=h.index;takeId=h.from;}
 if(!Number.isInteger(index)||!job.passages[index])throw Error('Choose a saved passage.');
 let take;
 if(action==='regenerate'){
  const existing=await abortable(store.takes(id),signal);assertActive({signal});
  if(existing.filter(t=>t.index===index).length>=TAKES_PER_PASSAGE||existing.length>=TAKE_COUNT||existing.reduce((n,t)=>n+t.blob.size,0)>=TAKE_BYTES)throw Error('Take storage limit reached. Select an existing take or original.');
  assertSupportedManifest(job.settings);const p=job.passages[index],text=job.source.slice(p.start,p.end);
  const audio=await abortable(generate(text,job.settings,index===job.passages.length-1),signal);assertActive({signal});
  if(JSON.stringify(audio.renderManifest)!==JSON.stringify(job.settings.renderManifest))throw Error('The regenerated voice inputs changed. Original audio was kept.');
  takeId=crypto.randomUUID();take={jobId:id,index,takeId,start:p.start,end:p.end,createdAt:Date.now(),blob:new Blob([audio.bytes],{type:'application/octet-stream'}),seconds:audio.seconds,format:audio.format,sampleRate:audio.sampleRate,sampleCount:audio.sampleCount,channels:audio.channels,metrics:audio.metrics,renderManifestHash:job.renderManifestHash,executedBuildSourceSha:executedBuildSourceSha(),sourceSliceHash:await abortable(sha256Bytes(new TextEncoder().encode(text)),signal),audioHash:await abortable(sha256Bytes(audio.bytes),signal)};
 }else if(action!=='select'&&action!=='undo')throw Error('Unknown passage action.');
 else if(takeId!=='original'){const existing=await abortable(store.take(id,index,takeId),signal);if(!existing)throw Error('The selected take is missing.');await validateTake(job,existing,{signal});}
 assertActive({signal});return store.changeTake({id,index,takeId,take,undo:action==='undo',owner,revision,signal});
}
