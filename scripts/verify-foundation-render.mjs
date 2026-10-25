// Real production PCM worker on Node CPU. Existing cache files are verified
// against pinned public metadata before local copying; all network is disabled.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import catalog from '../src/render-assets.json' with {type:'json'};
import {FOUNDATION_PIPELINE,KOKORO_REVISION} from '../src/engine-specs.js';
import {makeRecording} from '../src/recording.js';
import {openStorage} from '../src/storage.js';
import {runRecording,recordingBlob,renderReport} from '../src/job-runner.js';
import {createSynthesisClient} from '../src/synthesis-client.js';
import {createNodeWorkerFactory} from './worker-node.mjs';
import {createNodeExportWorker} from './export-node.mjs';
globalThis.IDBKeyRange=IDBKeyRange;
const root=resolve('.cache/foundation-models'),base='onnx-community/Kokoro-82M-v1.0-ONNX',verified=[];
for(const name of ['config.json','tokenizer.json','tokenizer_config.json','onnx/model_quantized.onnx']){
 const source=`node_modules/@huggingface/transformers/.cache/${base}/${name}`,bytes=await readFile(source),expected=catalog.kokoro.files[name];
 const hash=expected.sha256?createHash('sha256').update(bytes).digest('hex'):createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
 if(hash!==(expected.sha256??expected.gitBlob)||bytes.length!==expected.size)throw Error('Existing cache does not match pinned metadata: '+name);
 const target=resolve(root,base,KOKORO_REVISION,name);await mkdir(dirname(target),{recursive:true});await copyFile(source,target);verified.push({name,bytes:bytes.length,hash});
}
const factory=await createNodeWorkerFactory({offline:true,cacheDir:root}),client=createSynthesisClient({createWorker:()=>factory.createWorker()});
const source='This synthetic timing check preserves every word. One, two, three.\n\nThis synthetic timing check preserves every word. One, two, three.';
const job=await makeRecording(source,{voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE},'Foundation synthetic timing');
const store=await openStorage(indexedDB,'foundation-real-'+crypto.randomUUID());await store.ensureJob(job);await store.claim('owner');
// Model loading/inference can exceed one lease. Renew only this test's lease.
const lease=setInterval(()=>store.renew('owner').catch(()=>{}),5000);
try{
 await runRecording({store,id:job.id,owner:'owner',generate:(text,settings,last)=>client.generate({text,settings,last},'kokoro:frozen')});
 const saved=await store.job(job.id),exported=await recordingBlob(store,saved,null,undefined,{createWorker:createNodeExportWorker});
 await writeFile('.cache/foundation-render.mp3',new Uint8Array(await exported.blob.arrayBuffer()));
 const report=await renderReport(store,await store.job(job.id));report.verification={kind:'Actual production worker adapted only for Node CPU/offline files; no new model download',verifiedLocalFiles:verified,workerSourceSHA256:factory.sourceSHA256,workerCreations:factory.creations,sourceExact:job.passages.map(p=>source.slice(p.start,p.end)).join('')===source,voice:'af_sarah',limitations:'One local run, not a speedup benchmark, browser/phone test or acoustic quality/word-accuracy validation.'};
 await writeFile('.cache/foundation-render-report.json',JSON.stringify(report,null,2));
 const parts=await store.parts(job.id);const payload={job:await store.job(job.id),parts:await Promise.all(parts.map(async({blob,...part})=>({...part,base64:Buffer.from(await blob.arrayBuffer()).toString('base64')})))};
 await writeFile('.cache/foundation-browser-fixture.json',JSON.stringify(payload));
 console.log(JSON.stringify({verification:report.verification,performance:report.performance,passages:report.passages.map(p=>({index:p.index,metrics:p.metrics})),preparations:report.preparations},null,2));
}finally{clearInterval(lease);client.cancel();await factory.waitForTerminations();await store.release('owner');store.close();}
