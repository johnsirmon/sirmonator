import manifest from './asr-assets.json' with {type:'json'};
import {sha256Bytes} from './asset-integrity.js';
export const ASR_MODEL=manifest;
export const ASR_ROOT=`https://huggingface.co/${manifest.model}/resolve/${manifest.revision}/`;
export async function verifyAsrAsset(bytes,asset){if(bytes.byteLength!==asset.size||await sha256Bytes(bytes)!==asset.sha256)throw Error('Local ASR model integrity check failed. Retry download or use manual review.');return bytes;}
export async function loadAsrAssets({fetcher=fetch,cacheStorage=globalThis.caches,onProgress=()=>{}}={}){
 const loaded=new Map(),total=manifest.assets.reduce((n,a)=>n+a.size,0);let completed=0,cache;
 try{cache=await cacheStorage?.open('sirmonator-asr-'+manifest.revision);}catch{}
 for(const asset of manifest.assets){
  const url=ASR_ROOT+asset.path;let bytes;
  try{const response=await cache?.match(url);if(response)bytes=await verifyAsrAsset(await response.arrayBuffer(),asset);}catch{try{await cache?.delete(url);}catch{}}
  if(!bytes){
   onProgress(`Downloading ${asset.path} (${Math.round(completed/total*100)}%)`);
   const response=await fetcher(url,{credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw Error('Local ASR model download failed. Retry or use manual review.');
   const reader=response.body?.getReader();if(!reader)throw Error('Streaming downloads unavailable. Use manual review.');
   const chunks=[];let size=0;try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>asset.size)throw Error('Local ASR model size check failed.');chunks.push(value);onProgress(`Downloading ${asset.path} (${Math.round((completed+size)/total*100)}%)`);}}finally{await reader.cancel().catch(()=>{});}
   const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}bytes=await verifyAsrAsset(joined.buffer,asset);
   try{await cache?.put(url,new Response(bytes.slice(0)));}catch{onProgress('Model verified; browser cache unavailable. This run can continue, but retry may download again.');}
  }
  loaded.set(url,bytes);completed+=asset.size;onProgress(`Model verified (${Math.round(completed/total*100)}%)`);
 }
 return {async match(key){const name=String(key);let bytes=loaded.get(name);if(!bytes){const prefix='/models/'+manifest.model+'/';if(name.startsWith(prefix))bytes=loaded.get(ASR_ROOT+name.slice(prefix.length));}return bytes?new Response(bytes.slice(0)):undefined;},async put(){throw Error('Unexpected ASR cache write.');}};
}
