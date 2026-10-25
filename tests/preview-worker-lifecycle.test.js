import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createSynthesisClient} from '../src/synthesis-client.js';

const main=await readFile('src/main.js','utf8'),handler=main.slice(main.indexOf("$('custom-preview').onclick="),main.indexOf("$('engine').onchange=")),stop=main.split('\n').find(line=>line.startsWith("$('stop').onclick="));
function setup({sendThrows=false}={}){
 const nodes=new Map(),workers=[],urls=[],messages=[];let source='First source.',plays=0;
 const $=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='engine'?'studio':'',hidden:true,play(){plays++;return Promise.resolve();},focus(){}});return nodes.get(id);};
 const client=createSynthesisClient({createWorker:()=>{const worker={messages:[],terminated:false,postMessage(data){if(sendThrows)throw Error('synthetic send failure');this.messages.push(data);},terminate(){this.terminated=true;},reply(data){this.onmessage({data});}};workers.push(worker);return worker;},setTimer:()=>1,clearTimer(){}});
 const context=vm.createContext({$,Blob,boundaryError:'',rangeText:()=>source,chunkSource:text=>[text],draftBoundaryPolicy:()=> 'synthetic',settings:()=>({voice:'af_sarah'}),generate:(text,settings,last,preview)=>client.generate({text,settings,last,preview},'kokoro'),synthesisClient:client,killWorker:()=>client.cancel(),cancelPreparations(){},audition:{stop(){}},controls(){},warn:e=>e.message,status:value=>messages.push(value),URL:{createObjectURL:blob=>{urls.push(blob);return 'blob:'+urls.length;},revokeObjectURL(){}},window:{}});
 vm.runInContext(`let creating=false,cancelled=false,importing=false,quick=false,renderToken=0,previewURL=null;const busy=()=>creating;${handler}\n${stop}\nglobalThis.active=()=>creating;`,context);
 return {$,workers,urls,messages,start:()=>$('custom-preview').onclick(),stop:()=>$('stop').onclick(),active:context.active,setSource:value=>source=value,get plays(){return plays;}};
}
test('actual custom preview with real synthesis client ignores cancelled-worker completion and publishes only the replacement',async()=>{
 const h=setup(),first=h.start(),old=h.workers[0];h.stop();await first;assert.equal(old.terminated,true);assert.equal(h.urls.length,0);assert.equal(h.active(),false);
 h.setSource('New reviewed source.');const second=h.start(),fresh=h.workers[1];
 old.reply({type:'passage',requestId:old.messages[0].requestId,bytes:new Uint8Array([9]).buffer});assert.equal(h.urls.length,0);assert.equal(h.active(),true);
 fresh.reply({type:'passage',requestId:fresh.messages[0].requestId,bytes:new Uint8Array([1,2]).buffer});await second;
 assert.equal(fresh.messages[0].text,'New reviewed source.');assert.equal(fresh.messages[0].preview,true);assert.equal(h.urls.length,1);assert.deepEqual(new Uint8Array(await h.urls[0].arrayBuffer()),new Uint8Array([1,2]));assert.equal(h.plays,1);assert.equal(h.active(),false);
});
test('a synchronous preview-worker send failure releases controls without creating or playing audio',async()=>{
 const h=setup({sendThrows:true});await h.start();assert.equal(h.active(),false);assert.equal(h.workers[0].terminated,true);assert.equal(h.urls.length,0);assert.equal(h.plays,0);assert.match(h.messages.at(-1),/synthetic send failure/);
});
