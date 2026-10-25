// Explicit local catalog update; never downloads weights. Review metadata pins
// before updating. Tests reject a catalog stale against rendering source bytes.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {voices} from '../src/voices.js';
import {KOKORO_REVISION} from '../src/engine-specs.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const sourceFiles=['src/engine-specs.js','src/asset-integrity.js','src/pinned-kokoro.js','src/tts-worker.js','src/speech-runner.js','src/render-provenance.js','src/render-metrics.js','src/core.js','src/recording.js','src/job-runner.js','src/storage.js','src/take-selection.js','src/passage-takes.js','src/render-contract-944aa8e.json','src/pronunciation.js','src/pronunciation-compatibility.json','src/render-contract-1458c2e.json','src/render-contract-8e3e830.json','src/mp3-export-worker.js','src/audio-effects.js','src/character-settings.js','src/voices.js','src/tempo.js','src/pocket-client.js','src/pocket-engine.js','src/supertonic-engine.js','src/vendor/supertonic.js','src/vendor/pocket/worker.js','src/vendor/pocket/tokenizer.js','src/vendor/pocket/binary.js','src/mp3.js','src/continuity.js'];
export async function sourceSnapshot(){const files={};for(const name of sourceFiles)files[name]=hash((await readFile(name,'utf8')).replaceAll('\r\n','\n'));files['package-lock.json']=hash((await readFile('package-lock.json','utf8')).replaceAll('\r\n','\n'));return {files,sha256:hash(JSON.stringify(files))};}
export async function updateCatalog(){
 let prior;try{prior=JSON.parse(await readFile('src/render-assets.json','utf8'));}catch{}
 let metadata;try{metadata=JSON.parse(await readFile('.cache/foundation-kokoro-metadata.json','utf8'));}catch{}
 const kokoro=metadata?{repository:metadata.id,revision:metadata.sha,files:Object.fromEntries(metadata.siblings.filter(f=>voices.some(v=>v.engine==='kokoro'&&f.rfilename==='voices/'+v.base+'.bin')||['config.json','tokenizer.json','tokenizer_config.json','onnx/model.onnx','onnx/model_quantized.onnx'].includes(f.rfilename)).map(f=>[f.rfilename,{size:f.size,...(f.lfs?{sha256:f.lfs.sha256}:{gitBlob:f.blobId})}]))}:prior?.kokoro;
 if(kokoro?.revision!==KOKORO_REVISION)throw Error('Matching reviewed Kokoro metadata is required.');
 const refs={};for(const id of ['prime','fenix','prime-v2','fenix-v2']){const bytes=await readFile('public/references/'+id+'.wav');refs[id]={file:'references/'+id+'.wav',size:bytes.length,sha256:hash(bytes)};}
 const lock=JSON.parse(await readFile('package-lock.json','utf8')),packages={};for(const name of ['kokoro-js','@huggingface/transformers','onnxruntime-web','pocket-tts-js','soundtouchjs','@breezystack/lamejs','phonemizer']){const pkg=lock.packages['node_modules/'+name];packages[name]={version:pkg.version,integrity:pkg.integrity};}
 const catalog={schema:1,source:await sourceSnapshot(),packages,kokoro,references:refs};await writeFile('src/render-assets.json',JSON.stringify(catalog,null,2)+'\n');return catalog;
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/update-render-catalog.mjs'))await updateCatalog();
