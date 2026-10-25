// Procedural CC0 PCM. Only metadata is retained; every read generates one part.
import {check} from './resilience-scenario.mjs';
import {makeRecording,digest} from '../src/recording.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';
import {spokenPassage,parsePronunciation} from '../src/pronunciation.js';
import {renderMetrics} from '../src/render-metrics.js';
import {sha256Bytes} from '../src/asset-integrity.js';
import {changeSelection} from '../src/take-selection.js';

export function proceduralPcm(sampleCount){
 const bytes=new ArrayBuffer(sampleCount*2),view=new DataView(bytes);
 for(let i=0;i<sampleCount;i++)view.setInt16(i*2,i%4800>4320?0:Math.round(3200*Math.sin(i*.03125)),true);
 return bytes;
}
export async function lazyHourFixture(seconds){
 check(Number.isSafeInteger(seconds)&&seconds>=4&&seconds<=3600&&seconds%2===0,'Invalid fixture duration');
 const count=seconds/2,source=Array.from({length:count},(_,i)=>`Paul reads exact passage ${String(i).padStart(4,'0')}; café stays unchanged.`).join('\n\n'),job=await makeRecording(source,{voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE,pronunciation:parsePronunciation('Paul => pawl')},'SYNTHETIC hour export fixture'),reads={parts:0,rows:0,job:0,take:0,blobReads:0,blobBytes:0,maxReadBytes:0,corruptedReads:0};
 check(job.passages.length===count,'Unexpected lazy fixture splitting');
 const sampleCount=48000,hash=await sha256Bytes(proceduralPcm(sampleCount)),takeSamples=50400,takeHash=await sha256Bytes(proceduralPcm(takeSamples));let corruptIndex=-1;
 class LazyPcm extends Blob{
  constructor(index,samples=sampleCount){super([]);this.index=index;this.samples=samples;}
  get size(){return this.samples*2;}
  async arrayBuffer(){reads.blobReads++;reads.blobBytes+=this.size;reads.maxReadBytes=Math.max(reads.maxReadBytes,this.size);const bytes=proceduralPcm(this.samples);if(this.index===corruptIndex){new Uint8Array(bytes)[0]^=1;reads.corruptedReads++;}return bytes;}
 }
 const metrics=n=>renderMetrics({started:0,synthesized:0,finished:0,audio:{samples:{length:n},sampleRate:24000,runtime:{provider:'none',dtype:'procedural-cc0',loadMs:0,inferenceMs:0,modelLoadAttempts:0,retries:0}},outputSeconds:n/24000,format:'pcm-s16le',engine:'kokoro'});
 const parts=[];job.next=count;job.sampleRate=24000;job.seconds=seconds;job.bytes=count*sampleCount*2;
 for(let index=0;index<count;index++){const p=job.passages[index];parts.push({jobId:job.id,index,blob:new LazyPcm(index),seconds:2,chapter:p.chapter,sampleRate:24000,sampleCount,channels:1,format:'pcm-s16le',renderManifestHash:job.renderManifestHash,metrics:metrics(sampleCount),audioHash:hash,spokenTextHash:await digest(spokenPassage(job.source.slice(p.start,p.end),job.settings.pronunciation).text)});}
 const middle=Math.floor(count/2),p=job.passages[middle],take={...parts[middle],takeId:'procedural-middle',blob:new LazyPcm(-2,takeSamples),sampleCount:takeSamples,seconds:takeSamples/24000,metrics:metrics(takeSamples),audioHash:takeHash,start:p.start,end:p.end,sourceSliceHash:await digest(job.source.slice(p.start,p.end)),executedBuildSourceSha:job.settings.renderManifest.source.sha256};
 const store={async job(){reads.job++;return structuredClone(job);},async parts(id,n=count){reads.parts++;reads.rows+=Math.min(n,count);return parts.slice(0,n);},async take(id,index,takeId){reads.take++;return index===middle&&takeId===take.takeId?take:undefined;}};
 return {job,store,parts,take,middle,reads,corrupt(index){corruptIndex=index;},select(){changeSelection(job,middle,take.takeId);},undo(){changeSelection(job,middle,'original',{undo:true});},reset(){for(const key of Object.keys(reads))reads[key]=0;}};
}
