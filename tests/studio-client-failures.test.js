import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthesisClient} from '../src/synthesis-client.js';

const input={text:'Exact synthetic source.\n\n',settings:{voice:'af_sarah',pipeline:'pcm-manifest-v3-2026-10-24'},last:false};
function harness(){
 const workers=[],timers=new Map(),loading=[],stages=[];let id=0,creationFailure=false,postFailure=false,terminationFailure=false,terminationObserved=false,timerFailure=false,observerFailure=false;
 const client=createSynthesisClient({createWorker(){if(creationFailure){creationFailure=false;throw Error('creation failed');}const worker={messages:[],terminated:0,postMessage(data){if(postFailure){postFailure=false;throw Error('send failed');}this.messages.push(data);},terminate(){this.terminated++;if(terminationFailure==='sync')throw Error('termination failed');if(terminationFailure==='async')return {then(_yes,no){terminationObserved=true;no(Error('async termination failed'));}};},reply(data){this.onmessage({data});}};workers.push(worker);return worker;},setTimer:fn=>{if(timerFailure)throw Error('timer failed');timers.set(++id,fn);return id;},clearTimer:key=>timers.delete(key),onLoading:data=>{if(observerFailure)throw Error('observer failed');loading.push(data);},onStage:message=>{if(observerFailure)throw Error('observer failed');stages.push(message);}});
 const finish=worker=>{const request=worker.messages.at(-1);worker.reply({type:'passage',requestId:request.requestId,bytes:new Uint8Array([1,2]).buffer,seconds:1,metrics:{synthetic:true}});};
 async function pair(){const before=workers.length,a=client.generate(input,'kokoro:frozen'),worker=workers.at(-1);finish(worker);const first=await a;const b=client.generate({...input,text:'Second exact source.'},'kokoro:frozen');assert.equal(workers.at(-1),worker);finish(worker);assert.deepEqual((await b).metrics,first.metrics);assert.ok(workers.length<=before+1);return worker;}
 return {client,workers,timers,finish,pair,loading,stages,fail:key=>{if(key==='creation')creationFailure=true;if(key==='post')postFailure=true;if(key==='termination-sync')terminationFailure='sync';if(key==='termination-async')terminationFailure='async';if(key==='timer')timerFailure=true;if(key==='observer')observerFailure=true;},reset(){terminationFailure=false;timerFailure=false;observerFailure=false;},get terminationObserved(){return terminationObserved;}};
}
test('a throwing worker termination cannot strand cancellation or block two successful warm retries',async()=>{
 const h=harness();await h.pair();const pending=h.client.generate(input,'kokoro:frozen'),rejected=assert.rejects(pending,/cancelled/);h.fail('termination-sync');assert.doesNotThrow(()=>h.client.cancel());await rejected;h.reset();await h.pair();h.client.cancel();
});
test('async termination rejection is observed without blocking warm requests after retry',async()=>{
 const h=harness();await h.pair();h.fail('termination-async');h.client.cancel();await Promise.resolve();await Promise.resolve();assert.equal(h.terminationObserved,true);h.reset();await h.pair();h.client.cancel();
});
test('worker message deserialization failure rejects pending work and allows two consecutive retry results',async()=>{
 const h=harness();await h.pair();const pending=h.client.generate(input,'kokoro:frozen');let rejected=false;pending.catch(()=>rejected=true);h.workers.at(-1).onmessageerror?.({});await Promise.resolve();const handled=rejected;h.client.cancel();await assert.rejects(pending);assert.equal(handled,true);await h.pair();h.client.cancel();
});
test('a failed idle timer cannot strand a completed passage; the next pair remains usable',async()=>{
 const h=harness();await h.pair();const pending=h.client.generate(input,'kokoro:frozen');h.fail('timer');assert.doesNotThrow(()=>h.finish(h.workers.at(-1)));assert.equal((await pending).seconds,1);h.reset();await h.pair();h.client.cancel();
});
for(const fault of ['creation','post'])test(fault+' failure preserves exact inputs through two warm successes on each side',async()=>{
 const h=harness();await h.pair();if(fault==='creation')h.client.cancel();h.fail(fault);await assert.rejects(h.client.generate(input,'kokoro:frozen'),/failed/);await h.pair();assert.equal(h.workers.at(-1).messages[0].text,input.text);h.client.cancel();
});
test('observer errors cannot interrupt a completed passage or force model reload',async()=>{
 const h=harness();await h.pair();const pending=h.client.generate(input,'kokoro:frozen'),worker=h.workers.at(-1),request=worker.messages.at(-1);h.fail('observer');assert.doesNotThrow(()=>worker.reply({type:'stage',requestId:request.requestId,message:'Loading'}));assert.doesNotThrow(()=>worker.reply({type:'loading',requestId:request.requestId,progress:5}));h.finish(worker);await pending;h.reset();await h.pair();assert.equal(h.workers.length,1);h.client.cancel();
});
test('late tagged progress cannot relabel a newer request in the same warm worker',async()=>{
 const h=harness(),worker=await h.pair(),old=worker.messages[0],pending=h.client.generate(input,'kokoro:frozen');worker.reply({type:'loading',requestId:old.requestId,progress:9});assert.equal(h.loading.length,0);h.finish(worker);await pending;await h.pair();h.client.cancel();
});
test('malformed current-worker messages reject safely rather than stranding the pending request',async()=>{
 const h=harness();await h.pair();const pending=h.client.generate(input,'kokoro:frozen'),rejected=assert.rejects(pending,/invalid response/);assert.doesNotThrow(()=>h.workers.at(-1).reply(null));await rejected;await h.pair();h.client.cancel();
});
