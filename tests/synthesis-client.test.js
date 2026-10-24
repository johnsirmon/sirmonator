import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSynthesisClient} from '../src/synthesis-client.js';
function setup(){
 const workers=[],timers=new Map();let timerId=0;
 const client=createSynthesisClient({createWorker:()=>{const worker={messages:[],terminated:false,postMessage(data){this.messages.push(data);},terminate(){this.terminated=true;},reply(data){this.onmessage({data});}};workers.push(worker);return worker;},setTimer:fn=>{timers.set(++timerId,fn);return timerId;},clearTimer:id=>timers.delete(id)});
 const finish=(worker,index=0)=>{const request=worker.messages[index];worker.reply({type:'passage',requestId:request.requestId,bytes:new Uint8Array([1,2]).buffer,seconds:1});};
 return {client,workers,timers,finish};
}
const input={text:'\u{1F64F} Preserve e\u0301, punctuation, and every word.\r\n\n',settings:{voice:'af_sarah',edition:'refined',speed:1,delivery:'natural'},last:false};
test('successful and paused flows reuse one worker without changing exact source or settings',async()=>{
 const {client,workers,timers,finish}=setup();const first=client.generate(input,'kokoro');finish(workers[0]);await first;client.idle();
 assert.equal(timers.size,1);const second=client.generate({...input,last:true},'kokoro');assert.equal(workers.length,1);assert.equal(timers.size,0);
 assert.equal(workers[0].messages[1].text,input.text);assert.deepEqual(workers[0].messages[1].settings,input.settings);assert.equal(workers[0].messages[1].last,true);
 finish(workers[0],1);await second;client.cancel();assert.equal(workers[0].terminated,true);assert.equal(timers.size,0);
});
test('idle expiry frees the worker and switching model families retains only one worker',async()=>{
 const {client,workers,timers,finish}=setup();const first=client.generate(input,'kokoro');finish(workers[0]);await first;
 const second=client.generate(input,'pocket');assert.equal(workers[0].terminated,true);finish(workers[1]);await second;
 [...timers.values()][0]();assert.equal(workers[1].terminated,true);
 const third=client.generate(input,'pocket');assert.equal(workers.length,3);finish(workers[2]);await third;client.cancel();
});
test('cancellation rejects pending work, discards late replies and permits exact passage retry',async()=>{
 const {client,workers,finish}=setup();const first=client.generate(input,'kokoro');client.cancel();await assert.rejects(first,/cancelled/);
 const retry=client.generate(input,'kokoro');finish(workers[0]);assert.equal(workers[1].terminated,false);assert.equal(workers[1].messages[0].text,input.text);
 finish(workers[1]);await retry;client.cancel();
});
test('worker errors discard the failed session and overlapping requests cannot start another inference',async()=>{
 const {client,workers,finish}=setup();const first=client.generate(input,'kokoro');await assert.rejects(client.generate(input,'kokoro'),/already/);
 workers[0].reply({type:'error',requestId:workers[0].messages[0].requestId,message:'Synthetic model failure'});await assert.rejects(first,/Synthetic model failure/);assert.equal(workers[0].terminated,true);
 const retry=client.generate(input,'kokoro');finish(workers[1]);await retry;client.cancel();
});

test('a stale idle callback cannot cancel a resumed inference',async()=>{
 const {client,workers,timers,finish}=setup();const first=client.generate(input,'kokoro');finish(workers[0]);await first;
 const stale=[...timers.values()][0],second=client.generate(input,'kokoro');stale();assert.equal(workers[0].terminated,false);
 finish(workers[0],1);await second;stale();assert.equal(workers[0].terminated,false);client.cancel();
});
