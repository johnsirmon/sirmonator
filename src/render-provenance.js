import assets from './render-assets.json' with {type:'json'};
import previous from './render-contract-944aa8e.json' with {type:'json'};
import takesContract from './render-contract-1458c2e.json' with {type:'json'};
import pronunciationContract from './render-contract-8e3e830.json' with {type:'json'};
import preparationContract from './render-contract-0bd2d4a.json' with {type:'json'};
import storageContract from './render-contract-40459e2.json' with {type:'json'};
import recoveryContract from './render-contract-cbb8bd1.json' with {type:'json'};
import preparationRecoveryContract from './render-contract-6dd6049.json' with {type:'json'};
import compatibility from './pronunciation-compatibility.json' with {type:'json'};
import {normalizePronunciation} from './pronunciation.js';
import {getVoice} from './voices.js';
import {characterVoice,characterSettings} from './character-settings.js';
import {FOUNDATION_PIPELINE,KOKORO_REPO,KOKORO_REVISION,SUPERTONIC_REVISION,POCKET_REVISION} from './engine-specs.js';
export {FOUNDATION_PIPELINE};
export function currentManifest(settings){
 const voice=getVoice(settings.voice),reference=voice.engine==='pocket'?characterVoice(voice.base,settings.edition):null;
 const model=voice.engine==='kokoro'?{repository:KOKORO_REPO,revision:KOKORO_REVISION,assets:Object.fromEntries(Object.entries(assets.kokoro.files).filter(([name])=>!name.startsWith('voices/')||name==='voices/'+voice.base+'.bin')),tokenLimit:512}
  :voice.engine==='supertonic'?{repository:'supertone-oss-archive/supertonic-3',revision:SUPERTONIC_REVISION,voiceFile:`voice_styles/${voice.base}.json`,steps:8}
  :{repository:'vlapky/pocket-tts-onnx',revision:POCKET_REVISION,language:'english_2026-04',quantized:true,reference:assets.references[reference],sampling:characterSettings(reference)};
 const pronunciation=normalizePronunciation(settings.pronunciation);
 return JSON.parse(JSON.stringify({schema:1,pipeline:FOUNDATION_PIPELINE,source:assets.source,packages:assets.packages,engine:voice.engine,voice:{id:voice.id,base:voice.base,edition:settings.edition,revision:voice.revision??1},model,...(pronunciation?{pronunciation}:{}),chunker:{revision:'exact-offsets-240-v1',maxCharacters:240},output:{format:'pcm-s16le',channels:1,encoder:'lamejs-64kbps-single-artifact'},determinism:'Pinned inputs do not guarantee bit-identical inference across devices or repeated stochastic sampling.'}));
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
 if(JSON.stringify(manifest.pronunciation??null)!==JSON.stringify(normalizePronunciation(settings.pronunciation)))throw Error('Pronunciation rules do not match the frozen render manifest.');
 return JSON.parse(bytes);
}
export function assertSupportedManifest(settings){
 if(settings.pipeline!==FOUNDATION_PIPELINE)return;
 const current=currentManifest(settings),saved=settings.renderManifest;
 if(JSON.stringify(saved)===JSON.stringify(current))return;
 // Explicit bridge from the reviewed foundation release: only orchestration,
 // storage and provenance code changed. Every synthesis/voice/DSP/dependency
 // hash must still match, and all non-source manifest fields must be identical.
 const orchestration=new Set(['src/render-provenance.js','src/job-runner.js','src/storage.js','src/take-selection.js','src/passage-takes.js','src/render-contract-944aa8e.json','src/render-contract-1458c2e.json','src/render-contract-8e3e830.json','src/render-contract-0bd2d4a.json','src/pronunciation-compatibility.json']);
 // Old contracts have no aliases. Reviewed adapter overrides are pinned to
 // exact current file hashes; future audio edits cannot inherit this bridge.
 const pinned=Object.entries(compatibility.noRulesOverrides).every(([name,hash])=>assets.source.files[name]===hash);
 orchestration.add('src/idb-lifecycle.js');orchestration.add('src/render-contract-40459e2.json');
 orchestration.add('src/render-contract-cbb8bd1.json');orchestration.add('src/chapter-cache.js');
 orchestration.add('src/render-contract-6dd6049.json');
 for(const archived of [previous,takesContract,pronunciationContract,preparationContract,storageContract,recoveryContract,preparationRecoveryContract]){
  const sameAudio=Object.entries(archived.source.files).every(([name,hash])=>orchestration.has(name)||assets.source.files[name]===hash||(pinned&&name in compatibility.noRulesOverrides))&&Object.keys(assets.source.files).every(name=>orchestration.has(name)||name in archived.source.files||(pinned&&name in compatibility.noRulesOverrides));
  const supportedDictionary=!saved?.pronunciation||(archived===pronunciationContract&&saved.pronunciation.matcher==='literal-unicode-token-longest-v1')||([preparationContract,storageContract,recoveryContract,preparationRecoveryContract].includes(archived)&&['literal-unicode-token-longest-v1','literal-unicode-token-longest-v2'].includes(saved.pronunciation.matcher));
  if(supportedDictionary&&pinned&&sameAudio&&JSON.stringify(saved?.source)===JSON.stringify(archived.source)&&JSON.stringify({...saved,source:current.source})===JSON.stringify(current))return;
 }
 throw Error('These saved render inputs are not supported by this build. Saved audio can still be played and exported. Start a new recording to use updated inputs.');
}
export const executedBuildSourceSha=()=>assets.source.sha256;
