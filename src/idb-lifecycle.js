// Opening cannot be cancelled in IndexedDB. Abandon timed-out requests safely:
// abort a later upgrade transaction and close any later successful connection.
export function openManagedDatabase({factory=globalThis.indexedDB,name,version,upgrade,onState=()=>{},signal,timeoutMs=10000}){
 const notify=(state,message)=>{try{onState({state,message,name});}catch{}};
 const error=(name,message)=>Object.assign(Error(message),{name});
 return new Promise((resolve,reject)=>{
  let request,settled=false,timer;
  const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const fail=(kind,message)=>{if(settled)return;settled=true;clean();notify(kind,message);reject(error(kind==='blocked'?'StorageBlockedError':kind==='timeout'?'StorageTimeoutError':kind==='aborted'?'AbortError':kind==='versionerror'?'StorageVersionError':'StorageOpenError',message));};
  const openError=cause=>cause?.name==='VersionError'?fail('versionerror','A newer Sirmonator build upgraded this database. Download any unsaved text backup, then reload or update the app to a compatible build. Retry cannot downgrade it. Saved data was not reset.'):fail('error',cause?.message||'Local database could not open.');
  const abort=()=>fail('aborted','Local database opening cancelled. Saved data was not reset.');
  if(!factory){fail('error','Local storage is unavailable. Use a regular browser window.');return;}
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0){fail('error','Invalid database opening timeout.');return;}
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  notify('opening','Opening local recordings…');
  timer=setTimeout(()=>fail('timeout','Local database opening timed out. Close other Sirmonator tabs, then retry. Download a text backup before reloading. Saved data was not reset.'),timeoutMs);
  try{request=factory.open(name,version);}catch(e){openError(e);return;}
  request.onblocked=()=>fail('blocked','Another Sirmonator tab is blocking a database upgrade. Close other tabs, then retry local storage. Saved data was not reset.');
  request.onupgradeneeded=event=>{
   if(settled){try{request.transaction.abort();}catch{}return;}
   try{upgrade(request.result,event);}catch(e){try{request.transaction.abort();}catch{}fail('error',e.message);}
  };
  request.onerror=()=>{if(!settled)openError(request.error);};
  request.onsuccess=()=>{
   const db=request.result;if(settled){db.close();return;}
   settled=true;clean();let active=true;
   const closedMessage='Local storage connection changed or closed. Current work was interrupted; committed passages are kept. Close other tabs and retry, or download a text backup before reloading.';
   const invalidate=state=>{if(!active)return;active=false;db.close();notify(state,closedMessage);};
   db.onversionchange=()=>invalidate('versionchange');db.onclose=()=>invalidate('closed');
   const connection={db,transaction(...args){if(!active)throw error('StorageClosedError',closedMessage);return db.transaction(...args);},close(){if(!active)return;active=false;db.close();},get active(){return active;}};
   notify('ready','Local storage connected.');resolve(connection);
  };
 });
}
