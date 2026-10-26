import {prepareReference} from '../reference-provider.js';
import {createCloneSession} from './session.js';
import {createCloneRuntime} from './runtime.js';
import {encodeWav} from '../core.js';

export function createClonePanel({root,engineFactory=createCloneRuntime}){
 const $=id=>root.querySelector('#clone-'+id);
 let session=null,controller=null,revision=0,url=null,receiptUrl=null;
 const status=text=>{$('status').textContent=text;};
 function controls(){const busy=!!controller;$('generate').disabled=busy; $('cancel').disabled=!busy;}
 function clearOutput(){
  $('audio').pause();$('audio').removeAttribute('src');$('audio').load();
  if(url)URL.revokeObjectURL(url);if(receiptUrl)URL.revokeObjectURL(receiptUrl);
  url=receiptUrl=null;$('output').hidden=true;
  $('download').removeAttribute('href');$('receipt').removeAttribute('href');
 }
 function invalidate(message,{forget=false,revoke=false}={}){
  revision++;controller?.abort();controller=null;session?.dispose();session=null;clearOutput();
  if(forget||revoke){$('file').value='';$('permission').checked=false;}
  if(forget){$('label').value='';$('text').value='';}
  controls();if(message)status(message);
 }
 for(const id of ['file','permission','label','authority','text'])$(id).addEventListener(id==='file'||id==='permission'||id==='authority'?'change':'input',()=>invalidate('Inputs changed. Create a new local reading.'));
 $('cancel').onclick=()=>invalidate('Cancelled. No late result will appear. You can retry with the selected file.');
 $('revoke').onclick=()=>invalidate('Local permission attestation revoked. Worker and generated preview cleared; select a file and confirm permission again.',{revoke:true});
 $('forget').onclick=()=>invalidate('Session reference, attestation, generated preview and inputs forgotten. Downloaded files and source files remain on your device.',{forget:true});
 $('generate').onclick=async()=>{
  if(controller)return;
  clearOutput();session?.dispose();session=null;
  const token=++revision,active=new AbortController();controller=active;controls();
  const current=()=>token===revision&&!active.signal.aborted;
  let timer;
  try{
   const file=$('file').files?.[0],text=$('text').value;
   if(!$('permission').checked)throw Error('Confirm that this is your voice or you have the voice owner’s permission.');
   if(!text.trim()||text.length>960)throw Error('Enter 1–960 characters to read.');
   const receipt=await prepareReference(file,{label:$('label').value||'Local voice',authority:$('authority').value,scope:'Create the text explicitly entered in the local cloning panel.',provenance:'Uploader attestation only; identity and third-party rights are not verified.',permission:true,aiDisclosure:true},{signal:active.signal});
   if(!current())return;
   status('Loading local cloning models (about 146 MB on first use) and preparing your reference…');
   const local=createCloneSession({engineFactory:({signal})=>engineFactory({signal,onProgress:p=>{if(current()&&p.label)status('Loading '+p.label+' · '+Math.round((p.loaded||0)/1048576)+' MB. Reference audio stays on this device.');}})});session=local;
   // Bound hangs as well as output length. Cancellation destroys the dedicated WASM worker.
   timer=setTimeout(()=>{if(current())invalidate('Local cloning timed out after five minutes. Retry on a desktop browser; no result was saved.');},300000);
   await local.prepare(file,receipt,{signal:active.signal});if(!current())return;
   status('Generating AI narration locally…');
   const out=await local.generate(text,{signal:active.signal});
   try{
    if(!current())return;
    const wav=new Blob([encodeWav([out.samples],out.sampleRate)],{type:'audio/wav'});
    url=URL.createObjectURL(wav);receiptUrl=URL.createObjectURL(new Blob([JSON.stringify({receipt,render:out.provenance,notice:'Uploader attestation; no identity, rights, likeness or speech-accuracy verification.'},null,2)],{type:'application/json'}));
    $('audio').src=url;$('download').href=url;$('receipt').href=receiptUrl;$('output').hidden=false;
    status('Created '+(out.samples.length/out.sampleRate).toFixed(2)+' seconds of AI narration. Listen and review; likeness and spoken accuracy vary. Download to keep it.');
   }finally{out.samples.fill(0);}
  }catch(error){if(current())status(error.name==='AbortError'?'Cancelled. You can retry.':'Could not create local narration: '+error.message);}
  finally{clearTimeout(timer);if(token===revision){session?.dispose();session=null;controller=null;controls();}}
 };
 const revoke=()=>invalidate('Reference metadata was revoked or forgotten. Active cloning session and preview cleared.',{revoke:true});
 globalThis.addEventListener?.('sirmonator-reference-revoked',revoke);
 const unload=()=>invalidate();globalThis.addEventListener?.('pagehide',unload);
 controls();
 return {dispose(){invalidate();globalThis.removeEventListener?.('sirmonator-reference-revoked',revoke);globalThis.removeEventListener?.('pagehide',unload);},get busy(){return !!controller;}};
}
