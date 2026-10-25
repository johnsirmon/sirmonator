import {makeRecording,digest} from '../src/recording.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';
import {renderMetrics} from '../src/render-metrics.js';
import {spokenPassage,parsePronunciation} from '../src/pronunciation.js';
import {quantizePcm} from '../src/continuity.js';
export async function chapterFixture(count=2000){
 const source=Array.from({length:count},(_,i)=>`Paul spoke exact passage ${String(i).padStart(4,'0')} with care.`).join('\n\n');
 const job=await makeRecording(source,{voice:'af_sarah',edition:'refined',speed:1,delivery:'natural',pipeline:FOUNDATION_PIPELINE,pronunciation:parsePronunciation('Paul => pawl')});
 if(job.passages.length!==count)throw Error('Unexpected synthetic fixture passage count');
 const parts=[],takes=new Map();job.next=count;job.sampleRate=24000;job.takeSelection={schema:1,revision:1,selected:{},history:[]};
 for(let i=0;i<count;i++){
  const p=job.passages[i],samples=Float32Array.from({length:48},(_,n)=>.1*Math.sin(n*.3+i*.1)),bytes=quantizePcm(samples),seconds=samples.length/24000,
   metrics=renderMetrics({started:0,synthesized:2,finished:3,audio:{samples,sampleRate:24000,runtime:{provider:'cpu',dtype:'q8',loadMs:0,inferenceMs:2,modelLoadAttempts:0,retries:0}},outputSeconds:seconds,format:'pcm-s16le',engine:'kokoro'}),
   part={jobId:job.id,index:i,blob:new Blob([bytes]),seconds,chapter:p.chapter,sampleRate:24000,sampleCount:samples.length,channels:1,format:'pcm-s16le',renderManifestHash:job.renderManifestHash,metrics,spokenTextHash:await digest(spokenPassage(source.slice(p.start,p.end),job.settings.pronunciation).text)};
  parts.push(part);job.seconds+=seconds;job.bytes+=part.blob.size;
  if(i%125===0){const takeId='synthetic-'+i,takeSamples=Float32Array.from({length:72},(_,n)=>.07*Math.sin(n*.2+i*.1)),takeBytes=quantizePcm(takeSamples),takeSeconds=72/24000,
   take={...part,takeId,blob:new Blob([takeBytes]),sampleCount:72,seconds:takeSeconds,metrics:{...metrics,outputAudioSeconds:takeSeconds},start:p.start,end:p.end,sourceSliceHash:await digest(source.slice(p.start,p.end)),audioHash:await crypto.subtle.digest('SHA-256',takeBytes).then(b=>[...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,'0')).join('')),executedBuildSourceSha:job.settings.renderManifest.source.sha256};takes.set(takeId,take);job.takeSelection.selected[i]=takeId;}
 }
 const reads={job:0,parts:0,partRows:0,take:0};
 const store={async job(){reads.job++;return structuredClone(job);},async parts(id,n){reads.parts++;reads.partRows+=Math.min(n,parts.length);return structuredClone(parts.slice(0,n));},async take(id,index,takeId){reads.take++;return structuredClone(takes.get(takeId));}};
 return {job,parts,takes,store,reads,reset(){for(const key of Object.keys(reads))reads[key]=0;}};
}
