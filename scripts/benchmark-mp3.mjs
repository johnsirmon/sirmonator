// Manual stress test: synthetic audio exercises long export, not long TTS accuracy.
import {Mp3Encoder} from '@breezystack/lamejs';
import {mkdir,open,writeFile} from 'node:fs/promises';
import {encodeMp3,mp3Duration} from '../src/mp3.js';
const minutes=Number(process.argv[2]??120),rate=24000,secondsPerPart=10;
if(!Number.isFinite(minutes)||minutes<=0||minutes>240)throw Error('Choose 1–240 minutes.');
await mkdir('.cache',{recursive:true});const file=await open('.cache/mp3-stress.mp3','w');
let bytes=0,duration=0,peakRSS=0;const start=performance.now();
try{for(let i=0;i<minutes*60/secondsPerPart;i++){
 const samples=Float32Array.from({length:rate*secondsPerPart},(_,n)=>.18*Math.sin(2*Math.PI*(i%2?440:220)*n/rate));
 const part=encodeMp3(samples,rate,Mp3Encoder);await file.write(part);bytes+=part.length;duration+=mp3Duration(part);peakRSS=Math.max(peakRSS,process.memoryUsage().rss);
 if(i%60===0)console.log(JSON.stringify({minutesEncoded:Math.round(i/6),rssMB:Math.round(process.memoryUsage().rss/1048576)}));
}}finally{await file.close();}
const report={kind:'synthetic PCM / encoder stress, not speech or physical phone validation',inputMinutes:minutes,outputSeconds:duration,bytes,elapsedSeconds:(performance.now()-start)/1000,peakRSSMB:peakRSS/1048576};
await writeFile('.cache/mp3-stress-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
