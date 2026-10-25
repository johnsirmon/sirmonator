import test from 'node:test';
import assert from 'node:assert/strict';
import {asrPcm,compareAsr,createAsrClient} from '../src/local-asr.js';
import {verifyAsrAsset,loadAsrAssets,ASR_ROOT,ASR_MODEL} from '../src/asr-cache.js';
import {sha256Bytes} from '../src/asset-integrity.js';
test('PCM conversion preserves bounded duration and DC; rejects unsupported/oversized input',()=>{
 for(const rate of [22050,24000,44100,48000]){const bytes=new ArrayBuffer(rate*2),v=new DataView(bytes);for(let i=0;i<rate;i++)v.setInt16(i*2,8192,true);const out=asrPcm(bytes,rate);assert.equal(out.length,16000);assert.ok(out.every(x=>Math.abs(x-.25)<1e-6));}
 for(const [b,r] of [[new ArrayBuffer(1),24000],[new ArrayBuffer(0),24000],[new ArrayBuffer(2),16000],[new ArrayBuffer(24000*62),24000]])assert.throws(()=>asrPcm(b,r));
});
test('ASR uncertain hints bind exact source anchor and resampled PCM without mutating input',async()=>{
 const snapshot={key:'exact',source:'Paul spoke with hope.',spoken:'Paul spoke with hope.',anchor:{audioHash:'saved-pcm',takeId:'take-2',selectionRevision:7,start:15}},original=structuredClone(snapshot);
 const result=await compareAsr(snapshot,{pcmHash:'resampled',seconds:1},'Paul spoke with faith.');assert.equal(result.automaticTranscription,true);assert.equal(result.audioVerified,false);assert.equal(result.pcmHash,'resampled');assert.deepEqual(snapshot,original);assert.deepEqual(result.anchor,original.anchor);assert.equal(result.findings[0].expected,'hope');assert.match(result.limitations,/invent|mishear/);
});
test('worker hard cancellation, late events, retry, busy exclusion and repeated success',async()=>{
 const workers=[],client=createAsrClient({makeWorker:()=>{const w={terminate(){this.closed=true;},postMessage(data){this.data=data;}};workers.push(w);return w;}}),samples=new Float32Array(160),controller=new AbortController();
 const first=client.run(samples,{signal:controller.signal});await assert.rejects(client.run(samples),/already/);controller.abort();await assert.rejects(first,{name:'AbortError'});assert.equal(workers[0].closed,true);
 const next=client.run(samples);workers[0].onmessage({data:{type:'result',transcript:'stale'}});await assert.rejects(client.run(samples),/already/);workers[1].onmessage({data:{type:'result',transcript:'fresh'}});assert.equal((await next).transcript,'fresh');assert.equal(workers[1].closed,true);assert.equal(samples.length,160);
 const retry=client.run(samples);workers[2].onerror();await assert.rejects(retry,/worker failed/);const again=client.run(samples);workers[3].onmessage({data:{type:'result',transcript:'again'}});assert.equal((await again).transcript,'again');
});
test('timeout terminates hung inference and retry stays available',async()=>{
 let terminations=0;const client=createAsrClient({timeoutMs:5,makeWorker:()=>({postMessage(){},terminate(){terminations++;}})});await assert.rejects(client.run(new Float32Array(1)),/timed out/);await assert.rejects(client.run(new Float32Array(1)),/timed out/);assert.equal(terminations,2);
});
test('pinned bytes fail closed for same-size corruption and incorrect size',async()=>{
 const bytes=new TextEncoder().encode('verified').buffer,entry={size:bytes.byteLength,sha256:await sha256Bytes(bytes)};assert.equal(await verifyAsrAsset(bytes,entry),bytes);await assert.rejects(verifyAsrAsset(new TextEncoder().encode('modified').buffer,entry),/integrity/);await assert.rejects(verifyAsrAsset(new ArrayBuffer(1),entry),/integrity/);
});
test('cache loading verifies all model assets and never sends audio; missing assets cannot trigger runtime fallback',async()=>{
 // The committed manifest is the network allowlist. No wildcard or mutable main URL.
 assert.match(ASR_MODEL.revision,/^[a-f0-9]{40}$/);assert.equal(ASR_MODEL.assets.length,12);assert.ok(ASR_MODEL.assets.every(a=>/^[a-f0-9]{64}$/.test(a.sha256)));
 const bytes=new Uint8Array(1);
 let requests=0;await assert.rejects(loadAsrAssets({cacheStorage:{open:async()=>({match:async()=>new Response(bytes),delete:async()=>{}})},fetcher:async(url,options)=>{requests++;assert.ok(url.startsWith(ASR_ROOT));assert.equal(options.credentials,'omit');assert.equal(options.body,undefined);return new Response(new Uint8Array(1));}}),/integrity/);assert.equal(requests,1);
});
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {openStorage} from '../src/storage.js';
import {makeRecording} from '../src/recording.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';
import {syntheticPassage} from '../scripts/integration-fixture.mjs';
import {createSpeechReviewEditor} from '../src/speech-review-editor.js';
globalThis.IDBKeyRange=IDBKeyRange;globalThis.Option=class{constructor(text,value){this.textContent=text;this.value=value;}};
test('actual editor retains manual input, exports exact ASR evidence and rejects late stale/cancelled ASR',async()=>{
 const store=await openStorage(indexedDB,'asr-editor-'+crypto.randomUUID()),map=new Map(),$=id=>{if(!map.has(id))map.set(id,{id,value:'0',checked:false,textContent:'',addEventListener(){},replaceChildren(){},add(){},focus(){}});return map.get(id);};
 let job=await makeRecording('Paul spoke with hope.',{voice:'af_sarah',edition:'refined',speed:1,delivery:'natural',pipeline:FOUNDATION_PIPELINE});await store.ensureJob(job);await store.claim('asr-test');job=await store.commit(job.id,0,await syntheticPassage({text:job.source,settings:job.settings,last:true}),'asr-test');
 let resolve,ready,selection=0,exports=[];const started=()=>new Promise(r=>{ready=r;});
 const asr={cancel(){},run:async(samples,{signal})=>{assert.ok(samples.length);ready();return new Promise(r=>{resolve=r;});}};
 const editor=createSpeechReviewEditor({$,getStore:()=>store,getJob:()=>job,getSelection:()=>selection,isBusy:()=>false,onBusy(){},onListen(){},onRepair(){},onExport:v=>exports.push(v),repository:{load:async()=>null},asrClient:asr});
 try{await editor.update(job);$('review-transcript').value='My manual notes';const firstStarted=started(),pending=$('review-asr').onclick();await firstStarted;resolve({transcript:'Paul spoke with faith.',model:'pinned',revision:'fixed',dtype:'q8',device:'wasm',elapsedMs:1,tokenLimit:128});await pending;assert.equal($('review-transcript').value,'My manual notes');assert.match($('review-asr-output').textContent,/Uncertain ASR transcript/);await $('review-asr-export').onclick();assert.equal(exports.length,1);assert.equal(exports[0].automaticTranscription,true);assert.match(exports[0].pcmHash,/^[a-f0-9]{64}$/);
 const againStarted=started(),again=$('review-asr').onclick();await againStarted;editor.cancel();resolve({transcript:'late wrong words'});await again;assert.equal($('review-asr-output').textContent,'');assert.equal($('review-transcript').value,'My manual notes');assert.equal(editor.busy,false);
 const staleStarted=started(),stale=$('review-asr').onclick();await staleStarted;selection++;resolve({transcript:'stale wrong words'});await stale;assert.equal($('review-asr-output').textContent,'');assert.equal(exports.length,1);
 }finally{store.close();}
});
