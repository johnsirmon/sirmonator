import {inspectReferenceWav,MAX_REFERENCE_BYTES,REFERENCE_FORMAT} from './reference-audio.js';
import {digest} from './recording.js';
import {abortable,assertActive} from './continuity.js';
export const REFERENCE_PROVIDER='pocket-april-local-candidate-v1',CONSENT_NOTICE='reference-preparation-2026-10-25';
export const referenceCapabilities=Object.freeze({provider:REFERENCE_PROVIDER,localValidation:true,audioStored:false,embeddingsStored:false,enrollmentEnabled:false,personalSynthesisEnabled:false});
const clean=(value,max,label)=>{if(typeof value!=='string'||!value.trim()||value.length>max||!value.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value))throw Error('Add valid '+label+' within '+max+' characters.');return value.trim();};
export function referenceConsent(input,now=Date.now()){
 if(input?.permission!==true||input?.aiDisclosure!==true||!['self','authorized','synthetic'].includes(input.authority))throw Error('Confirm voice-owner authority, intended permission and AI labeling before reading a reference file.');
 if(!Number.isFinite(now)||now<0)throw Error('Invalid consent timestamp.');
 return {schema:1,notice:CONSENT_NOTICE,attestationId:crypto.randomUUID(),attestedAt:now,label:clean(input.label,80,'profile label'),authority:input.authority,scope:clean(input.scope,600,'intended uses'),provenance:clean(input.provenance,1000,'permission/provenance notes'),permissionAttested:true,aiDisclosure:true};
}
const identity=receipt=>({schema:receipt.schema,provider:receipt.provider,preparationVersion:receipt.preparationVersion,consent:receipt.consent,inspection:receipt.inspection});
export async function validateReferenceRecord(receipt){
 const allowed=['schema','provider','preparationVersion','consent','inspection','id','state','revokedAt'];
 if(!receipt||Object.keys(receipt).some(key=>!allowed.includes(key))||receipt.schema!==1||receipt.provider!==REFERENCE_PROVIDER||!Number.isSafeInteger(receipt.preparationVersion)||receipt.preparationVersion<0||!['validated-local-only','revoked'].includes(receipt.state))throw Error('Invalid reference-preparation record.');
 const c=receipt.consent,s=receipt.inspection;
 if(!c||Object.keys(c).some(key=>!['schema','notice','attestationId','attestedAt','label','authority','scope','provenance','permissionAttested','aiDisclosure'].includes(key))||c.schema!==1||c.notice!==CONSENT_NOTICE||!/^[a-f0-9-]{36}$/.test(c.attestationId??'')||!Number.isFinite(c.attestedAt)||c.attestedAt<0||c.permissionAttested!==true||c.aiDisclosure!==true||!['self','authorized','synthetic'].includes(c.authority))throw Error('Invalid consent attestation.');
 clean(c.label,80,'profile label');clean(c.scope,600,'intended uses');clean(c.provenance,1000,'permission/provenance notes');
 if(!s||Object.keys(s).some(key=>!['schema','format','fileBytes','fileSha256','pcmSha256','sampleRate','channels','bits','sampleCount','seconds','signal','speechVerified'].includes(key))||s.schema!==1||s.format!==REFERENCE_FORMAT||s.sampleRate!==24000||s.channels!==1||s.bits!==16||!Number.isInteger(s.sampleCount)||s.sampleCount<72000||s.sampleCount>240000||s.seconds!==s.sampleCount/24000||!Number.isInteger(s.fileBytes)||s.fileBytes<s.sampleCount*2+44||s.fileBytes>MAX_REFERENCE_BYTES||!/^([a-f0-9]{64})$/.test(s.fileSha256??'')||!/^([a-f0-9]{64})$/.test(s.pcmSha256??'')||s.speechVerified!==false)throw Error('Invalid reference inspection metadata.');
 const metric=s.signal;if(!metric||Object.keys(metric).some(key=>!['peak','rms','acRms','dc','fullScaleSamples'].includes(key))||['peak','rms','acRms'].some(key=>!Number.isFinite(metric[key])||metric[key]<0||metric[key]>1)||!Number.isFinite(metric.dc)||Math.abs(metric.dc)>1||!Number.isInteger(metric.fullScaleSamples)||metric.fullScaleSamples<0||metric.fullScaleSamples>s.sampleCount*.001||metric.peak<.005||metric.acRms<.001)throw Error('Invalid reference signal measurements.');
 if(receipt.state==='revoked'&&(!Number.isFinite(receipt.revokedAt)||receipt.revokedAt<c.attestedAt))throw Error('Invalid revocation timestamp.');
 if(receipt.state==='validated-local-only'&&Object.hasOwn(receipt,'revokedAt'))throw Error('A revoked record cannot be marked active.');
 if(receipt.id!==await digest(JSON.stringify(identity(receipt))))throw Error('Reference consent/audio binding failed.');return receipt;
}
export async function prepareReference(file,input,{signal,preparationVersion=0,now=Date.now()}={}){
 const consent=referenceConsent(input,now);assertActive({signal});
 if(!Number.isSafeInteger(preparationVersion)||preparationVersion<0)throw Error('Invalid local preparation version.');
 if(!file||!Number.isInteger(file.size)||file.size<44||file.size>MAX_REFERENCE_BYTES||typeof file.arrayBuffer!=='function')throw Error('Select a mono 24 kHz PCM16 WAV of at most 512 KiB.');
 const buffer=await abortable(file.arrayBuffer(),signal);assertActive({signal});if(buffer.byteLength!==file.size)throw Error('Reference size changed while reading.');
 const inspection=await inspectReferenceWav(buffer,{signal}),receipt={schema:1,provider:REFERENCE_PROVIDER,preparationVersion,consent,inspection,state:'validated-local-only'};
 receipt.id=await abortable(digest(JSON.stringify(identity(receipt))),signal);assertActive({signal});return receipt;
}
export function enrollReference(){throw Error('Personal voice enrollment is not enabled. Only local file validation is available.');}
export function synthesizeReference(){throw Error('Personal reference synthesis is not enabled. No preset fallback was used.');}
