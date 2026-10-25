// Real offline synthesis; entirely procedural fixture, never a person's voice.
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {encodeWav} from '../src/core.js';
import {prepareReference} from '../src/reference-provider.js';
import {createPocketNode} from './pocket-node.mjs';
import {createCustomReferenceSession} from './custom-reference-session.mjs';
const file=new Blob([encodeWav([Float32Array.from({length:72000},(_,i)=>.1*Math.sin(2*Math.PI*220*i/24000))],24000)]);
const receipt=await prepareReference(file,{label:'Procedural synthetic conditioning',authority:'synthetic',scope:'Local experimental synthesis and lifecycle verification only.',provenance:'220 Hz sine wave generated in scripts/verify-custom-reference.mjs; no person or recorded voice; CC0-1.0.',permission:true,aiDisclosure:true});
const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),90000);
const session=createCustomReferenceSession({engineFactory:({signal})=>createPocketNode({offline:true,route:'custom-reference-v1',signal})});
try{
 const start=performance.now();await session.prepare(file,receipt,{signal:controller.signal});const prepared=performance.now();
 const out=await session.generate('A short synthetic test.',{signal:controller.signal});const ended=performance.now();
 const hash=createHash('sha256').update(new Uint8Array(out.samples.buffer)).digest('hex');
 const report={schema:1,kind:'Actual offline Node CPU custom-reference synthesis; procedural tone only',newModelBytesDownloaded:0,externalFetchEnabled:false,fixture:{kind:'220 Hz procedural tone',license:'CC0-1.0',personUsed:false},conditioningAndLoadMs:prepared-start,generationMs:ended-prepared,seconds:out.samples.length/out.sampleRate,peak:out.samples.reduce((n,x)=>Math.max(n,Math.abs(x)),0),outputPcmSha256:hash,provenance:out.provenance,personalSynthesisEnabled:false,browserRouteValidated:false,limitations:'Finite generated PCM from a tone is not proof of speech intelligibility, voice likeness, consent for a person, browser readiness or acoustic quality.'};
 out.samples.fill(0);
 const cancelStarted=performance.now(),cancelTimer=setTimeout(()=>session.revoke(),50);
 let published=false;try{await session.generate('Cancel this synthetic test while inference is running.',{signal:controller.signal});published=true;}
 catch(error){if(error.name!=='AbortError')throw error;report.actualInferenceCancellation={name:error.name,elapsedMs:performance.now()-cancelStarted,published:false};}
 finally{clearTimeout(cancelTimer);}
 if(published)throw Error('Expected the actual inference cancellation to prevent publication.');
 await session.waitForDisposal();report.disposed=session.disposed;
 await writeFile('evidence/custom-reference-runtime.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{clearTimeout(deadline);session.dispose();await session.waitForDisposal();}
