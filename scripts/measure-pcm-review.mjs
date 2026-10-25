// Reuse only the known short synthetic Kokoro fixture; no inference/download.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {encodePcmParts} from '../src/continuity.js';
import {inspectMp3} from '../src/mp3.js';
import {createNodeExportWorker} from './export-node.mjs';
import {createNodeReviewExportWorker} from './review-export-node.mjs';

const directory=resolve(process.argv[2]??'.cache/pcm-review-fixture'),metadata=JSON.parse(await readFile(resolve(directory,'report.json'),'utf8'));
const expected='This synthetic reading checks the boundary between passages. Keep every word in its original order.\n\nA second paragraph should retain its deliberate pause. Numbers one, two, and three remain unchanged.\n\nThe final sentence ends here.';
if(metadata.text!==expected||metadata.sourceExact!==true)throw Error('Not the approved authored synthetic fixture.');
const path=resolve(directory,'before.wav');if((await stat(path)).size>2*1024*1024)throw Error('Fixture exceeds this bounded experiment.');
const wav=await readFile(path),view=new DataView(wav.buffer,wav.byteOffset,wav.byteLength),sampleRate=view.getUint32(24,true);
if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE'||wav.toString('ascii',36,40)!=='data'||view.getUint16(20,true)!==1||view.getUint16(22,true)!==1||view.getUint16(34,true)!==16||view.getUint32(40,true)!==wav.length-44||sampleRate!==24000)throw Error('Unexpected fixture WAV layout.');
let offset=44;const parts=metadata.passages.map(p=>{const sampleCount=p.samples+Math.round(p.pauseSeconds*sampleRate),end=offset+sampleCount*2;if(end>wav.length)throw Error('Fixture routing exceeds WAV');const bytes=wav.buffer.slice(wav.byteOffset+offset,wav.byteOffset+end);offset=end;return {format:'pcm-s16le',channels:1,sampleRate,sampleCount,blob:new Blob([bytes])};});if(offset!==wav.length)throw Error('Fixture routing leaves samples unaccounted for.');
const outputs=[];for(const createWorker of [createNodeExportWorker,createNodeReviewExportWorker]){let metrics;const blob=await encodePcmParts(parts,sampleRate,{createWorker,onMetrics:value=>metrics=value});outputs.push({bytes:Buffer.from(await blob.arrayBuffer()),metrics});}
if(!outputs[0].bytes.equals(outputs[1].bytes))throw Error('Optional PCM review changed MP3 bytes.');
const decoded=spawnSync('ffmpeg',['-v','error','-f','mp3','-i','pipe:0','-f','null','-'],{input:outputs[1].bytes,timeout:15000,windowsHide:true});if(decoded.status!==0)throw Error('Fixture MP3 decode unavailable or failed: '+decoded.stderr?.toString());
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),report={schema:1,kind:'Offline re-encode of previously rendered authored synthetic Kokoro PCM; no new inference or audio playback',fixtureWavSha256:sha(wav),sourceTextSha256:sha(expected),passages:parts.length,intentionalPauseSeconds:metadata.passages.reduce((n,p)=>n+p.pauseSeconds,0),inputSamples:parts.reduce((n,p)=>n+p.sampleCount,0),byteIdentical:true,mp3Sha256:sha(outputs[1].bytes),mp3:inspectMp3(outputs[1].bytes),decoderExit:decoded.status,diagnostics:outputs[1].metrics.pcmReview,limits:'Stats describe quantized checkpoint PCM including intentional pauses, not speech transcription, prequantization nonfinite values, or listening quality.'};
await mkdir('evidence',{recursive:true});await writeFile('evidence/pcm-review-synthetic.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
