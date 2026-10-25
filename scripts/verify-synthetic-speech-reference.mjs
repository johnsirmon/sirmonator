// Maintainer-only offline experiment. No personal/bundled character recordings,
// uploads, enrollment UI or persistent embeddings. Audio stays in ignored cache.
import {readFile,writeFile,mkdir,mkdtemp,copyFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fork,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const referenceText='This is generated sample speech for a local synthetic reference test. It describes a calm morning and a clear sky.',targetText='The small lantern glows beside the open window.';
const RSS_LIMIT=1280*1048576,TIME_LIMIT=90000;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fileHash(path){const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);return hash.digest('hex');}
function stats(samples){assert.ok(samples instanceof Float32Array&&samples.length);let peak=0,energy=0;for(const value of samples){assert.ok(Number.isFinite(value));peak=Math.max(peak,Math.abs(value));energy+=value*value;}return {samples:samples.length,peak,rms:Math.sqrt(energy/samples.length),sha256:sha(new Uint8Array(samples.buffer,samples.byteOffset,samples.byteLength))};}
async function mp3Proof(samples,dir,stem){
 const {Mp3Encoder}=await import('@breezystack/lamejs'),{encodeMp3,inspectMp3}=await import('../src/mp3.js');
 const bytes=encodeMp3(samples,24000,Mp3Encoder),info=inspectMp3(bytes),path=join(dir,stem+'.mp3');await writeFile(path,bytes);
 const decoded=spawnSync('ffmpeg',['-nostdin','-v','error','-i',path,'-f','f32le','-acodec','pcm_f32le','-ac','1','-ar','24000','pipe:1'],{timeout:15000,maxBuffer:8*1048576,windowsHide:true});
 assert.equal(decoded.status,0,'Existing ffmpeg could not decode generated MP3');assert.ok(decoded.stdout.length&&decoded.stdout.length%4===0);
 const pcm=new Float32Array(decoded.stdout.length/4);for(let i=0;i<pcm.length;i++)pcm[i]=decoded.stdout.readFloatLE(i*4);
 const output={bytes:bytes.length,sha256:sha(bytes),inspection:info,decoded:{...stats(pcm),sampleRate:24000,seconds:pcm.length/24000}};pcm.fill(0);return output;
}
const [stage,arg]=process.argv.slice(2);
if(stage==='kokoro'||stage==='pocket'){
 globalThis.fetch=async()=>{throw Error('Network disabled for synthetic speech verification');};
 const settings=JSON.parse(arg),controller=new AbortController();let maxRss=0;
 process.on('message',message=>{if(message?.type==='abort')controller.abort();});
 const watch=setInterval(()=>{maxRss=Math.max(maxRss,process.memoryUsage().rss);process.send?.({type:'rss',rss:maxRss});if(maxRss>RSS_LIMIT)controller.abort();},50);
 let result;
 try{
  if(stage==='kokoro'){
   const {env}=await import('@huggingface/transformers');env.allowRemoteModels=false;env.localModelPath=resolve('node_modules/@huggingface/transformers/.cache')+'/';
   const {loadPinnedKokoro}=await import('../src/pinned-kokoro.js'),{encodeWav}=await import('../src/core.js');
   let tts;try{
    tts=await loadPinnedKokoro({dtype:'q8',device:'cpu',session_options:{intra_op_num_threads:2}});
    tts.readVoice=async voice=>{assert.equal(voice,'af_sarah');const bytes=await readFile('node_modules/kokoro-js/voices/af_sarah.bin');return new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));};
    if(controller.signal.aborted)throw new DOMException('Resource guard stopped experiment','AbortError');
    const start=performance.now(),audio=await tts.generate(referenceText,{voice:'af_sarah',speed:1});assert.equal(audio.sampling_rate,24000);const measured=stats(audio.audio);assert.ok(audio.audio.length>=5*24000,'Generated reference is shorter than requested duration; no padding/retry');
    const references=[];for(const seconds of [3,5]){const samples=audio.audio.slice(0,seconds*24000),wav=new Uint8Array(encodeWav([samples],24000)),name='synthetic-'+seconds+'s.wav';await writeFile(join(settings.dir,name),wav);references.push({file:name,seconds,sampleRate:24000,sampleCount:samples.length,wavSha256:sha(wav),sourceStartSample:0,sourceEndSample:samples.length});samples.fill(0);}
    result={stage,referenceText,voice:'af_sarah',sampleRate:24000,generated:{...measured,seconds:audio.audio.length/24000},inferenceMs:performance.now()-start,references,derivation:'Exact first 3 and 5 seconds of one generated preset output, encoded PCM16 WAV. Prefix cuts may intersect speech; not quality-optimized references or an ASR transcript.'};audio.audio.fill(0);
   }finally{await tts?.model.dispose();}
  }else{
   const {prepareReference}=await import('../src/reference-provider.js'),{createPocketNode}=await import('./pocket-node.mjs'),{createCustomReferenceSession}=await import('./custom-reference-session.mjs');
   const source=JSON.parse(await readFile(join(settings.dir,'kokoro.json'),'utf8')),row=source.references.find(row=>row.seconds===settings.seconds),wav=await readFile(join(settings.dir,row.file));assert.equal(sha(wav),row.wavSha256);
   const file=new Blob([wav]),receipt=await prepareReference(file,{label:'Generated Kokoro preset reference '+settings.seconds+' seconds',authority:'synthetic',scope:'Local synthetic-only experimental validation; no personal voice or publication.',provenance:'Kokoro af_sarah preset; generated phrase SHA256 '+sha(Buffer.from(referenceText))+'; source PCM SHA256 '+source.generated.sha256+'; exact first '+settings.seconds+' seconds; no recorded person or character references.',permission:true,aiDisclosure:true});
   const session=createCustomReferenceSession({engineFactory:({signal})=>createPocketNode({offline:true,route:'custom-reference-v1',signal})});
   try{
    const start=performance.now();await session.prepare(file,receipt,{signal:controller.signal});const prepared=performance.now();const out=await session.generate(targetText,{signal:controller.signal});assert.equal(out.sampleRate,24000);const output=stats(out.samples);assert.equal(out.provenance.fileSha256,row.wavSha256);assert.equal(out.provenance.referenceId,receipt.id);assert.equal(out.provenance.consent.authority,'synthetic');assert.equal(out.provenance.text,targetText);assert.notEqual(targetText,referenceText);
    const mp3=await mp3Proof(out.samples,settings.dir,'target-'+settings.seconds+'s');result={stage,referenceSeconds:settings.seconds,reference:row,referenceId:receipt.id,conditioningAndLoadMs:prepared-start,generationMs:performance.now()-prepared,output:{...output,seconds:out.samples.length/24000,sampleRate:24000},mp3,provenance:out.provenance};out.samples.fill(0);
    if(settings.cancel){const started=performance.now(),timer=setTimeout(()=>session.revoke(),50);let published=false;try{await session.generate('This separate synthetic cancellation request must not publish.',{signal:controller.signal});published=true;}catch(error){assert.equal(error.name,'AbortError');result.cancellation={published:false,name:error.name,rejectionMs:performance.now()-started};}finally{clearTimeout(timer);}assert.equal(published,false);}
   }finally{session.dispose();await session.waitForDisposal();if(result)result.disposed=session.disposed;}
  }
  if(controller.signal.aborted)throw new DOMException('Resource guard stopped experiment','AbortError');
  result.maxSampledRssBytes=Math.max(maxRss,process.memoryUsage().rss);await writeFile(join(settings.dir,stage==='kokoro'?'kokoro.json':'pocket-'+settings.seconds+'s.json'),JSON.stringify(result,null,2)+'\n');process.send?.({type:'complete',stage});
 }catch(error){process.send?.({type:'failure',name:error.name,message:error.message});process.exitCode=1;}
 finally{clearInterval(watch);process.disconnect?.();}
}else{
 assert.equal(stage,'--pocket-cache','Usage: node scripts/verify-synthetic-speech-reference.mjs --pocket-cache <existing model cache root>');
 const inventory=JSON.parse(await readFile('evidence/reference-model-inventory.json','utf8')),assets=JSON.parse(await readFile('src/render-assets.json','utf8'));
 assert.equal(inventory.modelLicenseAtRevision,'cc-by-4.0');assert.equal(inventory.revision,'c469236dbc5f68287fa2fbf175b66de3b80123af');
 const checked=[];for(const name of ['config.json','tokenizer.json','tokenizer_config.json','onnx/model_quantized.onnx']){const path=join('node_modules/@huggingface/transformers/.cache/onnx-community/Kokoro-82M-v1.0-ONNX',name),bytes=await readFile(path),expected=assets.kokoro.files[name];assert.ok(expected);assert.equal(bytes.length,expected.size);if(expected.sha256)assert.equal(sha(bytes),expected.sha256);else assert.equal(createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'),expected.gitBlob);checked.push({provider:'kokoro',name,sha256:sha(bytes)});}
 const style=await readFile('node_modules/kokoro-js/voices/af_sarah.bin');assert.equal(sha(style),assets.kokoro.files['voices/af_sarah.bin'].sha256);checked.push({provider:'kokoro',name:'voices/af_sarah.bin',sha256:sha(style)});
 for(const file of inventory.files){assert.ok(/^[a-z0-9_.-]+$/.test(file.name)&&file.verified===true);const source=resolve(arg,inventory.revision,'onnx/english_2026-04',file.name),target=resolve('.cache/pocket-node/models',inventory.revision,'onnx/english_2026-04',file.name);assert.equal((await stat(source)).size,file.bytes);assert.equal(await fileHash(source),file.sha256);await mkdir(resolve(target,'..'),{recursive:true});try{await copyFile(source,target,1);}catch(error){if(error.code!=='EEXIST')throw error;}assert.equal(await fileHash(target),file.sha256);checked.push({provider:'pocket',name:file.name,sha256:file.sha256});}
 await mkdir('.cache',{recursive:true});const dir=await mkdtemp(resolve('.cache/synthetic-speech-reference-'));
 async function run(stage,extra={}){return new Promise((yes,no)=>{let failure=null,done=false,maxRss=0,grace;const child=fork(new URL(import.meta.url),[stage,JSON.stringify({dir,...extra})],{execArgv:['--max-old-space-size=512'],stdio:['ignore','ignore','pipe','ipc'],windowsHide:true,env:{...process.env,OMP_NUM_THREADS:'2'}});const stop=message=>{if(failure)return;failure=message;if(child.connected)child.send({type:'abort'});grace=setTimeout(()=>child.kill(),5000);};const deadline=setTimeout(()=>stop('90-second phase deadline reached'),TIME_LIMIT);child.stderr.on('data',()=>{});child.on('message',message=>{if(message.type==='rss'){maxRss=Math.max(maxRss,message.rss);if(maxRss>RSS_LIMIT)stop('1280 MiB sampled RSS ceiling reached');}else if(message.type==='failure')stop(message.name+': '+message.message);else if(message.type==='complete')done=true;});child.on('error',error=>stop(error.message));child.on('exit',code=>{clearTimeout(deadline);clearTimeout(grace);if(code===0&&done&&!failure)yes();else no(Error(failure||'Child exited without completion: '+code));});});}
 const report={schema:1,kind:'Offline generated non-personal speech -> synthetic-only Pocket Node reference experiment',newModelBytesDownloaded:0,externalFetchEnabled:false,personRecordingUsed:false,bundledCharacterAssetsRead:false,personalSynthesisEnabled:false,persistentProductionAudioOrEmbeddings:false,limits:{rssMiB:1280,rssMeasurement:'Child-process RSS sampled every 50 ms; abort guard, not an OS-enforced cap or true-peak measurement.',phaseMs:TIME_LIMIT,processes:'One child at a time; no higher-limit retry'},licenseScope:{kokoro:'Pinned card Apache-2.0; package preset hash verified',pocket:'Existing pinned verified inventory cc-by-4.0; Kyutai/Pocket export attribution retained',clearance:'No personal voice, character-reference or legal-clearance claim'},models:{kokoro:{repository:assets.kokoro.repository,revision:assets.kokoro.revision,voice:'af_sarah'},pocket:{repository:inventory.repository,revision:inventory.revision,inventorySha256Lf:sha(Buffer.from((await readFile('evidence/reference-model-inventory.json','utf8')).replaceAll('\r\n','\n')))}},verifiedAssets:checked,runs:[],status:'running',limitations:'Finite PCM and decoded MP3 do not establish likeness, intelligibility, spoken-word correctness, browser readiness or native cleanup guarantees. Task-local generated WAV/MP3 only; no production enrollment or persistent embedding.'};
 try{await run('kokoro');report.kokoro=JSON.parse(await readFile(join(dir,'kokoro.json'),'utf8'));for(const seconds of [3,5]){await run('pocket',{seconds,cancel:seconds===5});report.runs.push(JSON.parse(await readFile(join(dir,'pocket-'+seconds+'s.json'),'utf8')));}report.status='passed';}
 catch(error){report.status='stopped';report.blocker=error.message;process.exitCode=1;}
 await writeFile('evidence/synthetic-speech-reference-runtime.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,runs:report.runs.length,blocker:report.blocker??null}));
}
