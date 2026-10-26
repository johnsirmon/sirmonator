// Local browser enrollment: one in-memory reference per disposable worker.
import {validateReferenceRecord} from '../reference-provider.js';
import {inspectReferenceWav} from '../reference-audio.js';
import {decodePcmWav,concatenate} from '../pcm.js';
import {assertActive,abortable} from '../continuity.js';
import {CLONE_CONTRACT,assertCloneContract} from './contract.js';
const MAX_OUTPUT_SAMPLES=24000*60;
export function createCloneSession({engineFactory}){
 let engine=null,reference=null,closed=false,busy=false,factoryWork=null;
 const lifetime=new AbortController(),terminations=[];
 const check=()=>{assertActive({signal:lifetime.signal});if(closed)throw new DOMException('Reference session disposed.','AbortError');};
 function dispose(){if(closed)return;closed=true;reference=null;lifetime.abort();if(engine){engine.destroy();terminations.push(engine.waitForTerminations?.());engine=null;}}
 async function operation(signal,action){
  check();if(busy)throw Error('Reference operation already running.');busy=true;
  const abort=()=>dispose();signal?.addEventListener('abort',abort,{once:true});
  try{if(signal?.aborted)dispose();check();return await abortable(action(),lifetime.signal);}
  catch(error){dispose();throw error;}
  finally{signal?.removeEventListener('abort',abort);busy=false;}
 }
 return {
  async prepare(file,receipt,{signal}={}){return operation(signal,async()=>{
   if(reference)throw Error('A session holds one immutable reference. Create a new session.');
   const frozen=structuredClone(receipt);await validateReferenceRecord(frozen);check();
   if(frozen.state!=='validated-local-only')throw Error('This reference attestation has been revoked.');
   if(!file||file.size!==frozen.inspection.fileBytes||typeof file.arrayBuffer!=='function')throw Error('Reference file does not match receipt.');
   let bytes=await abortable(file.arrayBuffer(),lifetime.signal);check();
   let pcm;
   try{
    const inspected=await inspectReferenceWav(bytes,{signal:lifetime.signal});check();
    if(inspected.fileSha256!==frozen.inspection.fileSha256||inspected.pcmSha256!==frozen.inspection.pcmSha256)throw Error('Reference bytes do not match consent receipt.');
    pcm=decodePcmWav(bytes).samples;
    factoryWork=(async()=>{
     const loaded=await engineFactory({signal:lifetime.signal});
     // Keep late-runtime cleanup inside the tracked promise: disposal must wait
     // for factory completion as well as any termination it adds afterwards.
     if(closed){loaded.destroy();terminations.push(loaded.waitForTerminations?.());check();}
     // Transfer ownership before resolving: revoke in the await handoff must
     // see and dispose this runtime, rather than finding a null engine.
     engine=loaded;
     return loaded;
    })();
    await factoryWork;check();assertCloneContract(engine.referenceContract);
    if(engine.sampleRate!==24000)throw Error('Reference runtime sample rate changed.');
    const voice=await abortable(engine.cloneVoice(pcm,{inputSampleRate:24000,name:'local:'+frozen.id}),lifetime.signal);check();
    if(voice!=='local:'+frozen.id)throw Error('Runtime returned a different reference identity.');
    reference={voice,receipt:frozen};return {referenceId:frozen.id,contract:structuredClone(CLONE_CONTRACT)};
   }finally{pcm?.fill(0);if(bytes instanceof ArrayBuffer)new Uint8Array(bytes).fill(0);bytes=null;}
  });},
  async generate(text,{signal}={}){return operation(signal,async()=>{
   if(!reference)throw Error('Prepare your authorized reference first.');
   if(typeof text!=='string'||!text.trim()||text.length>960||!text.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))throw Error('Use 1–960 characters of valid text.');
   const parts=[];let count=0,streamError=null;
   try{
    const metrics=await abortable(engine.generate(text,{voice:reference.voice,onChunk:audio=>{
     if(closed||streamError)return;
     if(!(audio instanceof Float32Array)||!audio.length||count+audio.length>MAX_OUTPUT_SAMPLES||audio.some(x=>!Number.isFinite(x)||Math.abs(x)>1)){streamError=Error('Invalid or excessive reference output PCM.');dispose();return;}
     count+=audio.length;parts.push(audio.slice());
    }}),lifetime.signal);check();if(streamError)throw streamError;
    if(metrics?.stopped)throw Error('Local reference reading was interrupted. No complete audio was created.');
    if(!count)throw Error('Custom reference synthesis produced no audio.');
    const samples=concatenate(parts);check();
    return {samples,sampleRate:24000,provenance:{contract:structuredClone(CLONE_CONTRACT),referenceId:reference.receipt.id,fileSha256:reference.receipt.inspection.fileSha256,pcmSha256:reference.receipt.inspection.pcmSha256,text,consent:structuredClone(reference.receipt.consent),sampleCount:count,metrics:structuredClone(metrics)}};
   }finally{for(const part of parts)part.fill(0);parts.length=0;}
  });},
  revoke:dispose,dispose,
  async waitForDisposal(){await factoryWork?.catch(()=>{});await Promise.all(terminations);},
  get disposed(){return closed;}
 };
}
