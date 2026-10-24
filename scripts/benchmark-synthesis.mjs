import {KokoroTTS} from 'kokoro-js';
import {performance} from 'node:perf_hooks';
import {writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
const text='This is a synthetic benchmark passage. Keep every word in its original order. Numbers one, two, three.';
const report={kind:'Real local Kokoro synthesis; process-cold load with existing model cache, not uncached download or browser timing',runtime:process.version,backend:'Node CPU q8',voice:'af_sarah',speed:1,cpu:os.cpus()[0].model,logicalProcessors:os.cpus().length,runs:[]};
const started=performance.now(),tts=await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{dtype:'q8',device:'cpu'});report.loadMs=performance.now()-started;
try{for(const phase of ['first-inference','warm-same-text']){const start=performance.now(),audio=await tts.generate(text,{voice:'af_sarah',speed:1}),ms=performance.now()-start;let peak=0,energy=0;for(const sample of audio.audio){if(!Number.isFinite(sample))throw Error('Invalid PCM');peak=Math.max(peak,Math.abs(sample));energy+=sample*sample;}const seconds=audio.audio.length/audio.sampling_rate;report.runs.push({phase,synthesisMs:ms,audioSeconds:seconds,RTF:ms/1000/seconds,sampleRate:audio.sampling_rate,samplePeak:peak,rms:Math.sqrt(energy/audio.audio.length),rssMB:process.memoryUsage().rss/1048576});}}
finally{await tts.model.dispose();}
await mkdir('.cache',{recursive:true});await writeFile('.cache/synthesis-benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
