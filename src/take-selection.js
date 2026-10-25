import {validatePcm,assertActive,abortable} from './continuity.js';
import {sha256Bytes} from './asset-integrity.js';
import {validFrozenMetrics} from './render-metrics.js';
import {FOUNDATION_PIPELINE} from './engine-specs.js';
export const TAKE_BYTES=32*1024*1024,TAKE_COUNT=256,TAKES_PER_PASSAGE=2;
export const takeRevision=job=>job.takeSelection?.revision??0;
export const selectedTake=(job,index)=>job.takeSelection?.selected?.[index]??'original';
export function requireTakeJob(job){
 if(job?.settings?.pipeline!==FOUNDATION_PIPELINE||job.next!==job.passages.length)throw Error('Passage takes require a complete recording with frozen render inputs. Original audio remains available.');
}
export function selectionState(job){
 const s=job.takeSelection??{schema:1,revision:0,selected:{},history:[]};
 if(s.schema!==1||!Number.isSafeInteger(s.revision)||s.revision<0||!s.selected||Array.isArray(s.selected)||!Array.isArray(s.history)||s.history.length>8)throw Error('Invalid saved take selection.');
 for(const [index,id] of Object.entries(s.selected))if(!/^(0|[1-9]\d*)$/.test(index)||!job.passages[index]||typeof id!=='string'||!id.length||id==='original')throw Error('Invalid saved take selection.');
 for(const h of s.history)if(!Number.isInteger(h.index)||!job.passages[h.index]||typeof h.from!=='string'||typeof h.to!=='string')throw Error('Invalid saved take history.');
 return structuredClone(s);
}
export function changeSelection(job,index,id,{undo=false}={}){
 const s=selectionState(job),from=selectedTake(job,index);if(from===id&&!undo)return false;
 if(undo)s.history.pop();else s.history=[...s.history,{index,from,to:id}].slice(-8);
 if(id==='original')delete s.selected[index];else s.selected[index]=id;
 s.revision++;job.takeSelection=s;return true;
}
export async function validateTake(job,take,{signal}={}){
 requireTakeJob(job);const p=job.passages[take?.index];
 if(!p||take.jobId!==job.id||typeof take.takeId!=='string'||!take.takeId||take.takeId==='original'||!(take.blob instanceof Blob)||take.renderManifestHash!==job.renderManifestHash||!/^([a-f0-9]{64})$/.test(take.executedBuildSourceSha??'')||take.start!==p.start||take.end!==p.end)throw Error('Saved passage take failed its provenance check.');
 validatePcm(take,take.blob.size);
 if((!take.blob.size&&job.source.slice(p.start,p.end).trim())||(take.sampleCount&&take.sampleRate!==job.sampleRate)||!Number.isFinite(take.seconds)||Math.abs(take.seconds-take.sampleCount/take.sampleRate)>1e-9||!validFrozenMetrics(take.metrics,job.settings.renderManifest.engine,!job.source.slice(p.start,p.end).trim())||take.metrics.format!==take.format||Math.abs(take.metrics.outputAudioSeconds-take.seconds)>1e-9)throw Error('Invalid passage take audio or metrics.');
 assertActive({signal});
 const textHash=await abortable(sha256Bytes(new TextEncoder().encode(job.source.slice(p.start,p.end))),signal);
 const bytes=await abortable(take.blob.arrayBuffer(),signal);assertActive({signal});
 if(textHash!==take.sourceSliceHash||await abortable(sha256Bytes(bytes),signal)!==take.audioHash)throw Error('Saved passage take failed its audio/text integrity check.');
 assertActive({signal});return take;
}
export async function resolveTakes(store,job,parts){
 const s=selectionState(job);if(!Object.keys(s.selected).length)return parts;
 requireTakeJob(job);const resolved=parts.slice();
 for(const [index,id] of Object.entries(s.selected)){
  const take=await store.take(job.id,Number(index),id);if(!take)throw Error('A selected passage take is missing. Original audio has been preserved.');
  resolved[index]=await validateTake(job,take);
 }
 return resolved;
}
