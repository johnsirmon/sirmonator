// Four minutes of procedural PCM; real storage API with fake-indexeddb, no model.
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {writeFile} from 'node:fs/promises';
import {openStorage} from '../src/storage.js';
import {resilienceJob,resilienceAudio,check} from './resilience-scenario.mjs';
import {recordingBlob,createPlaybackPreparation} from '../src/job-runner.js';
import {createChapterCache} from '../src/chapter-cache.js';
import {createNodeExportWorker} from './export-node.mjs';
import {oracleEncode} from './resilience-oracle.mjs';
import {sha256Bytes} from '../src/asset-integrity.js';
import {mp3Duration} from '../src/mp3.js';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
globalThis.IDBKeyRange=IDBKeyRange;
const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),90000),memory=[],counts={bulkReads:0,rows:0,blobReads:0,blobBytes:0},owner='longform';let store,peakRss=process.memoryUsage().rss;
const sample=()=>{const value=process.memoryUsage();peakRss=Math.max(peakRss,value.rss);return value;},monitor=setInterval(sample,20),mark=phase=>{globalThis.gc?.();memory.push({phase,...sample()});};
const start=performance.now();mark('baseline');
try{
 store=await openStorage(indexedDB,'synthetic-longform-'+crypto.randomUUID());let job=await resilienceJob(120);await store.ensureJob(job);await store.claim(owner);
 for(let i=0;i<120;i++)job=await store.commit(job.id,i,resilienceAudio(job,i,{sampleCount:48000}),'longform');mark('120-committed-parts');
 check(job.seconds===240,'Unexpected long fixture duration');const original=await store.parts(job.id),expected=await oracleEncode(original),expectedHash=await sha256Bytes(expected);mark('independent-oracle-encoded');
 class MeasuredBlob extends Blob{async arrayBuffer(){counts.blobReads++;counts.blobBytes+=this.size;return super.arrayBuffer();}}
 const counted={...store,async parts(...args){const rows=await store.parts(...args);counts.bulkReads++;counts.rows+=rows.length;return rows.map(row=>({...row,blob:new MeasuredBlob([row.blob])}));}};
 const fullStart=performance.now(),full=await recordingBlob(counted,job,null,undefined,{createWorker:createNodeExportWorker,signal:controller.signal}),fullMs=performance.now()-fullStart,fullHash=await sha256Bytes(await full.blob.arrayBuffer()),fullReads={...counts};check(fullHash===expectedHash,'Long artifact differs from independent PCM oracle');mark('full-artifact-finished');
 const output=resolve('.cache/longform-resilience.mp3');await writeFile(output,new Uint8Array(await full.blob.arrayBuffer()));const decode=spawnSync('ffmpeg',['-v','error','-i',output,'-f','null','-'],{encoding:'utf8',timeout:15000,windowsHide:true});check(!decode.error&&decode.status===0,'Long artifact FFmpeg decode failed');
 for(const key of Object.keys(counts))counts[key]=0;
 const calls=[];let background;const cache=createChapterCache({maxEntries:2,maxBytes:24*1024*1024,prepare:(snapshot,chapter,options)=>{calls.push(chapter);return recordingBlob(counted,snapshot,chapter,undefined,{...options,createWorker:createNodeExportWorker});}}),prefetch=cache.prefetch;cache.prefetch=(...args)=>{background=prefetch(...args);return background;};
 for(const chapter of [0,2,0]){const operation=await createPlaybackPreparation(counted,job,{signal:controller.signal});await operation.prepare(cache,chapter,{signal:controller.signal});await background;}
 check(calls.filter(c=>c===0).length===2,'Oldest compressed chapter was not evicted');cache.clear();mark('chapter-cache-cleared');
 const report={schema:1,kind:'Real codec/storage APIs on Node, fake-indexeddb, procedural CC0 PCM; no synthesis',sourceBuildSha256:job.settings.renderManifest.source.sha256,fixture:{passages:120,chapters:job.chapters.length,seconds:job.seconds,pcmBytes:job.bytes,sourceCharacters:job.source.length,checksumPolicy:job.settings.renderManifest.checkpointIntegrity},fullArtifact:{elapsedMs:fullMs,bytes:full.blob.size,frameParsedSeconds:mp3Duration(new Uint8Array(await full.blob.arrayBuffer())),sha256:fullHash,oracleSha256:expectedHash,identical:true,ffmpegDecode:'passed',reads:fullReads},chapterPairAndEviction:{requests:[0,2,0],encodes:calls,reads:{...counts},maxEntries:2,maxCompressedBytes:24*1024*1024},memory:{samples:memory,observedPeakRss:peakRss,samplingMs:20,forcedGcAtPhaseBoundaries:typeof globalThis.gc==='function'},elapsedMs:performance.now()-start,limits:'RSS covers this Node process and workers, excluding the separate FFmpeg process; heap/external values cover the reporting thread. Sampled peak is not an exact instantaneous peak. This measures synthetic encoding and checksum IO, not model synthesis, browser disk IO, phone limits or acoustic quality.'};
 await writeFile('evidence/longform-resilience-measurement.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{clearTimeout(deadline);clearInterval(monitor);controller.abort();await store?.release(owner).catch(()=>{});store?.close();}
