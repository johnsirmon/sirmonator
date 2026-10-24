// Two compressed chapters, at most 24 MiB retained. This is a cache budget;
// each in-flight encoder separately has a 96 MiB compressed-artifact cap.
export function chapterKey(job,chapter){
  const end=job.passages.findIndex(p=>p.chapter>chapter);
  return JSON.stringify([job.id,job.settings?.pipeline,chapter,Math.min(job.next,end<0?job.passages.length:end)]);
}
export function createChapterCache({prepare,maxBytes=24*1024*1024,maxEntries=2,onChange=()=>{}}){
  const entries=new Map();
  const drop=key=>{const entry=entries.get(key);entry?.controller.abort();entries.delete(key);onChange();};
  function get(job,chapter){
    const key=chapterKey(job,chapter),prior=entries.get(key);
    if(prior){entries.delete(key);entries.set(key,prior);return prior.promise;}
    // A growing chapter replaces its prior immutable snapshot.
    for(const [old,entry] of entries)if(entry.id===job.id&&entry.chapter===chapter)drop(old);
    while(entries.size>=maxEntries)drop(entries.keys().next().value);
    const controller=new AbortController(),entry={id:job.id,chapter,controller,bytes:0,pending:true};entries.set(key,entry);onChange();
    entry.promise=Promise.resolve().then(()=>prepare(job,chapter,{signal:controller.signal})).then(result=>{
      if(controller.signal.aborted||entries.get(key)!==entry)throw new DOMException('Audio preparation cancelled.','AbortError');
      entry.bytes=result.blob.size;
      // Do not retain an oversized result, but allow its waiting player to use it.
      if(entry.bytes>maxBytes){entries.delete(key);return result;}
      while([...entries.values()].reduce((n,e)=>n+e.bytes,0)>maxBytes){const oldest=[...entries.keys()].find(candidate=>candidate!==key);if(oldest===undefined)break;drop(oldest);}
      return result;
    }).catch(error=>{if(entries.get(key)===entry)entries.delete(key);throw error;}).finally(()=>{entry.pending=false;onChange();});
    return entry.promise;
  }
  return {get,get preparing(){return [...entries.values()].some(entry=>entry.pending);},prefetch:(job,chapter)=>get(job,chapter).catch(()=>{}),clear(){for(const key of entries.keys())drop(key);onChange();}};
}
