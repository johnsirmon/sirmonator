// Reads public revision metadata only; model bytes are read from existing disk
// cache and are never requested from the network. No audio is read/transmitted.
import {readFile,stat,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const revision='c469236dbc5f68287fa2fbf175b66de3b80123af',repository='vlapky/pocket-tts-onnx',directory='onnx/english_2026-04/';
const metadataUrl=`https://huggingface.co/api/models/${repository}/revision/${revision}?blobs=true`;
const response=await fetch(metadataUrl,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Public metadata request failed: '+response.status);
const metadata=await response.json();if(metadata.sha!==revision)throw Error('Metadata did not resolve the requested revision.');
const names=['bundle.json','tokenizer.model','bos_before_voice.npy','mimi_encoder_int8.onnx','text_conditioner_int8.onnx','flow_lm_main_int8.onnx','flow_lm_flow_int8.onnx','mimi_decoder_int8.onnx'],files=[];
for(const name of names){
 const upstream=metadata.siblings?.find(file=>file.rfilename===directory+name);if(!upstream)throw Error('Missing upstream metadata: '+name);
 const path=resolve('.cache/pocket-node/models',revision,directory,name),info=await stat(path),sha256=createHash('sha256'),git=createHash('sha1');git.update(Buffer.from(`blob ${info.size}\0`));
 for await(const chunk of createReadStream(path)){sha256.update(chunk);git.update(chunk);}
 const digest=sha256.digest('hex'),gitBlob=git.digest('hex'),expectedSha256=upstream.lfs?.sha256??upstream.lfs?.oid??null,verified=info.size===upstream.size&&(expectedSha256?digest===expectedSha256:gitBlob===upstream.blobId);
 if(!verified)throw Error('Existing cache mismatch: '+name);files.push({name,bytes:info.size,sha256:digest,expectedSha256,gitBlob:upstream.blobId,verified});
}
const dependencies={};for(const name of ['pocket-tts-js','onnxruntime-web','onnxruntime-node']){const pkg=JSON.parse(await readFile('node_modules/'+name+'/package.json','utf8'));dependencies[name]={version:pkg.version,license:pkg.license};}
const report={schema:1,repository,revision,metadataUrl,modelLicenseAtRevision:metadata.cardData?.license??null,language:'english_2026-04',cachedBytes:files.reduce((n,f)=>n+f.bytes,0),files,dependencies,referenceEncodingCodePresent:true,personalSynthesisEnabled:false,newModelBytesDownloaded:0,audioReadOrTransmitted:false,limitations:'Disk-cache integrity inventory only. Does not prove browser cache presence, runtime/model compatibility, successful enrollment, likeness, speech quality or reference rights.'};
await writeFile('evidence/reference-model-inventory.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
