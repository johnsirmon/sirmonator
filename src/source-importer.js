import {abortable} from './continuity.js';

// Reading, applying and saving have separate ownership. Cancelling a native
// read may not stop its underlying I/O, but its eventual result cannot publish.
export function createSourceImporter({read,getRevision,onIntent,onReading,apply,persist,notify,formatError=error=>error.message}){
 let active=null;
 const cancel=({silent=false}={})=>{if(!active)return;const previous=active;active=null;previous.controller.abort();onReading(false);if(!silent)notify(previous.applied?'Document import cancelled. Loaded text remains visible; back it up if needed.':'Document import cancelled. Your current text was kept.');};
 const start=async file=>{
  cancel({silent:true});const operation={controller:new AbortController(),applied:false};active=operation;onIntent();let revision=getRevision();onReading(true);notify('Reading your document locally.');
  const current=()=>active===operation&&!operation.controller.signal.aborted;
  try{
   const result=await abortable(read(file,{signal:operation.controller.signal}),operation.controller.signal);if(!current())return;
   if(getRevision()!==revision){notify('Document result discarded because your draft changed. Your current text was kept.');return;}
   apply(result,file);operation.applied=true;revision=getRevision();onReading(false);notify('Document loaded. Saving draft; review its chapter range.');
   await abortable(persist(),operation.controller.signal);if(current()&&getRevision()===revision)notify('Document loaded. Review its chapter range.');
  }catch(error){if(current()&&getRevision()===revision)notify((operation.applied?'Loaded text remains visible. Draft saving failed: ':'Document was not loaded. Your current text was kept. ')+formatError(error));}
  finally{if(current()){active=null;onReading(false);}}
 };
 return {start,cancel};
}
