import assets from './render-assets.json' with {type:'json'};
import {getVoice} from './voices.js';
import {characterVoice,characterSettings} from './character-settings.js';
import {FOUNDATION_PIPELINE,KOKORO_REPO,KOKORO_REVISION,SUPERTONIC_REVISION,POCKET_REVISION} from './engine-specs.js';
export {FOUNDATION_PIPELINE};
export function currentManifest(settings){
 const voice=getVoice(settings.voice),reference=voice.engine==='pocket'?characterVoice(voice.base,settings.edition):null;
 const model=voice.engine==='kokoro'?{repository:KOKORO_REPO,revision:KOKORO_REVISION,assets:Object.fromEntries(Object.entries(assets.kokoro.files).filter(([name])=>!name.startsWith('voices/')||name==='voices/'+voice.base+'.bin')),tokenLimit:512}
  :voice.engine==='supertonic'?{repository:'supertone-oss-archive/supertonic-3',revision:SUPERTONIC_REVISION,voiceFile:`voice_styles/${voice.base}.json`,steps:8}
  :{repository:'vlapky/pocket-tts-onnx',revision:POCKET_REVISION,language:'english_2026-04',quantized:true,reference:assets.references[reference],sampling:characterSettings(reference)};
 return JSON.parse(JSON.stringify({schema:1,pipeline:FOUNDATION_PIPELINE,source:assets.source,packages:assets.packages,engine:voice.engine,voice:{id:voice.id,base:voice.base,edition:settings.edition,revision:voice.revision??1},model,chunker:{revision:'exact-offsets-240-v1',maxCharacters:240},output:{format:'pcm-s16le',channels:1,encoder:'lamejs-64kbps-single-artifact'},determinism:'Pinned inputs do not guarantee bit-identical inference across devices or repeated stochastic sampling.'}));
}
export function validateManifest(manifest,settings){
 // Historical manifests may be viewed/exported even when this build cannot
 // render them. Only assertSupportedManifest authorizes new inference.
 const voice=getVoice(settings.voice);let bytes;
 try{bytes=JSON.stringify(manifest);}catch{throw Error('Invalid frozen render manifest.');}
 if(!bytes||bytes.length>40000||manifest.schema!==1||manifest.pipeline!==FOUNDATION_PIPELINE||manifest.engine!==voice.engine||
    manifest.voice?.id!==voice.id||manifest.voice?.base!==voice.base||manifest.voice?.edition!==settings.edition||
    !Number.isInteger(manifest.voice?.revision)||manifest.voice.revision<1||
    !/^[a-f0-9]{64}$/.test(manifest.source?.sha256??'')||!/^[a-f0-9]{40}$/.test(manifest.model?.revision??''))throw Error('Invalid frozen render manifest.');
 return JSON.parse(bytes);
}
export function assertSupportedManifest(settings){
 if(settings.pipeline!==FOUNDATION_PIPELINE)return;
 if(JSON.stringify(settings.renderManifest)!==JSON.stringify(currentManifest(settings)))throw Error('These saved render inputs are not supported by this build. Saved audio can still be played and exported. Start a new recording to use updated inputs.');
}
