// Codec/output integrity check; no speech model, voice sample or download.
import {writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {encodePcmParts,MP3_REQUEST_TIMEOUT_MS} from '../src/continuity.js';
import {validateCheckpoint} from '../src/job-runner.js';
import {chapterFixture} from './chapter-benchmark-fixture.mjs';
import {createNodeExportWorker} from './export-node.mjs';
import {mp3Duration} from '../src/mp3.js';
const baseline='6dd60494d487ce24d79cfcc273e5d750415eff3d',source=execFileSync('git',['-c','core.fsmonitor=false','show',baseline+':src/continuity.js'],{encoding:'utf8'});
await mkdir('.cache',{recursive:true});await writeFile('.cache/mp3-before.mjs',source);const old=await import(pathToFileURL(resolve('.cache/mp3-before.mjs')).href);
const fixture=await chapterFixture(160),before=JSON.stringify(fixture.job),parts=await validateCheckpoint(fixture.store,fixture.job),hash=async blob=>createHash('sha256').update(new Uint8Array(await blob.arrayBuffer())).digest('hex');
const original=await old.encodePcmParts(parts,24000,{createWorker:createNodeExportWorker});let failure,terminated=0;
try{await encodePcmParts(parts,24000,{createWorker:()=>({terminate(){terminated++;},postMessage(){queueMicrotask(()=>this.onmessageerror({}));}})});throw Error('Expected injected message failure');}catch(error){if(!error.message.includes('response could not be read'))throw error;failure=error.message;}
const progress=[],retry=await encodePcmParts(parts,24000,{createWorker:createNodeExportWorker,onProgress:p=>progress.push(p)}),beforeHash=await hash(original),afterHash=await hash(retry);
const beforeMp3Seconds=mp3Duration(new Uint8Array(await original.arrayBuffer())),afterMp3Seconds=mp3Duration(new Uint8Array(await retry.arrayBuffer()));
if(beforeHash!==afterHash||beforeMp3Seconds!==afterMp3Seconds||before!==JSON.stringify(fixture.job)||terminated!==1)throw Error('Retry integrity check failed');
const report={schema:1,baseline,kind:'Actual Node MP3 worker before/after and failed-attempt retry; synthetic CC0 PCM only',source:'scripts/chapter-benchmark-fixture.mjs',newModelsOrCodecs:false,personalVoiceUsed:false,parts:parts.length,selectedTakes:fixture.takes.size,inputSamples:parts.reduce((n,p)=>n+p.sampleCount,0),seconds:parts.reduce((n,p)=>n+p.seconds,0),mp3Bytes:retry.size,beforeMp3Seconds,afterMp3Seconds,beforeHash,afterHash,identical:true,selectedJobUnchanged:true,injectedFailure:failure,failedWorkerTerminationCalls:terminated,requestTimeoutMs:MP3_REQUEST_TIMEOUT_MS,progress,limitations:'Bit identity, frame-parsed MP3 duration and input duration accounting do not establish speech accuracy, acoustic quality or browser/phone performance. Watchdog expiration is tested with fake timers, not a real three-minute wait.'};
await writeFile('evidence/mp3-preparation-recovery.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
