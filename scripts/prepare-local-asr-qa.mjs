// Maintainer-only model cache preparation for the muted native browser fixture.
// No audio is read or uploaded. Downloaded model files stay under ignored .cache.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {ASR_MODEL,ASR_ROOT,verifyAsrAsset} from '../src/asr-cache.js';
for(const asset of ASR_MODEL.assets){
 const target=new URL('../.cache/asr/'+asset.path,import.meta.url);let bytes;
 try{bytes=await readFile(target);await verifyAsrAsset(bytes,asset);}catch{bytes=null;}
 if(!bytes){const response=await fetch(ASR_ROOT+asset.path,{credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw Error('Model download failed: '+asset.path);bytes=await verifyAsrAsset(await response.arrayBuffer(),asset);await mkdir(new URL('./',target),{recursive:true});await writeFile(target,new Uint8Array(bytes));}
 console.log('Verified '+asset.path+' ('+asset.size+' bytes)');
}
console.log('Verified '+ASR_MODEL.assets.reduce((n,a)=>n+a.size,0)+' model bytes; no model/audio files committed.');
