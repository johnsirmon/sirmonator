import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {Mp3Encoder} from '@breezystack/lamejs';
import {encodeMp3} from '../src/mp3.js';
import {quantizePcm,encodePcmParts} from '../src/continuity.js';
import {createNodeExportWorker} from './export-node.mjs';
import {decodePcmWav} from '../src/pcm.js';
const decode=bytes=>{const p=spawnSync('ffmpeg',['-v','error','-f','mp3','-i','pipe:0','-f','f32le','pipe:1'],{input:bytes,maxBuffer:32e6,windowsHide:true});if(p.status!==0)throw Error(p.stderr.toString());return p.stdout.length/4;};
async function measure(pcm,rate,label){
 const started=performance.now(),before=Buffer.concat(pcm.map(p=>encodeMp3(p,rate,Mp3Encoder))),beforeMs=performance.now()-started;
 const stageStart=performance.now();const parts=pcm.map(p=>({sampleRate:rate,sampleCount:p.length,channels:1,format:'pcm-s16le',blob:new Blob([quantizePcm(p)])}));const stagingMs=performance.now()-stageStart;
 const exportStart=performance.now(),after=Buffer.from(await (await encodePcmParts(parts,rate,{createWorker:createNodeExportWorker})).arrayBuffer()),afterMs=performance.now()-exportStart;
 const samples=pcm.reduce((n,p)=>n+p.length,0),beforeDecoded=decode(before),afterDecoded=decode(after);
 if(label==='cached-real-speech'){await writeFile('.cache/continuity/before.mp3',before);await writeFile('.cache/continuity/after.mp3',after);}
 return {label,rate,passages:pcm.length,samples,before:{bytes:before.length,encodeMs:beforeMs,decodedSamples:beforeDecoded,paddingMs:(beforeDecoded-samples)/rate*1000},after:{bytes:after.length,stagingMs,exportMs:afterMs,decodedSamples:afterDecoded,paddingMs:(afterDecoded-samples)/rate*1000},checkpointBytes:parts.reduce((n,p)=>n+p.blob.size,0),largestPassageBytes:Math.max(...parts.map(p=>p.blob.size)),caveat:'Cold export worker startup included only in after. One run is not a statistical speed comparison; before encoding runs on main Node thread.'};
}
await mkdir('.cache/continuity',{recursive:true});const report={kind:'Deterministic same-PCM split encoders versus production single-encoder worker',matrix:[],real:null};
for(const rate of [22050,24000,44100,48000])for(const count of [1,10,100]){
 const pcm=Array.from({length:count},(_,part)=>Float32Array.from({length:Math.round(rate*.125)},(_,i)=>.2*Math.sin(2*Math.PI*(220+part%3*110)*i/rate)));
 report.matrix.push(await measure(pcm,rate,'synthetic-tone'));console.log(JSON.stringify(report.matrix.at(-1)));
}
// Reuse locally rendered synthetic Kokoro speech, never load another model.
try{const metadata=JSON.parse(await readFile('.cache/continuity/report.json','utf8')),data=await readFile('.cache/continuity/before.wav'),wav=decodePcmWav(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));let offset=0;
 const pcm=metadata.passages.map(p=>{const length=p.samples+Math.round(p.pauseSeconds*wav.sampleRate),part=wav.samples.slice(offset,offset+length);offset+=length;return part;});
 report.real=await measure(pcm,wav.sampleRate,'cached-real-speech');report.real.originalRenderMs=metadata.passages.reduce((n,p)=>n+p.renderMs,0);report.real.intentionalPauseSeconds=metadata.passages.reduce((n,p)=>n+p.pauseSeconds,0);report.real.sourceExact=metadata.sourceExact;
}catch(error){report.real={unavailable:error.message};}
await writeFile('.cache/continuity/comparison.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.real));
