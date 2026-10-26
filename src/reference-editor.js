import {prepareReference,referenceCapabilities} from './reference-provider.js';
import {openReferenceStorage} from './reference-storage.js';
import {assertActive,abortable} from './continuity.js';
import {createRepositoryAccess} from './repository-access.js';
import {capturePanelFocus} from './panel-focus.js';
export function createReferenceEditor({$,isBusy=()=>false,onBusy=()=>{},repository}){
 let receipt=null,saved={schema:1,version:0,receipt:null},controller=null,revision=0;
 const storage=createRepositoryAccess(repository,options=>openReferenceStorage(undefined,undefined,options),message=>{cancel();$('reference-report').textContent='';status(message+' Unsaved file validation was cleared. Reload saved metadata to reconnect.');controls();});
 const status=text=>$('reference-status').textContent=text;
 function controls(){const busy=isBusy()||!!controller;for(const id of ['reference-label','reference-authority','reference-scope','reference-provenance','reference-permission','reference-disclosure','reference-file','reference-inspect','reference-reload'])$(id).disabled=busy;$('reference-save').disabled=busy||!receipt;$('reference-cancel').disabled=!controller;$('reference-revoke').disabled=busy||!saved.receipt||saved.receipt.state==='revoked';$('reference-forget').disabled=busy||!saved.receipt;}
 function display(){const record=saved.receipt;$('reference-saved').textContent=record?`${record.consent.label} · ${record.state} · file SHA-256 ${record.inspection.fileSha256}. Local metadata version ${saved.version}. Audio/embeddings are not stored; this cannot be selected as a narrator.`:'No saved reference validation record. For session synthesis, use the separate Local voice cloning panel.';}
 const cancel=()=>{revision++;controller?.abort();receipt=null;$('reference-file').value='';controls();};
 const changed=()=>{cancel();$('reference-report').textContent='';status('Inputs changed. Attest and inspect again before saving metadata.');};
 for(const id of ['reference-label','reference-scope','reference-provenance'])$(id).addEventListener('input',changed);
 for(const id of ['reference-authority','reference-permission','reference-disclosure','reference-file'])$(id).addEventListener('change',()=>{revision++;controller?.abort();receipt=null;$('reference-report').textContent='';controls();});
 async function operation(action){if(controller||isBusy())return;const restore=capturePanelFocus(['reference-inspect','reference-save','reference-reload','reference-revoke','reference-forget'],$('reference-label')),active=new AbortController(),token=++revision;controller=active;onBusy();controls();const check=()=>assertActive({signal:active.signal,isCurrent:()=>token===revision});
  try{await action(active,check);check();}catch(error){if(token===revision)status(error.name==='AbortError'?'Reference operation cancelled. No audio was saved.':error.message);}finally{if(controller===active)controller=null;onBusy();controls();if(!controller&&!isBusy())restore();}
 }
 $('reference-inspect').onclick=()=>operation(async(active,check)=>{
  receipt=null;const file=$('reference-file').files?.[0],input={label:$('reference-label').value,authority:$('reference-authority').value,scope:$('reference-scope').value,provenance:$('reference-provenance').value,permission:$('reference-permission').checked,aiDisclosure:$('reference-disclosure').checked};
  saved=await abortable((await storage()).load(),active.signal);check();display();const result=await prepareReference(file,input,{signal:active.signal,preparationVersion:saved.version});check();receipt=result;$('reference-file').value='';
  $('reference-report').textContent=`Validated locally: ${result.inspection.seconds.toFixed(2)} s · mono 24 kHz PCM16 · ${result.inspection.fileBytes} bytes\nFile SHA-256: ${result.inspection.fileSha256}\nPCM SHA-256: ${result.inspection.pcmSha256}\nPeak ${result.inspection.signal.peak.toFixed(4)}, AC RMS ${result.inspection.signal.acRms.toFixed(4)}, full-scale samples ${result.inspection.signal.fullScaleSamples}.\nFormat/signal checks only. Speech, identity, permission and clone quality are not verified.`;
  status('Reference file validation completed. Only consent/measurement metadata can be saved. Use the separate Local voice cloning panel for session synthesis.');
 });
 $('reference-save').onclick=()=>operation(async(active,check)=>{if(!receipt)throw Error('Inspect an authorized file first.');saved=await abortable((await storage()).save(receipt,saved.version,{signal:active.signal}),active.signal);check();receipt=null;display();status('Validation/consent metadata saved locally. No audio or embedding was retained. This is not an enrolled voice.');});
 $('reference-reload').onclick=()=>operation(async(active,check)=>{const row=await abortable((await storage()).load(),active.signal);check();saved=row;receipt=null;display();status('Saved metadata loaded. No audio was read and no model was loaded.');});
 $('reference-revoke').onclick=()=>operation(async(active,check)=>{receipt=null;saved=await abortable((await storage()).revoke(saved.version,{signal:active.signal}),active.signal);check();$('reference-permission').checked=false;$('reference-disclosure').checked=false;$('reference-file').value='';$('reference-report').textContent='';display();status('This local attestation is revoked. A new attestation and file inspection are required for any future preparation.');});
 $('reference-forget').onclick=()=>operation(async(active,check)=>{receipt=null;saved=await abortable((await storage()).forget(saved.version,{signal:active.signal}),active.signal);check();$('reference-permission').checked=false;$('reference-disclosure').checked=false;$('reference-file').value='';$('reference-report').textContent='';display();status('Local validation metadata forgotten. Source audio files and existing recordings were unchanged.');});
 $('reference-cancel').onclick=()=>{cancel();status('Reference operation cancelled. No audio was saved.');};
 controls();display();const ready=$('reference-reload').onclick();
 return {ready,controls,cancel,capabilities:referenceCapabilities,get busy(){return !!controller;}};
}
