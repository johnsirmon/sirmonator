import {isPcmPipeline,validatePcm} from './continuity.js';
import {FOUNDATION_PIPELINE} from './engine-specs.js';
import {validMetrics,validFrozenMetrics} from './render-metrics.js';
import {requireTakeJob,selectionState,changeSelection,takeRevision,validateTake,TAKE_BYTES,TAKE_COUNT,TAKES_PER_PASSAGE} from './take-selection.js';
const DATABASE='sirmonator-recordings-v1',LEASE_MS=20000;
function complete(tx){const done=new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??Error('Could not save on this device.'));tx.onerror=()=>{};});done.catch(()=>{});return done;}
const value=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
export async function openStorage(factory=globalThis.indexedDB,name=DATABASE){
  if(!factory)throw Error('Local storage is unavailable. Use a regular browser window.');
  const request=factory.open(name,2);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('prefs')){db.createObjectStore('prefs');db.createObjectStore('jobs',{keyPath:'id'});db.createObjectStore('parts',{keyPath:['jobId','index']});db.createObjectStore('locks');}if(!db.objectStoreNames.contains('takes'))db.createObjectStore('takes',{keyPath:['jobId','index','takeId']});};
  request.onblocked=()=>{};
  const db=await value(request);db.onversionchange=()=>db.close();
  const read=async(store,key)=>{const tx=db.transaction(store);const done=complete(tx);const result=await value(tx.objectStore(store).get(key));await done;return result;};
  const put=async(store,data,key)=>{const tx=db.transaction(store,'readwrite'),done=complete(tx);tx.objectStore(store).put(data,key);await done;};
  return {
    close:()=>db.close(),draft:()=>read('prefs','draft'),saveDraft:data=>put('prefs',data,'draft'),
    async deleteDraft(){const tx=db.transaction('prefs','readwrite'),done=complete(tx);tx.objectStore('prefs').delete('draft');await done;},
    job:id=>read('jobs',id),part:(id,index)=>read('parts',[id,index]),
    take:(id,index,takeId)=>read('takes',[id,index,takeId]),
    async takes(id){const tx=db.transaction('takes'),done=complete(tx);const result=await value(tx.objectStore('takes').getAll(IDBKeyRange.bound([id,0,''],[id,Number.MAX_SAFE_INTEGER,'\uffff'])));await done;return result;},
    async changeTake({id,index,takeId,undo=false,owner,revision,take,signal},now=Date.now()){
      // Hashing happens before opening the transaction. The final transaction
      // independently checks ownership, selection revision and original contract.
      const snapshot=await read('jobs',id);requireTakeJob(snapshot);selectionState(snapshot);
      if(take)await validateTake(snapshot,take,{signal});
      if(signal?.aborted)throw new DOMException('Passage change cancelled.','AbortError');
      const tx=db.transaction(['jobs','takes','locks'],'readwrite'),done=complete(tx);
      const abort=()=>{try{tx.abort();}catch{}};signal?.addEventListener('abort',abort,{once:true});
      try{
        const jobs=tx.objectStore('jobs'),takes=tx.objectStore('takes');
        const job=await value(jobs.get(id)),lock=await value(tx.objectStore('locks').get('generation'));
        if(!lock||lock.owner!==owner||lock.until<=now)throw Error('Another window owns audio creation.');
        requireTakeJob(job);const state=selectionState(job);
        if(takeRevision(job)!==revision||job.renderManifestHash!==snapshot.renderManifestHash||job.sourceHash!==snapshot.sourceHash||job.source!==snapshot.source||JSON.stringify(job.settings)!==JSON.stringify(snapshot.settings)||JSON.stringify(job.passages)!==JSON.stringify(snapshot.passages))throw Error('Passage selection changed in another window. Reload this recording before trying again.');
        if(undo){const last=state.history.at(-1);if(!last)throw Error('No passage change to undo.');index=last.index;takeId=last.from;}
        if(!Number.isInteger(index)||!job.passages[index])throw Error('Choose a saved passage.');
        if(take){
          if(take.jobId!==id||take.index!==index||take.takeId!==takeId)throw Error('Invalid passage take target.');
          const all=await value(takes.getAll(IDBKeyRange.bound([id,0,''],[id,Number.MAX_SAFE_INTEGER,'\uffff'])));
          if(all.length>=TAKE_COUNT||all.filter(t=>t.index===index).length>=TAKES_PER_PASSAGE||all.reduce((n,t)=>n+t.blob.size,0)+take.blob.size>TAKE_BYTES)throw Error('Take storage limit reached (2 alternatives per passage, 256 total, 32 MiB additional PCM). Select an existing take or original.');
          takes.add(take);job.takeBytes=(job.takeBytes??0)+take.blob.size;
        }else if(takeId!=='original'&&!await value(takes.get([id,index,takeId])))throw Error('The selected take is missing.');
        changeSelection(job,index,takeId,{undo});job.updatedAt=now;jobs.put(job);await done;return job;
      }catch(error){abort();await done.catch(()=>{});throw error;}
      finally{signal?.removeEventListener('abort',abort);}
    },
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
      const pcm=isPcmPipeline(job.settings.pipeline),frozen=job.settings.pipeline===FOUNDATION_PIPELINE;
      if(pcm){try{validatePcm(audio,audio.bytes.byteLength);}catch(error){return fail(error.message);}if(Math.abs(audio.seconds-audio.sampleCount/audio.sampleRate)>1e-9)return fail('Invalid PCM duration.');}
      else if(audio.format==='pcm-s16le')return fail('Cannot mix PCM and legacy MP3 checkpoints.');
      if(frozen&&(JSON.stringify(audio.renderManifest)!==JSON.stringify(job.settings.renderManifest)||!validFrozenMetrics(audio.metrics,job.settings.renderManifest.engine,!text.trim())||Math.abs(audio.metrics.outputAudioSeconds-audio.seconds)>1e-9))return fail('The passage is missing matching render provenance or performance measurements.');
      const blob=new Blob([audio.bytes],{type:pcm?'application/octet-stream':'audio/mpeg'});
      tx.objectStore('parts').add({jobId,index,blob,seconds:audio.seconds,chapter:job.passages[index].chapter,...(validMetrics(audio.metrics)?{metrics:audio.metrics}:{}),...(frozen?{renderManifestHash:job.renderManifestHash}:{}),...(pcm?{format:audio.format,sampleCount:audio.sampleCount,sampleRate:audio.sampleRate,channels:audio.channels}:{})});
      if(validMetrics(audio.metrics)){
        const summary=job.performance??{measured:0,renderMs:0,loadMs:0,inferenceMs:0,modelLoadAttempts:0,providers:[]};
        summary.measured++;for(const key of ['renderMs','loadMs','inferenceMs','modelLoadAttempts'])summary[key]+=audio.metrics[key]??0;
        if(!summary.providers.includes(audio.metrics.provider))summary.providers.push(audio.metrics.provider);job.performance=summary;
      }
      job.next++;job.bytes+=blob.size;job.seconds+=audio.seconds;if(blob.size)job.sampleRate=audio.sampleRate||job.sampleRate;job.updatedAt=now;job.state=job.next===job.passages.length?'ready':'paused';
      tx.objectStore('jobs').put(job);await done;return job;
    },
    async savePreparation(id,preparation){const tx=db.transaction('jobs','readwrite'),done=complete(tx),s=tx.objectStore('jobs');const job=await value(s.get(id));if(job){job.preparations=[...(job.preparations??[]),preparation].slice(-4);s.put(job);}await done;},
    async savePodcast(id,fields){const tx=db.transaction('jobs','readwrite'),done=complete(tx),s=tx.objectStore('jobs');const job=await value(s.get(id));if(job){job.podcast=fields;s.put(job);}await done;},
    async podcastGuid(id){const tx=db.transaction('jobs','readwrite'),done=complete(tx),s=tx.objectStore('jobs');const job=await value(s.get(id));if(!job){await done;throw Error('Recording not found.');}if(!job.episodeGuid){job.episodeGuid=crypto.randomUUID();s.put(job);}await done;return job.episodeGuid;},
    async position(id,position){const tx=db.transaction('jobs','readwrite'),done=complete(tx),s=tx.objectStore('jobs');const job=await value(s.get(id));if(job){job.position=position;s.put(job);}await done;},
    async deleteJob(id){const tx=db.transaction(['jobs','parts','takes'],'readwrite'),done=complete(tx);tx.objectStore('jobs').delete(id);tx.objectStore('parts').delete(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER]));tx.objectStore('takes').delete(IDBKeyRange.bound([id,0,''],[id,Number.MAX_SAFE_INTEGER,'\uffff']));await done;},
  };
}
