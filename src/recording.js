import {chunkText} from './core.js';
import {getVoice} from './voices.js';
import {LEGACY_PIPELINE,CONTINUITY_PIPELINE} from './continuity.js';
import {FOUNDATION_PIPELINE,currentManifest,validateManifest} from './render-provenance.js';
import {normalizePronunciation,spokenPassage} from './pronunciation.js';
import {assertEngineRequest} from './engine-capabilities.js';
export const MAX_DOCUMENT=2_000_000, MAX_READING=150_000, CHAPTER_SIZE=6000;
export const PIPELINE=FOUNDATION_PIPELINE;
export function chaptersFor(text,target=CHAPTER_SIZE){
  const passages=chunkText(text),chapters=[];let start=0,end=0;
  for(const passage of passages){
    if(end>start&&end-start+passage.length>target){chapters.push({start,end});start=end;}
    end+=passage.length;
  }
  if(end>start)chapters.push({start,end});
  return chapters;
}
export function selectedText(text,chapters,from,to){
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<from||to>=chapters.length)throw Error('Choose a valid chapter range.');
  return text.slice(chapters[from].start,chapters[to].end);
}
export async function digest(text){
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export function normalizeSettings(settings){
  const profile=getVoice(settings.voice);
  assertEngineRequest(profile.engine,settings);
  if(!['refined','previous'].includes(settings.edition))throw Error('Unknown voice edition.');
  if(!['natural','reflective','continuous'].includes(settings.delivery))throw Error('Unknown delivery.');
  const speed=Number(settings.speed);if(!Number.isFinite(speed)||speed<.7||speed>1.3)throw Error('Invalid narration speed.');
  const pipeline=settings.pipeline??LEGACY_PIPELINE;
  if(![LEGACY_PIPELINE,CONTINUITY_PIPELINE,PIPELINE].includes(pipeline))throw Error('Unknown audio pipeline.');
  const normalized={voice:profile.id,edition:settings.edition,delivery:settings.delivery,speed,voiceRevision:profile.revision??1,pipeline};
  const pronunciation=normalizePronunciation(settings.pronunciation);
  if(pronunciation){if(pipeline!==FOUNDATION_PIPELINE)throw Error('Pronunciation rules require a new recording with frozen render inputs.');normalized.pronunciation=pronunciation;}
  if(pipeline===FOUNDATION_PIPELINE){normalized.renderManifest=validateManifest(settings.renderManifest??currentManifest(normalized),normalized);normalized.voiceRevision=normalized.renderManifest.voice.revision;}
  return normalized;
}
export async function makeRecording(text,settings,title='My sermon'){
  if(!text.trim())throw Error('Add some text first.');
  if(!text.isWellFormed())throw Error('The source contains an incomplete Unicode character. Restore it from your original text before creating audio.');
  if(text.length>MAX_READING)throw Error('Choose a smaller chapter range: up to 150,000 characters per recording.');
  const normalized=normalizeSettings(settings),sourceHash=await digest(text);
  const id=await digest(JSON.stringify({sourceHash,settings:normalized}));
  const chapters=chaptersFor(text),passages=[];let start=0,chapter=0;
  for(const part of chunkText(text)){
    if(normalized.pronunciation)spokenPassage(part,normalized.pronunciation);
    while(chapter<chapters.length-1&&start>=chapters[chapter].end)chapter++;
    passages.push({start,end:start+part.length,chapter});start+=part.length;
  }
  return {id,sourceHash,...(normalized.renderManifest?{renderManifestHash:await digest(JSON.stringify(normalized.renderManifest))}:{}),source:text,title:title.trim().slice(0,120)||'My sermon',settings:normalized,chapters,passages,next:0,bytes:0,seconds:0,state:'paused',createdAt:Date.now(),updatedAt:Date.now(),position:{chapter:0,time:0}};
}
export function decodeText(buffer){
  const bytes=new Uint8Array(buffer);let encoding='utf-8';
  if(bytes[0]===255&&bytes[1]===254)encoding='utf-16le';
  if(bytes[0]===254&&bytes[1]===255)encoding='utf-16be';
  try{const text=new TextDecoder(encoding,{fatal:true}).decode(bytes);if(text.includes('\0'))throw Error();return text;}
  catch{throw Error('This TXT encoding could not be read safely. Save it as UTF-8 or UTF-16 with a BOM and try again.');}
}
export function safeFilename(title){return (title.normalize('NFKD').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,65)||'sirmonator-sermon');}
