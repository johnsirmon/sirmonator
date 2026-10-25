// Read-only historical-code probes. Requires the named commits locally; never
// downloads history, edits production source, starts a model or uses a browser.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {createSynthesisClient} from '../src/synthesis-client.js';
import {createSourceImporter} from '../src/source-importer.js';
import {abortable,assertActive,isPcmPipeline,validatePcm} from '../src/continuity.js';
import {sha256Bytes} from '../src/asset-integrity.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';

const prior={worker:'fb25d0c5ce41204522186f0b934506143efa1cf6',source:'0c803a57ddf96b3a8ee57b43b8efbac7989fd312',storage:'cbb8bd128edf1fcc619add6fbcb80d3aa161e165',checksum:'23d62a8e229a8fdbee6406c14b4330529f8fa9e2',takes:'1aa0d486212bf528a5ea268a25d8dea44f75435d'};
const git=args=>execFileSync('git',['-c','core.fsmonitor=false',...args],{encoding:'utf8',maxBuffer:4*1024*1024,windowsHide:true}).trimEnd();
const normalize=text=>text.replaceAll('\r\n','\n'),hash=text=>createHash('sha256').update(normalize(text)).digest('hex'),sources=new Map();
async function source(commit,path){const key=commit+':'+path;if(!sources.has(key))sources.set(key,normalize(commit==='current'?await readFile(path,'utf8'):git(['show',commit+':'+path])));return sources.get(key);}
function section(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,'Explicit source section: '+start);return text.slice(a,b);}
function line(text,start){const found=text.split('\n').find(value=>value.startsWith(start));assert.ok(found,'Explicit handler: '+start);return found;}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function nodes(){const map=new Map();return id=>{if(!map.has(id))map.set(id,{value:'',checked:true,hidden:false,textContent:'',pause(){}});return map.get(id);};}
const results=[];
async function evaluate({id,commit,path,scope,probe}){
 const historical=await source(commit,path),current=await source('current',path),before=await probe(historical,false),after=await probe(current,true);
 assert.equal(before.positiveControl,true,id+': historical positive control failed');assert.equal(after.positiveControl,true,id+': current positive control failed');
 assert.equal(before.regressionPass,false,id+': regression did not catch the known historical bug');assert.equal(after.regressionPass,true,id+': current implementation failed the regression');
 const result={id,historicalCommit:commit,path,scope,historicalSourceSha256:hash(historical),currentSourceSha256:hash(current),positiveControlsPass:true,historicalRegressionPass:false,currentRegressionPass:true,knownBugCaught:true,historicalObserved:before.observed,currentObserved:after.observed};results.push(result);console.log(id+': historical bug caught; positive controls and current regression pass');
}

await evaluate({id:'worker-disposal-cannot-strand-request',commit:prior.worker,path:'src/synthesis-client.js',scope:'Actual synthesis client module; injected worker/timers, no native worker or cleanup guarantee',probe:async(text,current)=>{
 const factory=current?createSynthesisClient:(await import('data:text/javascript,'+encodeURIComponent(text))).createSynthesisClient,workers=[];
 const client=factory({createWorker:()=>{const worker={messages:[],throwOnTerminate:false,postMessage(data){this.messages.push(data);},terminate(){if(this.throwOnTerminate)throw Error('synthetic disposal failure');},reply(){const input=this.messages.at(-1);this.onmessage({data:{type:'passage',requestId:input.requestId,bytes:new Uint8Array([1]).buffer,seconds:1}});}};workers.push(worker);return worker;},setTimer:()=>1,clearTimer(){}});
 const input={text:'Synthetic exact words.',settings:{voice:'af_sarah'}};
 async function pair(){for(let i=0;i<2;i++){const pending=client.generate(input,'kokoro:frozen');workers.at(-1).reply();assert.equal((await pending).seconds,1);}}
 await pair();let rejected=false;const pending=client.generate(input,'kokoro:frozen');pending.catch(()=>rejected=true);workers.at(-1).throwOnTerminate=true;let threw=false;try{client.cancel();}catch{threw=true;}await tick();const settledAfterFirstCancel=rejected;
 let retries=false;try{if(settledAfterFirstCancel&&!threw){await pair();retries=true;}}finally{workers.forEach(w=>w.throwOnTerminate=false);client.cancel();await pending.catch(()=>{});}
 return {positiveControl:true,regressionPass:!threw&&settledAfterFirstCancel&&retries,observed:{cancelThrew:threw,rejectedAfterFirstCancel:settledAfterFirstCancel,twoWarmRetries:retries}};
}});

