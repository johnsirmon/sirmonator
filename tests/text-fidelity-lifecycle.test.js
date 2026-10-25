import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {openStorage} from '../src/storage.js';
import {makeRecording} from '../src/recording.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';
import {currentManifest} from '../src/render-provenance.js';
import archived from '../src/render-contract-d71b201.json' with {type:'json'};
const legacySettings=()=>{const base={voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE,pronunciation:parsePronunciation('John => jon\né => eh')},manifest=currentManifest(base);manifest.chunker={revision:'exact-offsets-240-v1',maxCharacters:240};manifest.source=archived.source;return {...base,renderManifest:manifest};};
import {parsePronunciation,spokenPassage} from '../src/pronunciation.js';
import {runRecording,validateCheckpoint,recordingBlob} from '../src/job-runner.js';
import {changePassage} from '../src/passage-takes.js';
import {fidelitySeeds,fidelityText} from '../scripts/text-fidelity-fixture.mjs';
import {resilienceAudio} from '../scripts/resilience-scenario.mjs';
import {sha256Bytes} from '../src/asset-integrity.js';
import {oracleEncode} from '../scripts/resilience-oracle.mjs';
import {createNodeExportWorker} from '../scripts/export-node.mjs';

globalThis.IDBKeyRange=IDBKeyRange;
for(const seed of fidelitySeeds)test('Unicode seed '+seed+' survives pause, failed attempt, reopen, resume and exact passage regeneration',async()=>{
 const source=fidelityText(seed),name='fidelity-'+seed+'-'+crypto.randomUUID(),owner='fixture',initial=await makeRecording(source,legacySettings()),successful=[],failed=[];let store=await openStorage(indexedDB,name),job=initial,pause=false,inject=false;
 const generate=async(text,settings,last)=>{const index=job.next,p=job.passages[index];assert.equal(text,source.slice(p.start,p.end));assert.equal(last,index===job.passages.length-1);assert.deepEqual(settings,initial.settings);if(inject){inject=false;failed.push(text);throw Error('Synthetic interrupted attempt');}const audio=resilienceAudio(job,index,{sampleCount:text.trim()?96:0});if(!text.trim())audio.metrics.engine='empty';assert.equal(audio.spokenText,spokenPassage(text,settings.pronunciation).text);successful.push(text);return audio;};
 try{await store.ensureJob(job);await store.claim(owner);const cut=Math.max(1,Math.floor(job.passages.length/3));job=await runRecording({store,id:job.id,owner,generate,shouldPause:()=>pause,onSaved:saved=>{job=saved;pause=job.next===cut;}});assert.equal(job.next,cut);store.close();store=await openStorage(indexedDB,name);await store.claim(owner);job=await store.job(job.id);
  inject=true;await assert.rejects(runRecording({store,id:job.id,owner,generate}),/interrupted/);assert.equal((await store.job(job.id)).next,cut);assert.equal(failed[0],source.slice(job.passages[cut].start,job.passages[cut].end));store.close();store=await openStorage(indexedDB,name);await store.claim(owner);job=await store.job(job.id);
  job=await runRecording({store,id:job.id,owner,generate,onSaved:saved=>{job=saved;}});assert.equal(successful.join(''),source);assert.equal(successful.length,job.passages.length);assert.equal(job.source,source);const originals=await store.parts(job.id);
  // Hash actual stored bytes separately from source routing assertions.
  const originalHashes=[];for(const part of originals)originalHashes.push(await sha256Bytes(await part.blob.arrayBuffer()));assert.equal(originals.length,job.passages.length);
  const available=job.passages.map((p,index)=>({p,index})).filter(({p})=>source.slice(p.start,p.end).trim()),index=available[Math.floor(available.length/2)].index,p=job.passages[index];let regenerated;
  job=await changePassage({store,id:job.id,index,owner,revision:0,generate:async(text,settings,last)=>{regenerated=text;assert.equal(text,source.slice(p.start,p.end));assert.equal(last,index===job.passages.length-1);return resilienceAudio(job,index,{sampleCount:123});}});assert.equal(regenerated,successful[index]);assert.equal(job.source,source);const selected=await validateCheckpoint(store,job);assert.equal(selected[index].sampleCount,123);
  const artifact=await recordingBlob(store,job,null,undefined,{createWorker:createNodeExportWorker}),expected=await oracleEncode(selected);assert.equal(await sha256Bytes(await artifact.blob.arrayBuffer()),await sha256Bytes(expected));
  job=await changePassage({store,id:job.id,action:'undo',owner,revision:1});assert.equal(job.source,source);const restored=await store.parts(job.id);for(let i=0;i<restored.length;i++)assert.equal(await sha256Bytes(await restored[i].blob.arrayBuffer()),originalHashes[i]);assert.equal((await validateCheckpoint(store,job))[index].takeId,undefined);
 }finally{store.close();}
});
