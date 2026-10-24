import 'fake-indexeddb/auto';
import {performance} from 'node:perf_hooks';
import {writeFile,mkdir} from 'node:fs/promises';
import {Mp3Encoder} from '@breezystack/lamejs';
import {openStorage} from '../src/storage.js';
import {makeRecording} from '../src/recording.js';
import {recordingBlob} from '../src/job-runner.js';
import {encodeMp3,mp3Duration} from '../src/mp3.js';
const text='Synthetic paragraph 0001. Keep every character, including numbers 123.\n\n'.repeat(2000);
const settings={voice:'af_heart',edition:'refined',delivery:'natural',speed:1};
const report={kind:'Node CPU synthetic PCM and fake-indexeddb checkpoint benchmark; not browser storage or TTS',sourceCharacters:text.length,runs:[]};
const samples=Float32Array.from({length:48000},(_,i)=>.18*Math.sin(2*Math.PI*440*i/24000));
let encoded;
for(const phase of ['first-call','warm']){const start=performance.now();encoded=encodeMp3(samples,24000,Mp3Encoder);report.runs.push({stage:'encode-2s-tone',phase,ms:performance.now()-start,bytes:encoded.length});}
const start=performance.now(),job=await makeRecording(text,settings);report.partitionMs=performance.now()-start;report.passages=job.passages.length;
const store=await openStorage(indexedDB,'benchmark-'+crypto.randomUUID());await store.ensureJob(job);await store.claim('benchmark');
for(let i=0;i<job.passages.length;i++){await store.claim('benchmark');await store.commit(job.id,i,{bytes:encoded,seconds:mp3Duration(encoded),sampleRate:24000},'benchmark');}
const ready=await store.job(job.id);
for(const phase of ['first-call','warm']){let reads=0;const measured={...store,part:async(...args)=>{reads++;return store.part(...args);},...(store.parts?{parts:async(...args)=>{reads++;return store.parts(...args);}}:{})};const start=performance.now();const output=await recordingBlob(measured,ready);report.runs.push({stage:'validate-and-export',phase,ms:performance.now()-start,reads,bytes:output.blob.size,seconds:output.seconds});}
report.rssMB=process.memoryUsage().rss/1048576;store.close();console.log(JSON.stringify(report,null,2));await mkdir('.cache',{recursive:true});await writeFile('.cache/'+(process.argv[2]??'checkpoint-benchmark')+'.json',JSON.stringify(report,null,2));