await evaluate({id:'source-import-stop-rejects-late-read',commit:prior.source,path:'src/main.js',scope:'Actual file/Stop handlers plus current importer; deferred read and save stubs, not native PDF/DOCX I/O',probe:async(text,current)=>{
 async function run(cancel){const $=nodes(),read=deferred(),context=vm.createContext({$,createSourceImporter,importDocument:()=>read.promise,controls(){},status:value=>context.message=value,warn:e=>e.message,flushDraft:async()=>{},updateText(){vm.runInContext('draftRevision++',context);},killWorker(){},cancelPreparations(){},audition:{stop(){}},window:{}});
  const setup=current?line(text,'sourceImporter=createSourceImporter'):'';
  vm.runInContext(`let sourceImporter,importing=false,dirty=false,draftRevision=0,creating=false,quick=false,renderToken=0;${setup}\n${line(text,"$('file').onchange=")}\n${line(text,"$('stop').onclick=")}\nglobalThis.state=()=>({importing});`,context);
  $('text').value='Current source';$('file').files=[{name:'synthetic.txt'}];const pending=$('file').onchange();if(cancel){$('stop').onclick();$('text').value='Newer source';vm.runInContext('draftRevision++',context);}read.resolve({text:'Imported source',note:'Synthetic fixture'});await pending;return {text:$('text').value,reading:context.state().importing,message:context.message};
 }
 const control=await run(false),observed=await run(true);return {positiveControl:control.text==='Imported source'&&!control.reading,regressionPass:observed.text==='Newer source'&&!observed.reading,observed};
}});

await evaluate({id:'undo-clear-invalidates-boundary-acknowledgment',commit:prior.source,path:'src/main.js',scope:'Actual Undo Clear handler; chapter replanning stub deliberately does not clear review',probe:async text=>{
 const $=nodes(),undo={text:'Original reviewed source.',title:'Original title',boundaryPolicy:'word-grapheme-240-v2'},context=vm.createContext({$,undo,LEGACY_BOUNDARIES:'exact-offsets-240-v1',updateText(){}});vm.runInContext(line(text,"$('undo-clear').onclick="),context);$('text').value='New source';$('review').checked=true;$('undo-clear').onclick();return {positiveControl:$('text').value===undo.text&&$('title').value===undo.title,regressionPass:$('review').checked===false,observed:{restoredText:$('text').value,reviewAcknowledged:$('review').checked}};
}});

await evaluate({id:'late-draft-save-preserves-storage-warning',commit:prior.storage,path:'src/main.js',scope:'Actual flushDraft and connection-invalidation handlers; deferred storage, no browser IndexedDB',probe:async text=>{
 async function run(invalidate){const $=nodes(),save=deferred(),started=deferred(),context=vm.createContext({$,storageReady:true,store:{saveDraft:async()=>{started.resolve();await save.promise;}},draftRevision:1,saveChain:Promise.resolve(),draftTimer:0,podcastSaveTimer:0,clearTimeout(){},draft:()=>({text:'Synthetic draft'}),MAX_DOCUMENT:2000000,warn:e=>e.message,cancelled:false,pauseRequested:false,beginSelection(){},killWorker(){},takeEditor:null,status(){},controls(){}});
  vm.runInContext(section(text,'async function flushDraft(){','function queueSave()')+'\n'+section(text,'function storageStateChanged(','const audition='),context);const pending=context.flushDraft();await started.promise;let warning;if(invalidate){context.draftRevision++;context.storageStateChanged({state:'versionchange',message:'Synthetic connection change'});warning=$('save-status').textContent;}save.resolve();await pending;return {status:$('save-status').textContent,warning,preserved:!invalidate||$('save-status').textContent===warning};
 }
 const control=await run(false),observed=await run(true);return {positiveControl:/Draft saved/.test(control.status),regressionPass:observed.preserved&&/unsaved/.test(observed.warning),observed};
}});

