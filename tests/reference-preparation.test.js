import {browserStorageEstimate,storageEstimateText} from '../src/storage-usage.js';
// All reference fixtures are procedural sine/DC/noise samples authored here;
// no human performance or bundled character audio. Fixture code/audio: CC0-1.0.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {encodeWav} from '../src/core.js';
import {inspectReferenceWav,MAX_REFERENCE_BYTES} from '../src/reference-audio.js';
import {referenceConsent,prepareReference,validateReferenceRecord,referenceCapabilities,enrollReference,synthesizeReference} from '../src/reference-provider.js';
import {openReferenceStorage} from '../src/reference-storage.js';
import {createReferenceEditor} from '../src/reference-editor.js';
import {engineCapabilities,assertEngineRequest} from '../src/engine-capabilities.js';
import {makeRecording,normalizeSettings} from '../src/recording.js';
import {FOUNDATION_PIPELINE,currentManifest,assertSupportedManifest} from '../src/render-provenance.js';
import {parsePronunciation,LEGACY_PRONUNCIATION_MATCHER} from '../src/pronunciation.js';
import {getVoice} from '../src/voices.js';
import archived from '../src/render-contract-0bd2d4a.json' with {type:'json'};
const consent={label:'Synthetic fixture',authority:'synthetic',scope:'Local validation tests only.',provenance:'Procedural 220 Hz sine wave generated in tests/reference-preparation.test.js. No recorded person; CC0-1.0.',permission:true,aiDisclosure:true};
const wave=(seconds=3,mode='tone')=>encodeWav([Float32Array.from({length:Math.round(24000*seconds)},(_,i)=>mode==='silent'?0:mode==='constant'?.1:mode==='full'?(i%2?1:-1):(mode==='quiet'?.0001:.1)*Math.sin(2*Math.PI*220*i/24000))],24000);
const file=buffer=>new File([buffer],'procedural-tone.wav',{type:'audio/wav'});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
test('strict local WAV inspection measures bounded synthetic PCM without retaining or claiming speech',async()=>{
 const buffer=wave(),result=await inspectReferenceWav(buffer);assert.equal(result.seconds,3);assert.equal(result.sampleCount,72000);assert.equal(result.channels,1);assert.equal(result.speechVerified,false);assert.match(result.fileSha256,/^[a-f0-9]{64}$/);assert.match(result.pcmSha256,/^[a-f0-9]{64}$/);assert.ok(result.signal.acRms>.06&&result.signal.acRms<.08);assert.equal(result.signal.fullScaleSamples,0);assert.equal('samples' in result,false);assert.equal('buffer' in result,false);
 const extended=new Uint8Array(buffer.byteLength+10);extended.set(new Uint8Array(buffer));extended.set(new TextEncoder().encode('JUNK'),buffer.byteLength);new DataView(extended.buffer).setUint32(buffer.byteLength+4,1,true);extended[buffer.byteLength+8]=99;new DataView(extended.buffer).setUint32(4,extended.byteLength-8,true);const other=await inspectReferenceWav(extended.buffer);assert.notEqual(other.fileSha256,result.fileSha256);assert.equal(other.pcmSha256,result.pcmSha256);
});
test('malformed/ambiguous WAV, unwanted conversion, out-of-range duration, silence/DC and high full-scale count reject',async()=>{
 for(const [offset,value,type] of [[4,0,'u32'],[16,2,'u32'],[20,3,'u16'],[22,2,'u16'],[24,22050,'u32'],[28,1,'u32'],[32,4,'u16'],[34,8,'u16'],[40,1,'u32']]){const buffer=wave(),view=new DataView(buffer);if(type==='u32')view.setUint32(offset,value,true);else view.setUint16(offset,value,true);await assert.rejects(inspectReferenceWav(buffer));}
 const duplicate=new Uint8Array(wave().byteLength+24);duplicate.set(new Uint8Array(wave()));duplicate.set(new Uint8Array(wave(),12,24),duplicate.length-24);new DataView(duplicate.buffer).setUint32(4,duplicate.length-8,true);await assert.rejects(inspectReferenceWav(duplicate.buffer),/Duplicate/);
 for(const buffer of [new ArrayBuffer(43),new ArrayBuffer(MAX_REFERENCE_BYTES+1),wave(2.99),wave(10.01),wave(3,'silent'),wave(3,'constant'),wave(3,'quiet'),wave(3,'full')])await assert.rejects(inspectReferenceWav(buffer));
});
test('consent is required before file bytes are read; scope/provenance bind to digests and cannot become enrolled',async()=>{
 let reads=0;const buffer=wave(),input={size:buffer.byteLength,arrayBuffer:async()=>{reads++;return buffer;}};
 for(const change of [{permission:false},{aiDisclosure:false},{authority:'unknown'},{scope:''},{provenance:''}])await assert.rejects(prepareReference(input,{...consent,...change}));assert.equal(reads,0);
 const record=await prepareReference(input,consent);assert.equal(reads,1);await validateReferenceRecord(record);assert.equal(record.state,'validated-local-only');assert.equal(record.consent.authority,'synthetic');assert.equal(referenceCapabilities.personalSynthesisEnabled,false);assert.equal(referenceCapabilities.enrollmentEnabled,false);assert.throws(enrollReference,/not enabled/);assert.throws(synthesizeReference,/No preset fallback/);
 await assert.rejects(validateReferenceRecord({...record,consent:{...record.consent,scope:'different use'}}),/binding/);await assert.rejects(validateReferenceRecord({...record,audio:new Blob([buffer])}),/Invalid/);await assert.rejects(prepareReference({size:MAX_REFERENCE_BYTES+1,arrayBuffer:()=>{throw Error('must not read');}},consent));assert.throws(()=>referenceConsent({...consent,label:'x'.repeat(81)}));
});
test('cancellation after deferred local file read discards validation result without saving',async()=>{
 const buffer=wave(),gate=deferred(),started=deferred(),controller=new AbortController(),pending=prepareReference({size:buffer.byteLength,arrayBuffer:async()=>{started.resolve();return gate.promise;}},consent,{signal:controller.signal});await started.promise;controller.abort();await assert.rejects(pending,{name:'AbortError'});gate.resolve(buffer);
});
test('metadata-only storage reloads, revokes durably, rejects stale writes and forgets without resetting version',async()=>{
 const name='reference-record-'+crypto.randomUUID();let store=await openReferenceStorage(indexedDB,name);const record=await prepareReference(file(wave()),consent);let row=await store.save(record,0);assert.equal(row.version,1);store.close();store=await openReferenceStorage(indexedDB,name);row=await store.load();assert.equal(row.receipt.id,record.id);assert.equal('audio' in row.receipt,false);
 const stale=await prepareReference(file(wave()),consent,{preparationVersion:1});row=await store.revoke(1);assert.equal(row.version,2);assert.equal(row.receipt.state,'revoked');await validateReferenceRecord(row.receipt);await assert.rejects(store.save(stale,1),/Another tab/);await assert.rejects(store.save(record,2),/Re-attest/);row=await store.forget(2);assert.equal(row.receipt,null);assert.equal(row.version,3);await assert.rejects(store.save(record,0),/Another tab/);
 const fresh=await prepareReference(file(wave()),consent,{preparationVersion:3});row=await store.save(fresh,3);assert.equal(row.version,4);assert.notEqual(row.receipt.id,record.id);store.close();
});
test('all existing engines reject personal reference intent instead of silently returning presets',async()=>{
 const settings={voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE};
 for(const [engine,voice] of [['kokoro','af_sarah'],['supertonic','st-m1'],['pocket','prime']])for(const [key,value] of [['referenceProfile','test'],['referenceAudio',null],['referenceReceipt',undefined]]){
  assert.equal(engineCapabilities(engine).personalReference,false);assert.throws(()=>assertEngineRequest(engine,{[key]:value}),/not enabled/);assert.throws(()=>normalizeSettings({...settings,voice,[key]:value}),/not enabled/);
 }
 assert.equal(engineCapabilities('pocket').referenceEncoderInCode,true);assert.throws(()=>engineCapabilities('unknown'));assert.equal(normalizeSettings(settings).voice,'af_sarah');
 const source=await readFile('src/tts-worker.js','utf8'),handler=source.slice(source.indexOf('self.onmessage=async')).replaceAll('import.meta.url',JSON.stringify('file:///test/worker.js')),messages=[];
 const context=vm.createContext({browserStorageEstimate,storageEstimateText,storageReady:true,storageOpening:false,storageStateChanged(){},self:{postMessage:m=>messages.push(m)},performance:{now:()=>0},getVoice,assertEngineRequest,LEGACY_PIPELINE:'mp3-passages-v1-2026-10-23',FOUNDATION_PIPELINE});vm.runInContext(handler,context);await context.self.onmessage({data:{requestId:1,text:'',settings:{...settings,referenceProfile:'not enabled'}}});assert.equal(messages[0].type,'error');assert.match(messages[0].message,/No|not enabled/);
});
test('guard-only renderer changes preserve archived no-reference jobs and both pronunciation matcher versions',async()=>{
 const base={voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE};
 for(const pronunciation of [undefined,parsePronunciation('Paul => pawl'),{...parsePronunciation('Paul => pawl'),matcher:LEGACY_PRONUNCIATION_MATCHER}]){const settings={...base,...(pronunciation?{pronunciation}:{})},manifest=currentManifest(settings);manifest.chunker={revision:'exact-offsets-240-v1',maxCharacters:240};manifest.source=archived.source;const job=await makeRecording('Paul spoke.',{...settings,renderManifest:manifest});assertSupportedManifest(job.settings);assert.equal(job.source,'Paul spoke.');}
});
function elements(){const map=new Map();return id=>{if(!map.has(id))map.set(id,{value:'',checked:false,disabled:false,textContent:'',files:[],listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}});return map.get(id);};}
test('actual main bootstrap restores reference metadata after initial selection and later selections still cancel',async()=>{
 const store=await openReferenceStorage(indexedDB,'reference-bootstrap-'+crypto.randomUUID()),receipt=await prepareReference(file(wave()),consent);await store.save(receipt,0);
 const $=elements(),main=await readFile('src/main.js','utf8'),bootstrap=main.slice(main.indexOf('async function initialize(){'),main.indexOf('\npronunciationEditor=createPronunciationEditor')),
  selection=main.split('\n').find(line=>line.startsWith('function beginSelection()')),
  calls=main.split('\n').filter(line=>line==='initialize();'||line.startsWith('referenceEditor=createReferenceEditor(')).join('\n');
 const context=vm.createContext({browserStorageEstimate,storageEstimateText,storageReady:true,storageOpening:false,storageStateChanged(){},$,creating:false,auditionBusy:false,importing:false,quick:false,exporting:false,takeEditor:null,speechReview:null,referenceEditor:undefined,store:null,dirty:false,selectionToken:0,renderToken:0,cancelPreparations(){},controls(){},narratorNote(){},async openStorage(){return {async draft(){return null;}};},async refreshLibrary(){return [];},navigator:{storage:{}},status(){},warn:e=>e.message,
  createReferenceEditor:options=>createReferenceEditor({...options,repository:store})});
 vm.runInContext(selection+'\n'+bootstrap+'\n'+calls,context);await context.referenceEditor.ready;
 assert.match($('reference-saved').textContent,/validated-local-only/);assert.equal($('reference-revoke').disabled,false);assert.equal($('reference-forget').disabled,false);
 let cancelled=0;context.referenceEditor.cancel=()=>cancelled++;vm.runInContext('beginSelection()',context);assert.equal(cancelled,1);store.close();
});
test('actual preparation UI validates synthetic file, saves metadata, reloads and revokes without enabling a narrator',async()=>{
 const store=await openReferenceStorage(indexedDB,'reference-ui-'+crypto.randomUUID()),$=elements(),editor=createReferenceEditor({$,repository:store});await editor.ready;
 for(const [id,value] of [['reference-label',consent.label],['reference-authority','synthetic'],['reference-scope',consent.scope],['reference-provenance',consent.provenance]])$(id).value=value;$('reference-permission').checked=true;$('reference-disclosure').checked=true;$('reference-file').files=[file(wave())];await $('reference-inspect').onclick();assert.match($('reference-report').textContent,/Validated locally/);assert.equal($('reference-save').disabled,false);assert.equal(editor.capabilities.personalSynthesisEnabled,false);
 await $('reference-save').onclick();assert.match($('reference-saved').textContent,/validated-local-only/);assert.equal($('reference-save').disabled,true);await $('reference-reload').onclick();assert.match($('reference-status').textContent,/No audio was read/);await $('reference-revoke').onclick();assert.match($('reference-saved').textContent,/revoked/);assert.equal($('reference-permission').checked,false);assert.equal((await store.load()).receipt.state,'revoked');store.close();
});
test('editing/cancelling during deferred inspection cannot publish stale consent-bound results',async()=>{
 const store=await openReferenceStorage(indexedDB,'reference-ui-cancel-'+crypto.randomUUID()),$=elements(),editor=createReferenceEditor({$,repository:store});await editor.ready;
 for(const [id,value] of [['reference-label',consent.label],['reference-authority','synthetic'],['reference-scope',consent.scope],['reference-provenance',consent.provenance]])$(id).value=value;$('reference-permission').checked=true;$('reference-disclosure').checked=true;const buffer=wave(),gate=deferred(),started=deferred();$('reference-file').files=[{size:buffer.byteLength,arrayBuffer:async()=>{started.resolve();return gate.promise;}}];const pending=$('reference-inspect').onclick();await started.promise;$('reference-scope').value='Changed use';$('reference-scope').listeners.input();gate.resolve(buffer);await pending;assert.equal($('reference-report').textContent,'');assert.equal($('reference-save').disabled,true);assert.equal((await store.load()).receipt,null);store.close();
});
