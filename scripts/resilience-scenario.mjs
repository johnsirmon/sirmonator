// Reproducible storage state machine. Procedural CC0 PCM, no synthesis/model.
import {openStorage} from '../src/storage.js';
import {openReviewStorage} from '../src/review-storage.js';
import {makeRecording,digest} from '../src/recording.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';
import {parsePronunciation,spokenPassage} from '../src/pronunciation.js';
import {quantizePcm} from '../src/continuity.js';
import {renderMetrics} from '../src/render-metrics.js';
import {runRecording,validateCheckpoint,recordingBlob} from '../src/job-runner.js';
import {changePassage} from '../src/passage-takes.js';
import {takeRevision,selectedTake,TAKE_COUNT,TAKE_BYTES,TAKES_PER_PASSAGE} from '../src/take-selection.js';
import {captureReview,compareTranscript,reviewSelectionMatches} from '../src/speech-review.js';
import {sha256Bytes} from '../src/asset-integrity.js';
export const check=(condition,message)=>{if(!condition)throw Error(message);};
export const seeded=seed=>{let state=seed>>>0;return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};};
export async function resilienceJob(count=8){return makeRecording(Array.from({length:count},(_,i)=>`Paul reads exact passage ${String(i).padStart(3,'0')}; café and e\u0301 stay unchanged. This paragraph keeps its own words and punctuation.`).join('\n\n'),{voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE,pronunciation:parsePronunciation('Paul => pawl')},'SYNTHETIC resilience fixture');}
export function resilienceAudio(job,index,{sampleCount=96,variant=0}={}){
 const samples=Float32Array.from({length:sampleCount},(_,i)=>i>sampleCount*.9?0:.12*Math.sin((i+1)*(index+1+variant*.01)*.03)),p=job.passages[index],seconds=sampleCount/24000;
 const metrics=renderMetrics({started:0,synthesized:0,finished:0,audio:{samples,sampleRate:24000,runtime:{provider:'none',dtype:'synthetic-resilience',loadMs:0,inferenceMs:0,modelLoadAttempts:0,retries:0}},outputSeconds:seconds,format:'pcm-s16le',engine:'kokoro'});metrics.fixture='Procedural CC0 PCM; no model inference';
 return {bytes:quantizePcm(samples),seconds,sampleRate:24000,sampleCount,channels:1,format:'pcm-s16le',metrics,renderManifest:job.settings.renderManifest,spokenText:spokenPassage(job.source.slice(p.start,p.end),job.settings.pronunciation).text};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const rejected=async(action,pattern)=>{try{await action();}catch(error){check(!pattern||pattern.test(error.message)||error.name==='AbortError','Wrong rejection: '+error.message);return error;}throw Error('Expected operation to reject');};
export async function runSeededScenario({seed,steps=48,factory=globalThis.indexedDB,createWorker,oracleEncode}){
 const random=seeded(seed),name='synthetic-seeded-'+seed+'-'+crypto.randomUUID(),owner='seed-'+seed,sourceJob=await resilienceJob(),source=sourceJob.source,counts={},trace=[],known=Array.from({length:8},()=>[]),reviewsSeen=[];
 let raw,store,review,job=sourceJob,publications=0;
 const reopen=async()=>{raw=await openStorage(factory,name);store=new Proxy(raw,{get(target,key){const value=target[key];return typeof value==='function'?(...args)=>{counts[key]=(counts[key]??0)+1;return value(...args);}:value;}});await store.claim(owner);};
 const invariant=async()=>{job=await store.job(job.id);check(job.source===source,'Manuscript changed');const parts=await store.parts(job.id);check(parts.length===8&&parts.every((p,i)=>p.index===i),'Missing/duplicate/reordered original part');for(let i=0;i<8;i++)check(await sha256Bytes(await parts[i].blob.arrayBuffer())===originalHashes[i],'Original PCM mutated');const takes=await store.takes(job.id);check(takes.length<=TAKE_COUNT&&takes.reduce((n,t)=>n+t.blob.size,0)<=TAKE_BYTES,'Take budget exceeded');for(let i=0;i<8;i++)check(takes.filter(t=>t.index===i).length<=TAKES_PER_PASSAGE,'Passage take limit exceeded');check((job.takeSelection?.history.length??0)<=8,'Undo history unbounded');await validateCheckpoint(store,job);for(const snapshot of reviewsSeen)if(snapshot.anchor.selectionRevision!==takeRevision(job))check(!reviewSelectionMatches(job,snapshot),'Stale review accepted');};
 const generate=async(text,settings,last,index,variant)=>{check(text===source.slice(job.passages[index].start,job.passages[index].end),'Wrong regeneration text');check(JSON.stringify(settings)===JSON.stringify(job.settings),'Settings silently changed');return resilienceAudio(job,index,{variant,sampleCount:96+variant%7});};
 const mutate=async(index,step)=>{const id=selectedTake(job,index);if(id!=='original')job=await changePassage({store,id:job.id,index,takeId:'original',action:'select',owner,revision:takeRevision(job)});else if(known[index].length)job=await changePassage({store,id:job.id,index,takeId:known[index][0],action:'select',owner,revision:takeRevision(job)});else{job=await changePassage({store,id:job.id,index,owner,revision:takeRevision(job),generate:(t,s,l)=>generate(t,s,l,index,step+1)});known[index].push(selectedTake(job,index));}};
 let originalHashes=[];
 try{
  await reopen();review=await openReviewStorage(factory,name+'-reviews');await store.ensureJob(job);
  await rejected(()=>runRecording({store,id:job.id,owner,generate:async()=>{throw new DOMException('Seeded cancellation','AbortError');}}));check((await store.job(job.id)).next===0,'Cancelled generation committed');
  const inputs=[];while(job.next<8){const limit=1+Math.floor(random()*3);let saved=0;job=await runRecording({store,id:job.id,owner,shouldPause:()=>saved>=limit,generate:async(text,settings,last)=>{const current=await store.job(job.id),index=current.next;inputs.push(text);return resilienceAudio(current,index);},onSaved(){saved++;}});}
  check(inputs.join('')===source,'Recording skipped or repeated text');originalHashes=await Promise.all((await store.parts(job.id)).map(async p=>sha256Bytes(await p.blob.arrayBuffer())));
  const kinds=['regenerate','select','undo','review','export','stale-export','duplicate','reopen','corrupt','abort-take'];
  const plan=Array.from({length:steps},()=>({kind:kinds[Math.floor(random()*kinds.length)],index:Math.floor(random()*8),choice:Math.floor(random()*4)}));
  for(let step=0;step<plan.length;step++){
   const action=plan[step],index=action.index,revision=takeRevision(job),event={step,...action,beforeRevision:revision};
   try{
    if(action.kind==='regenerate'){
     if(known[index].length>=2){await rejected(()=>changePassage({store,id:job.id,index,owner,revision,generate:()=>{throw Error('Over-limit inference must not run');}}),/limit/);event.rejected='take-limit';}
     else{job=await changePassage({store,id:job.id,index,owner,revision,generate:(t,s,l)=>generate(t,s,l,index,step+1)});known[index].push(selectedTake(job,index));}
    }else if(action.kind==='select'){const target=action.choice===0||!known[index].length?'original':known[index][action.choice%known[index].length];job=await changePassage({store,id:job.id,index,action:'select',takeId:target,owner,revision});}
    else if(action.kind==='undo'){if(job.takeSelection?.history.length)job=await changePassage({store,id:job.id,owner,revision,action:'undo'});else event.skipped='no-history';}
    else if(action.kind==='review'){const snapshot=await captureReview(store,job.id,index),comparison=await compareTranscript(snapshot,snapshot.spoken);check(comparison.candidateCount===0,'Frozen spoken alias mismatched');await review.save({schema:1,snapshot,comparison,transcript:snapshot.spoken,notes:`Seed ${seed} step ${step}`,listenedByUser:false,noWordsHeard:false,automaticTranscription:false,audioVerified:false});check((await review.load(snapshot)).audioVerified===false,'Review became acoustic verification');reviewsSeen.push(snapshot);}
    else if(action.kind==='export'){
     const snapshot=structuredClone(job),parts=[];for(let i=0;i<8;i++)parts.push(selectedTake(snapshot,i)==='original'?await store.part(job.id,i):await store.take(job.id,i,selectedTake(snapshot,i)));
     const artifact=await recordingBlob(store,snapshot,null,undefined,{createWorker});check(artifact.takeRevision===takeRevision(snapshot),'Wrong exported revision');check(Math.abs(artifact.seconds-parts.reduce((n,p)=>n+p.seconds,0))<1e-9,'Wrong selected duration');check(artifact.metrics.inputSamples===parts.reduce((n,p)=>n+p.sampleCount,0),'Wrong PCM sample order/count');
     if(oracleEncode){const expected=await oracleEncode(parts);check(await sha256Bytes(await artifact.blob.arrayBuffer())===await sha256Bytes(expected),'Selected export differs from independent raw-PCM oracle');}publications++;
    }else if(action.kind==='stale-export'){
     const entered=deferred(),gate=deferred(),snapshot=structuredClone(job),controller=new AbortController();let closed=false;
     const deferredFactory=()=>{const native=createWorker(),post=native.postMessage.bind(native),terminate=native.terminate.bind(native);native.postMessage=(data,transfer)=>{if(data.type==='start'){entered.resolve();gate.promise.then(()=>{if(!closed)post(data,transfer);});}else post(data,transfer);};native.terminate=()=>{closed=true;return terminate();};return native;};
     const pending=recordingBlob(store,snapshot,null,undefined,{createWorker:deferredFactory,signal:controller.signal,isCurrent:()=>takeRevision(job)===takeRevision(snapshot)});pending.catch(()=>{});try{await Promise.race([entered.promise,pending]);await mutate(index,step);gate.resolve();await rejected(()=>pending,/cancel/);check(takeRevision(job)>revision,'Stale export test failed to change revision');event.rejected='stale-export';}finally{controller.abort();gate.resolve();await pending.catch(()=>{});}
    }else if(action.kind==='duplicate'){await store.commit(job.id,7,resilienceAudio(job,7,{variant:step+100}),'seed-'+seed);}
    else if(action.kind==='reopen'){await store.release(owner);store.close();await rejected(()=>store.job(job.id),/closed/);await rejected(()=>openStorage({open(){throw Error('Seeded failed open');}},name),/failed open/);await reopen();job=await store.job(job.id);}
    else if(action.kind==='corrupt'){const rows=await store.parts(job.id),bytes=new Uint8Array(await rows[index].blob.arrayBuffer());bytes[0]^=1;rows[index]={...rows[index],blob:new Blob([bytes])};await rejected(()=>validateCheckpoint({...store,parts:async()=>rows},job),/integrity/);event.rejected='same-length-original-corruption';}
    else if(action.kind==='abort-take'){const controller=new AbortController();controller.abort();await rejected(()=>changePassage({store,id:job.id,index,owner,revision,signal:controller.signal,generate:()=>{throw Error('Aborted inference must not run');}}));}
    await invariant();event.afterRevision=takeRevision(job);trace.push(event);
   }catch(error){throw Error(`Seed ${seed} step ${step} ${action.kind}: ${error.message}`,{cause:error});}
  }
  return {seed,steps,sourceHash:await digest(source),passages:8,originalHashes,finalRevision:takeRevision(job),alternatives:(await store.takes(job.id)).length,publications,readsAndWrites:counts,trace,kind:'Seeded actual storage APIs in supplied IndexedDB implementation; procedural CC0 PCM, no synthesis'};
 }finally{await store?.release(owner).catch(()=>{});store?.close();review?.close();}
}
