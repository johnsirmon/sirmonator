import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PinnedKokoro,loadPinnedKokoro,readPinnedVoice} from '../src/pinned-kokoro.js';
import {KOKORO_REVISION} from '../src/engine-specs.js';
test('model and tokenizer loaders both receive the immutable revision and failed tokenizer load disposes its model',async()=>{
 const calls=[],model={dispose:async()=>{calls.push('disposed');}},tokenizer=()=>{};
 const loader=label=>({from_pretrained:async(repo,options)=>{calls.push({label,repo,options});return label==='model'?model:tokenizer;}});
 await loadPinnedKokoro({device:'wasm',dtype:'q8'},{modelLoader:loader('model'),tokenizerLoader:loader('tokenizer')});
 assert.ok(calls.every(c=>c.options.revision===KOKORO_REVISION));assert.ok(calls.every(c=>!c.repo.includes('main')));
 await assert.rejects(loadPinnedKokoro({},{modelLoader:loader('model'),tokenizerLoader:{from_pretrained:async()=>{throw Error('tokenizer unavailable');}}}),/tokenizer unavailable/);assert.equal(calls.at(-1),'disposed');
});
test('tokenizer disables truncation and over-budget IDs reject before reading voice assets or running model',async()=>{
 let options,models=0,voices=0;const engine=new PinnedKokoro(async()=>{models++;return {waveform:{data:new Float32Array(5)}};},(_text,o)=>{options=o;return {};},{readVoice:async()=>{voices++;return new Float32Array(510*256).fill(.1);}});
 engine.tokenizer('Synthetic text',{truncation:true});assert.equal(options.truncation,false);
 for(const count of [513,1000])await assert.rejects(engine.generate_from_ids({dims:[1,count]},{voice:'af_sarah'}),/token limit/);
 assert.equal(models,0);assert.equal(voices,0);await engine.generate_from_ids({dims:[1,512]},{voice:'af_sarah'});assert.equal(models,1);
});
test('voice loader rejects corrupt cached bytes and fetches only pinned, checksum-verified style data',async()=>{
 let fetches=0;const corrupt=new Uint8Array(522240);
 await assert.rejects(readPinnedVoice('af_sarah',{fetcher:async()=>{fetches++;},cacheFactory:{open:async()=>({match:async()=>new Response(corrupt)})}}),/integrity/);assert.equal(fetches,0);
 const bytes=await readFile('node_modules/kokoro-js/voices/af_sarah.bin');let url;
 const style=await readPinnedVoice('af_sarah',{cacheFactory:null,fetcher:async value=>{url=value;return new Response(bytes);}});
 assert.ok(url.includes('/resolve/'+KOKORO_REVISION+'/'));assert.ok(!url.includes('/main/'));assert.equal(style.length,510*256);
 await assert.rejects(readPinnedVoice('../unknown'),/Unknown/);
});
