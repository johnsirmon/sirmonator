import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createCloneSession} from '../src/cloning/session.js';
import {CLONE_CONTRACT} from '../src/cloning/contract.js';
import {prepareReference} from '../src/reference-provider.js';
import {encodeWav} from '../src/core.js';

// Actual worker loop/dispatch and session, replacing only ONNX calls.
// Tiny procedural PCM; no models, human references or audio uploads.
async function worker({eosAt=Infinity,stopAt=Infinity}={}){
 const messages=[],context=vm.createContext({self:{postMessage:m=>messages.push(m)},Float32Array,BigInt64Array,Uint8Array,Math,performance,setTimeout,inventory:{files:[]},eosAt,stopAt});
 const source=await readFile('src/cloning/worker.js','utf8');
 vm.runInContext(source.replace(/^import .*;\r?\n/gm,''),context);
 vm.runInContext(`
 ort={Tensor:class{constructor(type,data,dims){this.data=data;this.dims=dims;}}};
 bundleMetadata={flow_lm_state_manifest:[],mimi_state_manifest:[]};
 tokenizer={encodeIds:()=>[1],decodeIds:()=> 'Test'};
 samplesPerFrame=1;latentDim=1;conditioningDim=1;stTensors=[{s:{},t:{}}];
 let arCalls=0;
 textConditionerSession={outputNames:['text'],run:async()=>({text:new ort.Tensor('float32',new Float32Array(1),[1,1,1])})};
 flowLmMainSession={run:async({sequence})=>{if(sequence.dims[1]){arCalls++;if(arCalls>=stopAt)isGenerating=false;}return {conditioning:{},eos_logit:{data:[arCalls>=eosAt?0:-100]}};}};
 flowLmFlowSession={run:async()=>({flow_dir:{data:[0]}})};
 mimiDecoderSession={outputNames:['audio'],run:async({latent})=>({audio:{data:new Float32Array(latent.dims[1]).fill(.1)}})};
 `,context);
 const engine={sampleRate:24000,referenceContract:structuredClone(CLONE_CONTRACT),
  async cloneVoice(pcm,{name}){context.ref=name;vm.runInContext('voiceStateCache.set(ref,{})',context);return name;},
  async generate(text,{voice,onChunk}){
   context.request={id:1,type:'generate',payload:{text,voiceRef:voice}};
   await vm.runInContext('self.onmessage({data:request})',context);
   for(const message of messages)if(message.type==='chunk')onChunk(message.audio);
   const failure=messages.find(m=>m.type==='error');if(failure)throw Error(failure.error);
   return messages.find(m=>m.type==='result').result.metrics;
  },destroy(){this.destroyed=true;}};
 const file=new Blob([encodeWav([Float32Array.from({length:72000},(_,i)=>.1*Math.sin(i/10))],24000)]);
 const receipt=await prepareReference(file,{label:'Procedural worker fixture',authority:'synthetic',scope:'Local test only',provenance:'Procedural PCM; no person',permission:true,aiDisclosure:true});
 const session=createCloneSession({engineFactory:async()=>engine});await session.prepare(file,receipt);
 return {session,engine,messages};
}
for(const eosAt of [Infinity,500])test('worker rejects frame exhaustion without a completed EOS tail: '+eosAt,async()=>{
 const {session,engine,messages}=await worker({eosAt});
 await assert.rejects(session.generate('Test.'),/frame limit before completion/);
 assert.ok(messages.some(m=>m.type==='chunk'),'Partial chunks were emitted internally before the cap');
 assert.equal(messages.some(m=>m.type==='result'),false,'No complete result can publish');
 assert.equal(session.disposed,true);assert.equal(engine.destroyed,true);
});
test('worker EOS completion still produces a complete session result',async()=>{
 const {session,messages}=await worker({eosAt:1});
 try{const out=await session.generate('Test.');assert.equal(out.provenance.metrics.stopped,false);assert.ok(out.samples.length);assert.ok(messages.some(m=>m.type==='chunk'&&m.meta.isLast));assert.equal(out.samples.length,out.provenance.metrics.audioDuration*24000);}finally{session.dispose();}
});
test('worker interruption reports stopped and session rejects partial audio',async()=>{
 const {session,messages}=await worker({stopAt:6});
 await assert.rejects(session.generate('Test.'),/interrupted/);
 assert.equal(messages.find(m=>m.type==='result').result.metrics.stopped,true);assert.equal(session.disposed,true);
});
