import {captureReview,compareTranscript,reviewSelectionMatches,validateTranscriptInput} from './speech-review.js';
import {openReviewStorage} from './review-storage.js';
import {abortable,assertActive} from './continuity.js';
import {createRepositoryAccess} from './repository-access.js';
export function createSpeechReviewEditor({$,getStore,getJob,getSelection,isBusy,onBusy,onListen,onRepair,onExport,confirmDiscard=message=>confirm(message),repository}){
 let snapshot=null,comparison=null,context='',controller=null,generation=0,dirty=false,stale=false,pendingLoad=false;
 const storage=createRepositoryAccess(repository,options=>openReviewStorage(undefined,undefined,options),message=>{cancel();invalidate(message+' Unsaved review input was retained. Load current passage to reconnect.');onBusy();});
 const status=text=>$('review-status').textContent=text;
 function controls(){const blocked=isBusy()||!!controller,noTarget=!getJob()?.next;
  for(const id of ['review-passage','review-refresh'])$(id).disabled=blocked||noTarget;
  for(const id of ['review-archive','review-clear-archive'])$(id).disabled=blocked||noTarget;
  for(const id of ['review-transcript','review-no-words','review-listened','review-notes','review-compare','review-save','review-export','review-listen','review-repair','review-delete'])$(id).disabled=blocked||!snapshot||stale;
  $('review-cancel').disabled=!controller;
  if(pendingLoad&&!blocked&&!noTarget){pendingLoad=false;const token=generation;queueMicrotask(()=>{if(token===generation){pendingLoad=true;load(false);}});}
 }
 function invalidate(message){pendingLoad=false;stale=true;comparison=null;$('review-findings').textContent='';status(message);controls();}
 const cancel=()=>{pendingLoad=false;if(controller){controller.abort();status('Review operation cancelled. Saved reviews and audio were kept.');}generation++;};
 const input=()=>{dirty=true;comparison=null;$('review-findings').textContent='';status('Transcript changed. Compare again. No audio has been verified.');};
 $('review-transcript').addEventListener('input',input);$('review-no-words').addEventListener('change',input);
 for(const id of ['review-notes','review-listened'])$(id).addEventListener(id==='review-notes'?'input':'change',()=>{dirty=true;});
 function showFindings(){
  $('review-findings').textContent=comparison?comparison.findings.map((f,index)=>`${index+1}. ${f.kind.replaceAll('-',' ')} · source characters ${f.sourceStart}–${f.sourceEnd}\nSource: ${f.expected||'[boundary]'}${f.spoken&&f.spoken!==f.expected?' · frozen spoken form: '+f.spoken:''}\nSupplied transcript: ${f.observed||'[none]'}`).join('\n\n'):'';
 }
 async function current(active,selection,token){
  assertActive({signal:active.signal,isCurrent:()=>token===generation&&selection===getSelection()});
  const fresh=await abortable(captureReview(getStore(),snapshot.anchor.recordingId,snapshot.anchor.passage,{signal:active.signal}),active.signal);
  assertActive({signal:active.signal,isCurrent:()=>token===generation&&selection===getSelection()});
  if(fresh.key!==snapshot.key||!reviewSelectionMatches(getJob(),snapshot)){invalidate('Selected audio changed. Your input is retained for the old selection. Load latest saved audio, then Load current passage before reviewing again.');throw Error('Review selection is stale.');}
 }
 async function run(action){if(isBusy()||controller||!snapshot||stale)return;const active=new AbortController(),selection=getSelection(),token=++generation;controller=active;onBusy();controls();
  try{await current(active,selection,token);await action(active);await current(active,selection,token);}
  catch(error){if(token===generation)status(error.name==='AbortError'?'Review operation cancelled. Saved reviews and audio were kept.':error.message);}
  finally{if(controller===active)controller=null;onBusy();controls();}
 }
 async function load(discard=false){
  const job=getJob();if(!job?.next||isBusy())return;
  if(discard&&dirty&&!confirmDiscard('Load the current selected take? Unsaved review input will be cleared; saved reviews remain tied to their original selection.')){$('review-passage').value=snapshot?.anchor.recordingId===job.id&&snapshot.anchor.passage<job.next?String(snapshot.anchor.passage):'';return;}
  pendingLoad=false;controller?.abort();const active=new AbortController(),selection=getSelection(),token=++generation;controller=active;onBusy();controls();
  try{const next=await captureReview(getStore(),job.id,Number($('review-passage').value)||0,{signal:active.signal});
   assertActive({signal:active.signal,isCurrent:()=>token===generation&&selection===getSelection()});
   if(!reviewSelectionMatches(getJob(),next))throw Error('Load latest saved audio before reviewing its selected take.');
   let saved=null,storageError='';try{saved=await abortable((await storage()).load(next),active.signal);}catch(error){assertActive({signal:active.signal});storageError=' Review storage unavailable: '+error.message;}
   assertActive({signal:active.signal,isCurrent:()=>token===generation&&selection===getSelection()});snapshot=next;comparison=saved?.comparison??null;dirty=false;stale=false;
   $('review-source').textContent=next.source;$('review-spoken').textContent=next.spoken;$('review-transcript').value=saved?.transcript??'';$('review-no-words').checked=saved?.noWordsHeard??false;$('review-listened').checked=saved?.listenedByUser??false;$('review-notes').value=saved?.notes??'';
   $('review-anchor').textContent=`${next.title} · passage ${next.anchor.passage+1} · ${next.anchor.takeId==='original'?'Original':'Take '+next.anchor.takeId} · selection revision ${next.anchor.selectionRevision}. Exact audio SHA-256 ${next.anchor.audioHash}.`;
   showFindings();status((saved?'Saved manual review loaded for this exact selection. It is not acoustic verification.':'Paste a transcript for this passage, or listen and save manual notes. Automatic transcription is not implemented.')+storageError);
  }catch(error){if(token===generation)invalidate(error.message);}
  finally{if(controller===active)controller=null;onBusy();controls();}
 }
 function payload(){const transcript=$('review-transcript').value,notes=$('review-notes').value;validateTranscriptInput(transcript,{noWordsHeard:$('review-no-words').checked,allowEmpty:!comparison});if(notes.length>1000||!notes.isWellFormed())throw Error('Review notes are invalid or exceed 1,000 characters.');return {schema:1,method:'manual-review-v1',snapshot,transcript,noWordsHeard:$('review-no-words').checked,listenedByUser:$('review-listened').checked,notes,comparison,automaticTranscription:false,audioVerified:false,savedAt:Date.now()};}
 $('review-compare').onclick=()=>run(async active=>{status('Comparing supplied transcript text only. No automatic transcription or acoustic verification.');const result=await compareTranscript(snapshot,$('review-transcript').value,{noWordsHeard:$('review-no-words').checked,signal:active.signal});await current(active,getSelection(),generation);comparison=result;dirty=true;showFindings();status(result.candidateCount?`${result.candidateCount} possible text differences. ${result.truncated?'First 128 shown. ':''}Review against audio; these can be transcript/alignment errors.`:'No normalized text differences found. This does not verify audio, pronunciation or completeness.');});
 $('review-save').onclick=()=>run(async active=>{const value=payload();await abortable((await storage()).save(value,{signal:active.signal}),active.signal);dirty=false;status('Manual review saved for this exact passage/take/revision. Audio and manuscript were unchanged.');});
 $('review-export').onclick=()=>run(async()=>{onExport(payload());status('Manual review JSON download started. Nothing was uploaded or acoustically verified.');});
 $('review-listen').onclick=()=>run(async()=>onListen(snapshot));$('review-repair').onclick=()=>run(async()=>onRepair(snapshot));
 $('review-delete').onclick=()=>run(async active=>{if(!confirmDiscard('Remove this saved manual review only? Original audio, manuscript and takes remain.'))return;await abortable((await storage()).remove(snapshot,{signal:active.signal}),active.signal);dirty=true;status('Saved review removed. Current form input is retained until you load another selection.');});
 $('review-refresh').onclick=()=>load(true);$('review-passage').onchange=()=>load(true);$('review-cancel').onclick=cancel;
 async function archive(clear){if(isBusy()||controller||!getJob()?.next)return;const id=getJob().id,selection=getSelection(),active=new AbortController();controller=active;onBusy();controls();
  try{if(clear&&!confirmDiscard('Remove all saved manual reviews for this recording? Export the review archive first. Audio, manuscript and takes remain.'))return;const repository=await storage();assertActive({signal:active.signal,isCurrent:()=>selection===getSelection()&&getJob()?.id===id});if(clear){await repository.deleteJob(id,{signal:active.signal});dirty=true;status('Saved manual-review archive cleared. Current form input is retained. Audio was unchanged.');}else{const value=await abortable(repository.archive(id),active.signal);assertActive({signal:active.signal,isCurrent:()=>selection===getSelection()&&getJob()?.id===id});onExport(value);status('Saved manual-review archive JSON download started. Nothing was uploaded.');}}
  catch(error){status(error.message);}finally{if(controller===active)controller=null;onBusy();controls();}
 }
 $('review-archive').onclick=()=>archive(false);$('review-clear-archive').onclick=()=>archive(true);
 return {controls,cancel,get busy(){return !!controller;},async deleteJob(id){await (await storage()).deleteJob(id);},async update(job){
   const next=JSON.stringify([job.id,job.next,job.takeSelection?.revision??0]);if(next===context)return;context=next;cancel();
  const index=Math.min(Number($('review-passage').value)||0,Math.max(0,job.next-1));$('review-passage').replaceChildren();job.passages.slice(0,job.next).forEach((p,i)=>$('review-passage').add(new Option(`Passage ${i+1} · chapter ${p.chapter+1}`,String(i))));$('review-passage').value=String(index);
  if(snapshot&&dirty){invalidate('Recording or take changed. Unsaved input remains tied to the previous selection. Load current passage to begin a new review.');return;}
  stale=true;comparison=null;$('review-findings').textContent='';pendingLoad=true;
  await load(false);
 }};
}
