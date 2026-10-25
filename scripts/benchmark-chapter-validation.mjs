// Reproducible before/after source benchmark, synthetic PCM only; no model calls.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chapterFixture} from './chapter-benchmark-fixture.mjs';
import {createPlaybackPreparation,recordingBlob} from '../src/job-runner.js';
import {createChapterCache} from '../src/chapter-cache.js';
import {createNodeExportWorker} from './export-node.mjs';
const baseline='cbb8bd128edf1fcc619add6fbcb80d3aa161e165',root=fileURLToPath(new URL('../',import.meta.url));
const before=execFileSync('git',['-c','core.fsmonitor=false','show',baseline+':src/job-runner.js'],{encoding:'utf8',cwd:root}).replaceAll("from './","from '../src/").replace("from '../src/take-selection.js'","from './chapter-before-takes.mjs'");
const beforeTakes=execFileSync('git',['-c','core.fsmonitor=false','show',baseline+':src/take-selection.js'],{encoding:'utf8',cwd:root}).replaceAll("from './","from '../src/");
await mkdir('.cache',{recursive:true});await writeFile('.cache/chapter-before.mjs',before);await writeFile('.cache/chapter-before-takes.mjs',beforeTakes);
const old=await import(pathToFileURL(resolve('.cache/chapter-before.mjs')).href),fixture=await chapterFixture(),runs=[];
const artifact=async value=>({sha256:createHash('sha256').update(new Uint8Array(await value.blob.arrayBuffer())).digest('hex'),seconds:value.seconds,bytes:value.blob.size,takeRevision:value.takeRevision});
for(const mode of ['before','after','before','after','before','after']){
 fixture.reset();const started=performance.now();let current,next;
 if(mode==='before'){
  await old.validateCheckpoint(fixture.store,await fixture.store.job());const job=await fixture.store.job();await old.validateCheckpoint(fixture.store,job);
  current=await old.recordingBlob(fixture.store,job,0,undefined,{createWorker:createNodeExportWorker});
  next=await old.recordingBlob(fixture.store,job,1,undefined,{createWorker:createNodeExportWorker});
 }else{
  let prefetched;const cache=createChapterCache({prepare:(job,chapter,options)=>recordingBlob(fixture.store,job,chapter,undefined,{...options,createWorker:createNodeExportWorker})}),prefetch=cache.prefetch;
  cache.prefetch=(...args)=>{prefetched=prefetch(...args);return prefetched;};
  const operation=await createPlaybackPreparation(fixture.store,await fixture.store.job());current=await operation.prepare(cache,0);next=await prefetched;cache.clear();
 }
 runs.push({mode,elapsedMs:performance.now()-started,reads:{...fixture.reads},current:await artifact(current),next:await artifact(next)});
}
const reference=JSON.stringify([runs[0].current,runs[0].next]);if(runs.some(run=>JSON.stringify([run.current,run.next])!==reference))throw Error('Before/after artifact integrity mismatch');
const median=mode=>runs.filter(r=>r.mode===mode).map(r=>r.elapsedMs).sort((a,b)=>a-b)[1];
const report={schema:1,baseline,fixture:{passages:fixture.job.next,chapters:fixture.job.chapters.length,sourceCharacters:fixture.job.source.length,pronunciation:true,selectedTakes:fixture.takes.size,pcmBytes:fixture.job.bytes},scope:'Current chapter and next-chapter preparation after open; real Node MP3 workers, synthetic short PCM, in-memory instrumented store returning structured-cloned IDB-shaped metadata.',runs,summary:{order:'before,after repeated three times',beforeMedianMs:median('before'),afterMedianMs:median('after')},identicalOutputs:true,limitations:'Read counts measure application calls/rows, not disk IO. Timings include actual encoding/worker startup but not browser IndexedDB or real speech inference. Synthetic tiny PCM is not a phone or whole-sermon audio benchmark.'};
await writeFile('evidence/chapter-validation-benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
