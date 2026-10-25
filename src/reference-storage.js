import {validateReferenceRecord} from './reference-provider.js';
import {assertActive} from './continuity.js';
const value=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const done=tx=>{const promise=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error??Error('Reference record was not saved.'));tx.onerror=()=>{};});promise.catch(()=>{});return promise;};
const envelope=row=>{const result=row??{schema:1,version:0,receipt:null};if(result.schema!==1||!Number.isSafeInteger(result.version)||result.version<0)throw Error('Invalid local reference-record version.');return result;};
export async function openReferenceStorage(factory=globalThis.indexedDB,name='sirmonator-reference-preparation-v1'){
 if(!factory)throw Error('Local reference metadata storage is unavailable.');
 const request=factory.open(name,1);request.onupgradeneeded=()=>request.result.createObjectStore('metadata');const db=await value(request);db.onversionchange=()=>db.close();
 async function load(){const tx=db.transaction('metadata'),finished=done(tx),row=envelope(await value(tx.objectStore('metadata').get('current')));await finished;if(row.receipt)await validateReferenceRecord(row.receipt);return row;}
 async function mutate(expectedVersion,action,{signal}={}){
  assertActive({signal});const prior=await load();assertActive({signal});const tx=db.transaction('metadata','readwrite'),finished=done(tx),store=tx.objectStore('metadata'),abort=()=>{try{tx.abort();}catch{}};signal?.addEventListener('abort',abort,{once:true});
  try{const row=envelope(await value(store.get('current')));assertActive({signal});if(row.version!==expectedVersion||row.version!==prior.version)throw Error('Another tab changed the reference record. Reload metadata, then attest and inspect again.');if(row.version>=Number.MAX_SAFE_INTEGER)throw Error('Reference-record version limit reached.');const next=action(structuredClone(row));next.version=row.version+1;store.put(next,'current');await finished;return next;}catch(error){abort();await finished.catch(()=>{});throw error;}finally{signal?.removeEventListener('abort',abort);}
 }
 return {load,close:()=>db.close(),async save(receipt,expectedVersion,options){await validateReferenceRecord(receipt);if(receipt.state!=='validated-local-only'||receipt.preparationVersion!==expectedVersion)throw Error('Re-attest and inspect a file for the current local record version before saving.');return mutate(expectedVersion,row=>{if(row.receipt?.id===receipt.id&&row.receipt.state==='revoked')throw Error('A revoked attestation cannot be reactivated.');return {...row,receipt};},options);},
  revoke:(expectedVersion,options)=>mutate(expectedVersion,row=>{if(!row.receipt)throw Error('No saved reference record to revoke.');return {...row,receipt:{...row.receipt,state:'revoked',revokedAt:Math.max(Date.now(),row.receipt.consent.attestedAt)}};},options),
  forget:(expectedVersion,options)=>mutate(expectedVersion,row=>({...row,receipt:null}),options),
 };
}
