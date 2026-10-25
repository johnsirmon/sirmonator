import {changePassage} from './passage-takes.js';
import {requireTakeJob,takeRevision,selectedTake,TAKES_PER_PASSAGE,TAKE_BYTES,TAKE_COUNT} from './take-selection.js';
import {assertSupportedManifest} from './render-provenance.js';
import {spokenPassage} from './pronunciation.js';
// UI only: inference and atomic selection live in independently testable modules.
export function createTakeEditor({$,getStore,getJob,isBusy,withLease,generate,owner,onChanged,notify,onBusy}){
 let job=null,takes=[],generation=0,controller=null,reason='',canRender=false;
 function controls(){
  const blocked=isBusy()||!!controller||!!reason||!job,index=Number($('take-passage').value),count=takes.filter(t=>t.index===index).length;
  for(const id of ['take-passage','take-choice'])$(id).disabled=blocked;
  $('take-regenerate').disabled=blocked||!canRender||count>=TAKES_PER_PASSAGE||takes.length>=TAKE_COUNT||takes.reduce((n,t)=>n+t.blob.size,0)>=TAKE_BYTES;
  $('take-select').disabled=blocked||$('take-choice').value===selectedTake(job??{},index);
  $('take-undo').disabled=blocked||!job?.takeSelection?.history?.length;
 }
 function passage(){
  if(!job)return;const index=Number($('take-passage').value),p=job.passages[index];
  $('take-source').textContent=p?job.source.slice(p.start,p.end):'';
  $('take-spoken').textContent=p?spokenPassage(job.source.slice(p.start,p.end),job.settings.pronunciation).text:'';
  const options=takes.filter(t=>t.index===index).sort((a,b)=>a.createdAt-b.createdAt||a.takeId.localeCompare(b.takeId));
  $('take-choice').replaceChildren(new Option('Original','original'));
  options.forEach((t,i)=>$('take-choice').add(new Option(`Take ${i+1} (${new Date(t.createdAt).toLocaleTimeString()})`,t.takeId)));
  $('take-choice').value=selectedTake(job,index);
  const chosen=$('take-choice').selectedOptions?.[0]?.textContent??$('take-choice').value;
  $('take-status').textContent=reason||`Selected: ${chosen}. Revision ${takeRevision(job)}. Original audio is retained. ${(takes.reduce((n,t)=>n+t.blob.size,0)/1048576).toFixed(1)} / 32 MiB additional PCM. ${canRender?'Regeneration keeps this recording’s frozen voice, speed, delivery and exact passage text.':'This historical render contract is unsupported for new synthesis; existing takes remain selectable.'} Two alternatives per passage; undo remembers eight changes. Speech at joins may vary; no crossfade is applied.`;
  controls();
 }
 async function update(next){
  if(job?.id===next.id&&job.next===next.next&&takeRevision(job)===takeRevision(next))return;
  const token=++generation;job=next;takes=[];reason='Loading saved takes.';canRender=false;controls();
  try{requireTakeJob(next);try{assertSupportedManifest(next.settings);canRender=true;}catch{}
   const saved=await getStore().takes(next.id);if(token!==generation)return;takes=saved;reason='';
  }catch(error){if(token!==generation)return;reason=error.message;}
  if(token!==generation)return;
  const prior=Number($('take-passage').value)||0;$('take-passage').replaceChildren();
  next.passages.forEach((p,index)=>$('take-passage').add(new Option(`Passage ${index+1} · chapter ${p.chapter+1}`,String(index))));
  $('take-passage').value=String(Math.min(prior,next.passages.length-1));passage();
 }
 async function act(action){
  if(isBusy()||controller||reason||!job)return;
  const snapshot=job,index=Number($('take-passage').value),takeId=$('take-choice').value;
  const active=new AbortController();controller=active;onBusy();controls();notify(action==='regenerate'?'Regenerating the exact selected passage. Stop keeps the existing take.':'Saving passage selection.');
  try{
   const result=await withLease(async lost=>changePassage({store:getStore(),id:snapshot.id,index,action,takeId,revision:takeRevision(snapshot),owner,signal:active.signal,generate:async(...args)=>{const audio=await generate(...args);if(lost())throw Error('Generation ownership lost. Original audio kept.');return audio;}}));
   // A committed transaction is durable even if navigation happens afterwards.
   if(getJob()?.id===snapshot.id){await onChanged(result);await update(result);}
   notify('Passage selection saved. Playback and exports use the selected immutable takes.');
  }catch(error){notify(error.name==='AbortError'?'Passage change stopped. Previously committed takes were kept.':error.message);}
  finally{if(controller===active)controller=null;onBusy();controls();}
 }
 $('take-passage').onchange=passage;$('take-choice').onchange=controls;
 $('take-regenerate').onclick=()=>act('regenerate');$('take-select').onclick=()=>act('select');$('take-undo').onclick=()=>act('undo');
 return {update,controls,cancel:()=>controller?.abort(),get busy(){return !!controller;}};
}
