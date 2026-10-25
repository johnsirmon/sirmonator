import {digest} from './recording.js';
import {spokenPassage} from './pronunciation.js';
import {assertActive} from './continuity.js';
import {validateTranscriptInput} from './speech-review.js';
import {openManagedDatabase} from './idb-lifecycle.js';
export const REVIEW_LIMIT=64,REVIEW_BYTES=2*1024*1024;
const requestValue=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const finished=tx=>{const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error??Error('Review could not be saved.'));tx.onerror=()=>{};});done.catch(()=>{});return done;};
const range=id=>IDBKeyRange.bound([id,''],[id,'\uffff']);
export async function openReviewStorage(factory=globalThis.indexedDB,name='sirmonator-manual-reviews-v1',options={}){
 const db=await openManagedDatabase({...options,factory,name,version:1,upgrade:db=>db.createObjectStore('reviews',{keyPath:['jobId','key']})});
 async function validate(payload){
  const snapshot=payload?.snapshot;
  if(payload?.schema!==1||snapshot?.schema!==1||typeof snapshot.anchor?.recordingId!=='string'||snapshot.key!==await digest(JSON.stringify(snapshot.anchor))||typeof payload.transcript!=='string'||payload.transcript.length>4000||!payload.transcript.isWellFormed()||typeof payload.notes!=='string'||payload.notes.length>1000||!payload.notes.isWellFormed()||typeof payload.listenedByUser!=='boolean'||typeof payload.noWordsHeard!=='boolean'||payload.automaticTranscription!==false||payload.audioVerified!==false)throw Error('Invalid manual-review record.');
  if(snapshot.source.length>6000||snapshot.spoken.length>960||await digest(snapshot.source)!==snapshot.anchor.sourceSliceHash||await digest(snapshot.spoken)!==snapshot.anchor.spokenTextHash||spokenPassage(snapshot.source,snapshot.pronunciation).text!==snapshot.spoken)throw Error('Review source/spoken provenance failed.');
  validateTranscriptInput(payload.transcript,{noWordsHeard:payload.noWordsHeard,allowEmpty:!payload.comparison});
  if(payload.comparison&&(payload.comparison.snapshotKey!==snapshot.key||JSON.stringify(payload.comparison.anchor)!==JSON.stringify(snapshot.anchor)||payload.comparison.transcript!==payload.transcript||payload.comparison.noWordsHeard!==payload.noWordsHeard||payload.comparison.audioVerified!==false||payload.comparison.automaticTranscription!==false))throw Error('Review comparison does not match its frozen selection.');
 }
 return {
  close:()=>db.close(),
  get active(){return db.active;},
  async load(snapshot){const tx=db.transaction('reviews'),done=finished(tx),row=await requestValue(tx.objectStore('reviews').get([snapshot.anchor.recordingId,snapshot.key]));await done;if(!row)return null;await validate(row.payload);if(JSON.stringify(row.payload.snapshot.anchor)!==JSON.stringify(snapshot.anchor)||row.payload.snapshot.source!==snapshot.source||row.payload.snapshot.spoken!==snapshot.spoken)throw Error('Saved review does not match the selected passage.');return row.payload;},
  async save(payload,{signal}={}){await validate(payload);assertActive({signal});const jobId=payload.snapshot.anchor.recordingId,key=payload.snapshot.key,bytes=new TextEncoder().encode(JSON.stringify(payload)).byteLength;
   const tx=db.transaction('reviews','readwrite'),done=finished(tx),store=tx.objectStore('reviews');
   const abort=()=>{try{tx.abort();}catch{}};signal?.addEventListener('abort',abort,{once:true});
   try{const rows=await requestValue(store.getAll(range(jobId))),others=rows.filter(row=>row.key!==key);assertActive({signal});if(others.length>=REVIEW_LIMIT||others.reduce((n,row)=>n+row.bytes,0)+bytes>REVIEW_BYTES)throw Error('Manual-review storage limit reached for this recording (64 selections or 2 MiB). Export and clear its review archive before saving more.');store.put({jobId,key,bytes,payload});await done;return payload;}catch(error){abort();await done.catch(()=>{});throw error;}finally{signal?.removeEventListener('abort',abort);}
  },
  async archive(id){const tx=db.transaction('reviews'),done=finished(tx),rows=await requestValue(tx.objectStore('reviews').getAll(range(id)));await done;for(const row of rows)await validate(row.payload);return {schema:1,recordingId:id,automaticTranscription:false,audioVerified:false,reviews:rows.map(row=>row.payload)};},
  async remove(snapshot,{signal}={}){assertActive({signal});const tx=db.transaction('reviews','readwrite'),done=finished(tx),abort=()=>{try{tx.abort();}catch{}};signal?.addEventListener('abort',abort,{once:true});try{tx.objectStore('reviews').delete([snapshot.anchor.recordingId,snapshot.key]);await done;}finally{signal?.removeEventListener('abort',abort);}},
  async deleteJob(id,{signal}={}){assertActive({signal});const tx=db.transaction('reviews','readwrite'),done=finished(tx),abort=()=>{try{tx.abort();}catch{}};signal?.addEventListener('abort',abort,{once:true});try{tx.objectStore('reviews').delete(range(id));await done;}finally{signal?.removeEventListener('abort',abort);}},
 };
}
