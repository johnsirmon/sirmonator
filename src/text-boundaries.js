import {chunkText} from './core.js';
export const LEGACY_BOUNDARIES='exact-offsets-240-v1';
export const WORD_BOUNDARIES='word-grapheme-240-v2';
export const boundaryRevision=settings=>settings?.renderManifest?.chunker?.revision===WORD_BOUNDARIES?WORD_BOUNDARIES:LEGACY_BOUNDARIES;
export const wordBoundaryManifest=()=>({revision:WORD_BOUNDARIES,maxCharacters:240,segmentation:'Intl.Segmenter-grapheme',planIdentity:'sha256-source-offsets-v1'});

// Words are deliberately whitespace-delimited, not language-model tokens. A
// whitespace cluster carrying a mark/joiner stays with adjacent text. Only whole
// grapheme clusters and whole non-whitespace spans become candidate cut points.
export function chunkSource(text,revision=LEGACY_BOUNDARIES,max=240){
 if(revision===LEGACY_BOUNDARIES)return chunkText(text,max);
 if(revision!==WORD_BOUNDARIES)throw Error('Unknown text boundary policy.');
 if(typeof text!=='string'||!text.isWellFormed()||!Number.isInteger(max)||max<2)throw Error('New text boundaries require well-formed Unicode and a valid passage limit.');
 if(typeof Intl?.Segmenter!=='function')throw Error('This browser cannot prepare grapheme-safe text boundaries. Update your browser; saved recordings remain usable.');
 const chunks=[];let buffer='',ends=[],word='',wordStart=0;
 const flush=end=>{chunks.push(buffer.slice(0,end));buffer=buffer.slice(end);ends=ends.filter(n=>n>end).map(n=>n-end);};
 const unit=(value,start)=>{
  if(value.length>max)throw Error(`A token or joined Unicode cluster exceeds ${max} UTF-16 characters near source character ${start+1}. Review the source yourself; no text was changed.`);
  if(buffer.length+value.length>max){
   const sentences=[...buffer.matchAll(/[.!?][”’"'»)]*\s+/gu)].filter(match=>ends.includes(match.index+match[0].length)&&match.index>max/3);
   flush(sentences.length?sentences.at(-1).index+sentences.at(-1)[0].length:ends.at(-1));
   if(buffer.length+value.length>max)flush(buffer.length);
  }
  buffer+=value;ends.push(buffer.length);
  if(buffer.trim()&&/(?:\n[^\S\r\n]*\r?\n|\r[^\S\r\n]*\r|\u2029)$/u.test(buffer))flush(buffer.length);
 };
 for(const {segment,index} of new Intl.Segmenter('en',{granularity:'grapheme'}).segment(text)){
  if(/^\s+$/u.test(segment)){if(word){unit(word,wordStart);word='';}unit(segment,index);}
  else{if(/^\s/u.test(segment)&&word){unit(word,wordStart);word='';}if(!word)wordStart=index;word+=segment;if(word.length>max)unit(word,wordStart);}
 }
 if(word)unit(word,wordStart);if(buffer)flush(buffer.length);
 if(chunks.join('')!==text)throw Error('Text boundary integrity check failed.');return chunks;
}

// Persisted offsets are a frozen rendering input. Validation may reuse them
// without invoking a newer ICU/Unicode segmenter; their digest binds the job ID.
export function frozenChunks(text,passages,max=240){
 if(!Array.isArray(passages)||!passages.length||passages.length>text.length)throw Error('Frozen text boundary integrity check failed.');
 const chunks=[];let through=0;
 for(const p of passages){if(!Number.isSafeInteger(p?.start)||!Number.isSafeInteger(p.end)||p.start!==through||p.end<=through||p.end>text.length||p.end-through>max)throw Error('Frozen text boundary integrity check failed.');const part=text.slice(through,p.end);if(!part.isWellFormed())throw Error('Frozen Unicode boundary integrity check failed.');chunks.push(part);through=p.end;}
 if(through!==text.length)throw Error('Incomplete frozen text boundary integrity check failed.');return chunks;
}
