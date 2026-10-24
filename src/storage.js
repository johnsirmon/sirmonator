import {CONTINUITY_PIPELINE,validatePcm} from './continuity.js';
const DATABASE='sirmonator-recordings-v1',LEASE_MS=20000;
function complete(tx){const done=new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??Error('Could not save on this device.'));tx.onerror=()=>{};});done.catch(()=>{});return done;}
const value=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
export async function openStorage(factory=globalThis.indexedDB,name=DATABASE){
  if(!factory)throw Error('Local storage is unavailable. Use a regular browser window.');
  const request=factory.open(name,1);
  request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('prefs');db.createObjectStore('jobs',{keyPath:'id'});db.createObjectStore('parts',{keyPath:['jobId','index']});db.createObjectStore('locks');};
  request.onblocked=()=>{};
  const db=await value(request);db.onversionchange=()=>db.close();
  const read=async(store,key)=>{const tx=db.transaction(store);const done=complete(tx);const result=await value(tx.objectStore(store).get(key));await done;return result;};
  const put=async(store,data,key)=>{const tx=db.transaction(store,'readwrite'),done=complete(tx);tx.objectStore(store).put(data,key);await done;};
  return {
    close:()=>db.close(),draft:()=>read('prefs','draft'),saveDraft:data=>put('prefs',data,'draft'),
    async deleteDraft(){const tx=db.transaction('prefs','readwrite'),done=complete(tx);tx.objectStore('prefs').delete('draft');await done;},
    job:id=>read('jobs',id),part:(id,index)=>read('parts',[id,index]),
    async parts(id,count=Number.MAX_SAFE_INTEGER){if(count===0)return [];const tx=db.transaction('parts'),done=complete(tx);const result=await value(tx.objectStore('parts').getAll(IDBKeyRange.bound([id,0],[id,count-1])));await done;return result;},
    async jobs(){const tx=db.transaction('jobs'),done=complete(tx);const jobs=await value(tx.objectStore('jobs').getAll());await done;return jobs.sort((a,b)=>b.updatedAt-a.updatedAt);},
    async ensureJob(job){const tx=db.transaction('jobs','readwrite'),done=complete(tx),s=tx.objectStore('jobs');const existing=await value(s.get(job.id));if(!existing)s.put(job);await done;return existing??job;},
    async claim(owner,force=false,now=Date.now()){
      const tx=db.transaction('locks','readwrite'),done=complete(tx),s=tx.objectStore('locks');const lock=await value(s.get('generation'));
      const allowed=force||!lock||lock.owner===owner||lock.until<=now;
      if(allowed)s.put({owner,until:now+LEASE_MS},'generation');await done;return allowed;
    },
    async renew(owner,now=Date.now()){
      const tx=db.transaction('locks','readwrite'),done=complete(tx),s=tx.objectStore('locks');const lock=await value(s.get('generation'));
      const allowed=lock?.owner===owner;if(allowed)s.put({owner,until:now+LEASE_MS},'generation');await done;return allowed;
    },
    async release(owner){const tx=db.transaction('locks','readwrite'),done=complete(tx),s=tx.objectStore('locks');const lock=await value(s.get('generation'));if(lock?.owner===owner)s.delete('generation');await done;},
    async commit(jobId,index,audio,owner,now=Date.now()){
      const tx=db.transaction(['jobs','parts','locks'],'readwrite'),done=complete(tx);
      // Attach rejection handling immediately: intentional transaction aborts must not leak promises.
      done.catch(()=>{});
      const job=await value(tx.objectStore('jobs').get(jobId)),lock=await value(tx.objectStore('locks').get('generation'));
      const fail=message=>{tx.abort();throw Error(message);};
      if(!lock||lock.owner!==owner||lock.until<=now)return fail('Another window owns audio creation. Saved passages are safe.');
      if(!job)return fail('Recording not found.');
      if(index<job.next){await done;return job;}
      if(index!==job.next||!job.passages[index])return fail('Passages arrived out of order.');
      const text=job.source.slice(job.passages[index].start,job.passages[index].end);
      if(!audio.bytes?.byteLength&&text.trim())return fail('This passage produced no audio.');
      if(!Number.isFinite(audio.seconds)||audio.seconds<0)return fail('Invalid audio duration.');
      if(audio.bytes.byteLength&&job.sampleRate&&audio.sampleRate&&job.sampleRate!==audio.sampleRate)return fail('The voice changed audio format. Start a new recording.');
      const pcm=job.settings.pipeline===CONTINUITY_PIPELINE;
      if(pcm){try{validatePcm(audio,audio.bytes.byteLength);}catch(error){return fail(error.message);}if(Math.abs(audio.seconds-audio.sampleCount/audio.sampleRate)>1e-9)return fail('Invalid PCM duration.');}
      else if(audio.format==='pcm-s16le')return fail('Cannot mix PCM and legacy MP3 checkpoints.');
      const blob=new Blob([audio.bytes],{type:pcm?'application/octet-stream':'audio/mpeg'});
      tx.objectStore('parts').add({jobId,index,blob,seconds:audio.seconds,chapter:job.passages[index].chapter,...(pcm?{format:audio.format,sampleCount:audio.sampleCount,sampleRate:audio.sampleRate,channels:audio.channels}:{})});
      job.next++;job.bytes+=blob.size;job.seconds+=audio.seconds;if(blob.size)job.sampleRate=audio.sampleRate||job.sampleRate;job.updatedAt=now;job.state=job.next===job.passages.length?'ready':'paused';
      tx.objectStore('jobs').put(job);await done;return job;
    },
    async savePodcast(id,fields){const tx=db.transaction('jobs','readwrite'),done=complete(tx),s=tx.objectStore('jobs');const job=await value(s.get(id));if(job){job.podcast=fields;s.put(job);}await done;},
    async podcastGuid(id){const tx=db.transaction('jobs','readwrite'),done=complete(tx),s=tx.objectStore('jobs');const job=await value(s.get(id));if(!job){await done;throw Error('Recording not found.');}if(!job.episodeGuid){job.episodeGuid=crypto.randomUUID();s.put(job);}await done;return job.episodeGuid;},
    async position(id,position){const tx=db.transaction('jobs','readwrite'),done=complete(tx),s=tx.objectStore('jobs');const job=await value(s.get(id));if(job){job.position=position;s.put(job);}await done;},
    async deleteJob(id){const tx=db.transaction(['jobs','parts'],'readwrite'),done=complete(tx);tx.objectStore('jobs').delete(id);tx.objectStore('parts').delete(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER]));await done;},
  };
}