await evaluate({id:'same-length-pcm-corruption-is-rejected',commit:prior.checksum,path:'src/job-runner.js',scope:'Actual checkpoint validator, real SHA-256, in-memory Blob; recording planner and take resolution stubbed',probe:async text=>{
 const raw=new Uint8Array([0,0,12,0]),originalHash=await sha256Bytes(raw),sourceText='Synthetic source.',job={id:'fixture',sourceHash:await sha256Bytes(new TextEncoder().encode(sourceText)),source:sourceText,settings:{pipeline:'pcm-passages-v2-2026-10-24'},passages:[{start:0,end:sourceText.length,chapter:0}],chapters:[{start:0,end:sourceText.length}],next:1,sampleRate:24000};
 const context=vm.createContext({Blob,makeRecording:async()=>structuredClone(job),isPcmPipeline,validatePcm,assertActive,abortable,FOUNDATION_PIPELINE,sha256Bytes,resolveTakes:async(_store,_job,parts)=>parts});
 vm.runInContext(section(text,'export async function validateCheckpoint','// A passage is complete').split('// A private, one-use validation capability.')[0].replace('export async function','async function')+'\nglobalThis.validate=validateCheckpoint;',context);
 const part=bytes=>({jobId:job.id,index:0,seconds:2/24000,format:'pcm-s16le',channels:1,sampleRate:24000,sampleCount:2,blob:new Blob([bytes]),audioHash:originalHash});
 const good=await context.validate({parts:async()=>[part(raw)]},job),changed=raw.slice();changed[0]^=1;let rejected=false;try{await context.validate({parts:async()=>[part(changed)]},job);}catch(error){if(!/integrity/.test(error.message))throw error;rejected=true;}
 return {positiveControl:good.length===1,regressionPass:rejected,observed:{sameByteLength:true,corruptionRejected:rejected}};
}});

await evaluate({id:'ended-event-cannot-acknowledge-unseen-take-export',commit:prior.takes,path:'src/main.js',scope:'Actual ended/export handlers; remote job revision and file publication stubbed, no encoding or browser',probe:async text=>{
 async function run(changed){const $=nodes(),job={id:'fixture',title:'Synthetic',next:1,passages:[{chapter:0}],takeSelection:{revision:0}},remote={...job,takeSelection:{revision:changed?1:0}};let prepared=0,published=0;
  const context=vm.createContext({$,AbortController,abortable,assertActive,Blob,File,busy:()=>false,controls(){},store:{job:async()=>structuredClone(remote)},recordingBlob:async()=>{prepared++;return {blob:new Blob(['synthetic bytes'])};},renderDetails(){},saveFile:()=>published++,safeFilename:v=>v,availableChapters:()=>[0],navigator:{},warn:e=>e.message,status(){},loadChapter(){throw Error('Unexpected audio load');},showPreparationProgress(){}});
  vm.runInContext(`let selectedJob=${JSON.stringify(job)},loadedJobId='fixture',loadedChapter=0,loadedThrough=1,selectionToken=0,renderToken=0,exporting=false,exportController=null;${section(text,"$('audio').onended=","$('download').onclick=")}\n${section(text,'async function exportAudio(',"$('start').onclick=")}\nglobalThis.start=()=>exportAudio();globalThis.revision=()=>selectedJob.takeSelection.revision;`,context);
  await $('audio').onended();await context.start();return {revision:context.revision(),prepared,published};
 }
 const control=await run(false),observed=await run(true);return {positiveControl:control.prepared===1&&control.published===1,regressionPass:observed.revision===0&&observed.prepared===0&&observed.published===0,observed};
}});

const currentCheckpoint=git(['rev-parse','HEAD']),report={schema:1,kind:'Historical-code regression effectiveness; no production mutants',currentCheckpoint,sourceHashConvention:'SHA-256 of source text normalized to LF',checks:results,allKnownBugsCaught:results.every(r=>r.knownBugCaught),productionCodeChanged:false,limits:'Injected worker, UI and storage seams; only PCM hashing uses actual byte integrity logic. Not native browser/media/IndexedDB, model, acoustic or deployment verification. Historical commits must exist locally; missing history fails without fetching.'};
await mkdir('evidence',{recursive:true});await writeFile('evidence/regression-effectiveness.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:results.length,allKnownBugsCaught:report.allKnownBugsCaught,currentCheckpoint}));
