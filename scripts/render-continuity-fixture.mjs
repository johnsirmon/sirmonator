// Reproducible synthetic speech fixture; existing local weights only, no downloads.
import {KokoroTTS} from 'kokoro-js';
import {env} from '@huggingface/transformers';
import {writeFile,mkdir} from 'node:fs/promises';
import {chunkText,encodeWav} from '../src/core.js';
import {pauseAfter} from '../src/audio-effects.js';
env.allowRemoteModels=false;
const text='This synthetic reading checks the boundary between passages. Keep every word in its original order.\n\nA second paragraph should retain its deliberate pause. Numbers one, two, and three remain unchanged.\n\nThe final sentence ends here.';
const chunks=chunkText(text),parts=[],report={text,sourceExact:chunks.join('')===text,passages:[],provenance:'Authored synthetic text; af_sarah Kokoro preset. No human reference recording.'};
const tts=await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{dtype:'q8',device:'cpu'});
try{for(let i=0;i<chunks.length;i++){
 const started=performance.now(),audio=await tts.generate(chunks[i],{voice:'af_sarah',speed:1}),pauseSeconds=i===chunks.length-1?0:pauseAfter(chunks[i]);
 const padded=new Float32Array(audio.audio.length+Math.round(pauseSeconds*audio.sampling_rate));padded.set(audio.audio);parts.push(padded);
 report.passages.push({text:chunks[i],samples:audio.audio.length,pauseSeconds,renderMs:performance.now()-started});
}}finally{await tts.model.dispose();}
await mkdir('.cache/continuity',{recursive:true});await writeFile('.cache/continuity/before.wav',new Uint8Array(encodeWav(parts,24000)));await writeFile('.cache/continuity/report.json',JSON.stringify(report,null,2));
