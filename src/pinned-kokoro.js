import {KokoroTTS} from 'kokoro-js';
import {StyleTextToSpeech2Model,AutoTokenizer,Tensor,RawAudio} from '@huggingface/transformers';
import {KOKORO_REPO,KOKORO_REVISION} from './engine-specs.js';
import assets from './render-assets.json' with {type:'json'};
import {verifiedBytes} from './asset-integrity.js';
// Reuse the pinned package's exact normalizer/phonemizer. Override only loading,
// truncation and style lookup: its stock browser style URL hard-codes main.
export class PinnedKokoro extends KokoroTTS{
  constructor(model,tokenizer,{readVoice=readPinnedVoice}={}){
    super(model,(text,options)=>tokenizer(text,{...options,truncation:false}));
    this.readVoice=readVoice;
  }
  async generate_from_ids(ids,{voice='af_heart',speed=1}={}){
    this._validate_voice(voice);
    const count=ids.dims?.at(-1);
    if(!Number.isInteger(count)||count<2||count>512)throw Object.assign(Error('This passage exceeds the Kokoro token limit after phonemization. No truncated audio was accepted. Split the reviewed source into smaller passages.'),{retryableGPU:false});
    const data=await this.readVoice(voice),offset=256*Math.min(count-2,509),style=data.slice(offset,offset+256);
    if(style.length!==256||!style.every(Number.isFinite))throw Error('Invalid voice style.');
    const {waveform}=await this.model({input_ids:ids,style:new Tensor('float32',style,[1,256]),speed:new Tensor('float32',[speed],[1])});
    return new RawAudio(waveform.data,24000);
  }
}
const voices=new Map();
export async function readPinnedVoice(voice,{fetcher=fetch,cacheFactory=globalThis.caches}={}){
  const entry=assets.kokoro.files['voices/'+voice+'.bin'];if(!entry?.sha256)throw Error('Unknown pinned voice asset.');
  const url=`https://huggingface.co/${KOKORO_REPO}/resolve/${KOKORO_REVISION}/voices/${voice}.bin`;
  if(voices.has(url))return voices.get(url);
  let cache;try{cache=await cacheFactory?.open('sirmonator-pinned-kokoro-v1');}catch{/* A cache is optional. Integrity is not. */}
  const cached=await cache?.match(url);let bytes;
  if(cached){bytes=await verifiedBytes(await cached.arrayBuffer(),entry);}
  else{
    const response=await fetcher(url);if(!response.ok)throw Error('Could not load the pinned voice asset.');
    bytes=await verifiedBytes(await response.arrayBuffer(),entry);
    try{await cache?.put(url,new Response(bytes));}catch{/* Quota does not change the verified bytes. */}
  }
  const data=new Float32Array(bytes);voices.set(url,data);return data;
}
export async function loadPinnedKokoro(options,{modelLoader=StyleTextToSpeech2Model,tokenizerLoader=AutoTokenizer}={}){
  const loaded=await Promise.allSettled([
    modelLoader.from_pretrained(KOKORO_REPO,{...options,revision:KOKORO_REVISION}),
    tokenizerLoader.from_pretrained(KOKORO_REPO,{progress_callback:options.progress_callback,revision:KOKORO_REVISION}),
  ]);
  if(loaded.some(item=>item.status==='rejected')){
    if(loaded[0].status==='fulfilled')await loaded[0].value.dispose();
    throw loaded.find(item=>item.status==='rejected').reason;
  }
  return new PinnedKokoro(loaded[0].value,loaded[1].value);
}
