// One bounded child process per duration. No PCM database or temporary audio file.
import {writeFile} from 'node:fs/promises';
import {lazyHourFixture} from './lazy-hour-fixture.mjs';
import {recordingBlob,validateCheckpoint} from '../src/job-runner.js';
import {createNodeExportWorker} from './export-node.mjs';
import {sha256Bytes} from '../src/asset-integrity.js';
import {mp3Duration} from '../src/mp3.js';
import {check} from './resilience-scenario.mjs';

const minutes=Number(process.argv[2]);check([5,15,60].includes(minutes),'Use 5, 15 or 60 minutes');
const rssLimit=640*1024*1024,artifactLimit=40*1024*1024,controller=new AbortController();let peakRss=0,reason=null,fixture;
const started=performance.now(),samples=[],sample=()=>{const m=process.memoryUsage();peakRss=Math.max(peakRss,m.rss);if(m.rss>rssLimit){reason='640 MiB sampled RSS cap';controller.abort();}return m;},monitor=setInterval(sample,25),deadline=setTimeout(()=>{reason='150 second run budget';controller.abort();},150000);
const mark=phase=>{globalThis.gc?.();samples.push({phase,...sample()});};
let report={schema:1,minutes,kind:'Lazy procedural CC0 PCM metadata store; production validation and Node MP3 worker, no database/model/speech',caps:{rssBytes:rssLimit,artifactBytes:artifactLimit,runMs:150000},limits:'RSS sampled every 25 ms includes Node workers, may miss instantaneous peaks and cannot impose a hard OS limit. Synthetic lazy reads are not browser disk throughput. Only one part materializes per read; this is not a constant total memory guarantee.'};
try{
 mark('baseline');fixture=await lazyHourFixture(minutes*60);mark('metadata-ready');
 const integrity=[];
 for(const index of [0,Math.floor(fixture.parts.length/2),fixture.parts.length-1]){fixture.corrupt(index);fixture.reset();const before=performance.now();let rejected=false;try{await validateCheckpoint(fixture.store,fixture.job,{signal:controller.signal});}catch(error){if(error.name==='AbortError')throw error;check(/integrity/.test(error.message),'Unexpected corruption failure');rejected=true;}check(rejected,'Corrupt PCM accepted');integrity.push({index,rejected,elapsedMs:performance.now()-before,reads:{...fixture.reads}});}
 fixture.corrupt(-1);fixture.reset();const begin=performance.now();let artifact=await recordingBlob(fixture.store,fixture.job,null,artifactLimit,{signal:controller.signal,createWorker:createNodeExportWorker});const fullMs=performance.now()-begin,fullReads={...fixture.reads};mark('full-artifact');
 const bytes=new Uint8Array(await artifact.blob.arrayBuffer()),full={elapsedMs:fullMs,seconds:artifact.seconds,bytes:bytes.length,frameParsedSeconds:mp3Duration(bytes),sha256:await sha256Bytes(bytes),reads:fullReads};check(artifact.seconds===minutes*60,'Full duration changed');check(Math.abs(full.frameParsedSeconds-artifact.seconds)<.1,'Unexpected MP3 frame duration');artifact=null;
 // Reuse only a small chapter for selection/undo checks; avoid triple hour encodes.
 const chapter=fixture.job.passages[fixture.middle].chapter;fixture.reset();const original=await recordingBlob(fixture.store,fixture.job,chapter,artifactLimit,{signal:controller.signal,createWorker:createNodeExportWorker}),originalHash=await sha256Bytes(await original.blob.arrayBuffer());
 fixture.select();const selected=await recordingBlob(fixture.store,fixture.job,chapter,artifactLimit,{signal:controller.signal,createWorker:createNodeExportWorker}),selectedHash=await sha256Bytes(await selected.blob.arrayBuffer());check(Math.abs(selected.seconds-original.seconds-.1)<1e-7&&selectedHash!==originalHash,'Selected take not exported');
 fixture.undo();const undone=await recordingBlob(fixture.store,fixture.job,chapter,artifactLimit,{signal:controller.signal,createWorker:createNodeExportWorker}),undoHash=await sha256Bytes(await undone.blob.arrayBuffer());check(undoHash===originalHash&&undone.seconds===original.seconds,'Undo did not restore exact chapter artifact');mark('take-undo-finished');
 report={...report,passed:true,sourceBuildSha256:fixture.job.settings.renderManifest.source.sha256,fixture:{passages:fixture.parts.length,seconds:fixture.job.seconds,logicalPcmBytes:fixture.job.bytes,retainedPcmBytes:0,partBytes:96000},integrity,full,takeUndo:{chapter,originalSeconds:original.seconds,selectedSeconds:selected.seconds,originalHash,selectedHash,undoHash,revision:fixture.job.takeSelection.revision,reads:{...fixture.reads}}};
}catch(error){report={...report,passed:false,stoppedBecause:reason??error.message,errorName:error.name};process.exitCode=1;}
finally{clearInterval(monitor);clearTimeout(deadline);controller.abort();report.memory={peakRss,samplingMs:25,samples};report.totalMs=performance.now()-started;await writeFile(`evidence/hour-export-${minutes}m.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
