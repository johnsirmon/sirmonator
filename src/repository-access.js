// Retry rejected opens and inactive managed connections without deleting data.
// Explicit injected repository objects cannot be reopened by this adapter.
export function createRepositoryAccess(repository,open,onLost=()=>{}){
 let pending=null;
 const state=event=>{if(['versionchange','closed'].includes(event.state)){pending=null;onLost(event.message);}};
 const get=async(retry=true)=>{
  if(!pending){const opening=Promise.resolve().then(()=>typeof repository==='function'?repository({onState:state}):repository??open({onState:state}));pending=opening;opening.catch(()=>{if(pending===opening)pending=null;});}
  const opening=pending,value=await opening;
  if(value.active===false){if(pending===opening)pending=null;if(retry&&(!repository||typeof repository==='function'))return get(false);throw Error('This local connection closed. Retain unsaved input and reload the page to reconnect.');}
  return value;
 };
 return get;
}
