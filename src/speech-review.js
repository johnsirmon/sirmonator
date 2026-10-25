import {spokenPassage} from './pronunciation.js';
import {digest} from './recording.js';
import {validateCheckpoint} from './job-runner.js';
import {takeRevision,selectedTake} from './take-selection.js';
import {assertActive,abortable} from './continuity.js';
import {sha256Bytes} from './asset-integrity.js';
export const REVIEW_VERSION='manual-transcript-alignment-v1',MAX_TRANSCRIPT=4000,MAX_REVIEW_TOKENS=512;
export function reviewTokens(text,offset=0){
 return [...text.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu)].map(m=>({text:m[0],key:m[0].normalize('NFC').toLowerCase().replaceAll('’','').replaceAll("'",''),start:offset+m.index,end:offset+m.index+m[0].length}));
}
export function validateTranscriptInput(transcript,{noWordsHeard=false,allowEmpty=false}={}){
 if(typeof transcript!=='string'||transcript.length>MAX_TRANSCRIPT||!transcript.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(transcript))throw Error('Supply a well-formed transcript of at most 4,000 characters without control characters.');
 if(noWordsHeard&&transcript.trim())throw Error('Clear the transcript before marking no words heard.');
 if(!transcript.trim()&&!noWordsHeard&&!allowEmpty)throw Error('Paste the words you heard, or explicitly mark no words heard.');
 const tokens=reviewTokens(transcript);if(tokens.length>MAX_REVIEW_TOKENS)throw Error('This comparison exceeds the 512-token limit. Use only the selected passage transcript.');
 if(transcript.trim()&&!tokens.length&&!allowEmpty)throw Error('The transcript has no comparable words. Use no words heard only when that is your observation.');return tokens;
}
function expectedUnits(source,pronunciation){
 const spoken=spokenPassage(source,pronunciation),units=[];let through=0;
 const plain=(text,offset)=>{for(const t of reviewTokens(text,offset))units.push({start:t.start,end:t.end,source:t.text,spoken:t.text,alternatives:[[t.key]]});};
 for(const match of spoken.matches){
  plain(source.slice(through,match.start),through);
  const original=reviewTokens(source.slice(match.start,match.end)).map(t=>t.key),alias=reviewTokens(match.to).map(t=>t.key),alternatives=[alias];
  if(original.length&&JSON.stringify(original)!==JSON.stringify(alias))alternatives.push(original);
  if(original.length||alias.length)units.push({start:match.start,end:match.end,source:source.slice(match.start,match.end),spoken:match.to,alternatives});
  through=match.end;
 }
 plain(source.slice(through),through);return {spoken:spoken.text,units};
}
export async function captureReview(store,id,index,{signal}={}){
 assertActive({signal});const job=await abortable(store.job(id),signal);assertActive({signal});
 if(!job||!Number.isInteger(index)||index<0||index>=job.next)throw Error('Choose a saved audio passage.');
 const parts=await abortable(validateCheckpoint(store,job),signal);assertActive({signal});const p=job.passages[index],part=parts[index],source=job.source.slice(p.start,p.end),spoken=spokenPassage(source,job.settings.pronunciation).text;
 const audio=await abortable(part.blob.arrayBuffer(),signal);assertActive({signal});
 const anchor={schema:1,recordingId:id,sourceHash:job.sourceHash,passage:index,start:p.start,end:p.end,chapter:p.chapter,takeId:selectedTake(job,index),selectionRevision:takeRevision(job),renderManifestHash:job.renderManifestHash??null,sourceSliceHash:await abortable(digest(source),signal),spokenTextHash:await abortable(digest(spoken),signal),audioHash:await abortable(sha256Bytes(audio),signal),format:part.format??'mp3',sampleRate:part.sampleRate??job.sampleRate,bytes:part.blob.size};
 const key=await abortable(digest(JSON.stringify(anchor)),signal);assertActive({signal});
 return {schema:1,key,anchor,title:job.title,source,spoken,pronunciation:job.settings.pronunciation??null,chapterOffsetSeconds:parts.slice(0,index).reduce((n,part,i)=>n+(job.passages[i].chapter===p.chapter?part.seconds:0),0)};
}
export function reviewSelectionMatches(job,snapshot){return !!job&&job.id===snapshot?.anchor.recordingId&&job.sourceHash===snapshot.anchor.sourceHash&&takeRevision(job)===snapshot.anchor.selectionRevision&&selectedTake(job,snapshot.anchor.passage)===snapshot.anchor.takeId&&snapshot.anchor.passage<job.next;}
// Bounded variant-aware edit alignment. Text-only evidence: no audio is decoded,
// transcribed or judged here. Yield between rows so cancellation remains usable.
export async function compareTranscript(snapshot,transcript,{noWordsHeard=false,signal,yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
 assertActive({signal});
 const observed=validateTranscriptInput(transcript,{noWordsHeard}),{units,spoken}=expectedUnits(snapshot.source,snapshot.pronunciation);
 if(spoken!==snapshot.spoken)throw Error('Review snapshot spoken text changed. Load the current passage again.');
 if(units.length>MAX_REVIEW_TOKENS||observed.length>MAX_REVIEW_TOKENS)throw Error('This comparison exceeds the 512-token limit. Use only the selected passage transcript.');
 const width=observed.length+1,size=(units.length+1)*width,cost=new Uint16Array(size),op=new Uint8Array(size),length=new Uint16Array(size);
 for(let j=1;j<width;j++){cost[j]=j*2;op[j]=4;length[j]=1;}
 for(let i=1;i<=units.length;i++){
  if(i%16===0){await yieldTask();assertActive({signal});}
  const unit=units[i-1],lengths=[...new Set([1,...unit.alternatives.map(a=>a.length)])].filter(n=>n>0);
  for(let j=0;j<width;j++){
   const cell=i*width+j;let best=65535,kind=0,consumed=0;
   const choose=(value,type,n)=>{if(value<best){best=value;kind=type;consumed=n;}};
   for(const variant of unit.alternatives)if(j>=variant.length&&variant.every((key,k)=>key===observed[j-variant.length+k].key))choose(cost[(i-1)*width+j-variant.length],1,variant.length);
   for(const n of lengths)if(j>=n)choose(cost[(i-1)*width+j-n]+2,2,n);
   choose(cost[(i-1)*width+j]+2,3,0);
   if(j)choose(cost[cell-1]+2,4,1);
   cost[cell]=best;op[cell]=kind;length[cell]=consumed;
  }
 }
 assertActive({signal});const steps=[];let i=units.length,j=observed.length;
 while(i||j){const cell=i*width+j,kind=op[cell],n=length[cell];if(!kind)throw Error('Transcript alignment failed.');steps.push({kind,unit:kind===4?i:i-1,from:j-n,to:j});if(kind!==4)i--;j-=n;}
 steps.reverse();const findings=[];
 for(let k=0;k<steps.length;k++){
  const step=steps[k];if(step.kind===1)continue;
  if(step.kind===4){let end=k;while(end+1<steps.length&&steps[end+1].kind===4)end++;
   const from=step.from,to=steps[end].to,keys=observed.slice(from,to).map(t=>t.key),same=position=>position>=0&&position+keys.length<=observed.length&&keys.every((key,n)=>observed[position+n].key===key),repeated=same(from-keys.length)||same(to)||(keys.length>1&&keys.every(key=>key===keys[0])&&((observed[from-1]?.key===keys[0])||(observed[to]?.key===keys[0])));
   const offset=units[step.unit]?.start??units.at(-1)?.end??0;
   findings.push({kind:repeated?'possible-repetition':'possible-extra',sourceStart:snapshot.anchor.start+offset,sourceEnd:snapshot.anchor.start+offset,expected:'',observed:observed.slice(from,to).map(t=>t.text).join(' '),transcriptStart:observed[from].start,transcriptEnd:observed[to-1].end});k=end;continue;
  }
  const unit=units[step.unit];findings.push({kind:step.kind===3?'possible-omission':'possible-substitution',sourceStart:snapshot.anchor.start+unit.start,sourceEnd:snapshot.anchor.start+unit.end,expected:unit.source,spoken:unit.spoken,observed:observed.slice(step.from,step.to).map(t=>t.text).join(' '),transcriptStart:observed[step.from]?.start??transcript.length,transcriptEnd:observed[step.to-1]?.end??observed[step.from]?.start??transcript.length});
 }
 const summary={};for(const finding of findings)summary[finding.kind]=(summary[finding.kind]??0)+1;
 return {schema:1,method:REVIEW_VERSION,snapshotKey:snapshot.key,anchor:snapshot.anchor,automaticTranscription:false,audioVerified:false,transcript,noWordsHeard,expectedUnits:units.length,transcriptTokens:observed.length,summary,candidateCount:findings.length,findings:findings.slice(0,128),truncated:findings.length>128,limitations:'User-supplied transcript text only. Candidates can reflect transcription differences, number/abbreviation rendering or alignment ambiguity. Punctuation/case and frozen source-or-alias spelling variants are accepted. No acoustic verification, word timestamps, pronunciation score or automatic correction.'};
}
