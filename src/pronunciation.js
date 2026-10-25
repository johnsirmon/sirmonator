export const PRONUNCIATION_MATCHER='literal-unicode-token-longest-v1';
export const MAX_RULES=32,MAX_ALIAS=80,MAX_SPOKEN_PASSAGE=960;
const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const token=character=>!!character&&/[\p{L}\p{M}\p{N}_]/u.test(character);
const before=(text,index)=>index?String.fromCodePoint(text.codePointAt(index-2)>=0x10000?text.codePointAt(index-2):text.codePointAt(index-1)):'';
export function normalizePronunciation(value){
 if(value==null)return null;
 if(value.schema!==1||value.matcher!==PRONUNCIATION_MATCHER||!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.caseSensitive!=='boolean'||!Array.isArray(value.rules)||value.rules.length>MAX_RULES)throw Error('Invalid pronunciation dictionary version or rules.');
 const rules=value.rules.map(rule=>{
  if(!rule||typeof rule.from!=='string'||typeof rule.to!=='string'||[rule.from,rule.to].some(text=>!text.length||text.length>MAX_ALIAS||text!==text.trim()||!text.isWellFormed()||/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(text)))throw Error('Each pronunciation entry needs 1–80 well-formed characters on each side, without line breaks or control characters.');
  return {from:rule.from,to:rule.to};
 });
 const flags=value.caseSensitive?'u':'iu';
 for(let i=0;i<rules.length;i++)for(let j=0;j<i;j++)if(new RegExp('^(?:'+escape(rules[i].from)+')$',flags).test(rules[j].from))throw Error('Duplicate pronunciation spelling under the selected case setting.');
 if(!rules.length)return null;
 return {schema:1,matcher:PRONUNCIATION_MATCHER,revision:value.revision,caseSensitive:value.caseSensitive,rules};
}
export function parsePronunciation(lines,{revision=1,caseSensitive=false}={}){
 if(typeof lines!=='string'||lines.length>MAX_RULES*(MAX_ALIAS*2+8))throw Error('Pronunciation rules are too long. Use at most 32 entries.');
 const rules=lines.split(/\r?\n/u).filter(line=>line.trim()).map(line=>{const fields=line.split('=>');if(fields.length!==2)throw Error('Use one spelling => spoken form per line. The delimiter cannot appear inside either side.');return {from:fields[0].trim(),to:fields[1].trim()};});
 return normalizePronunciation({schema:1,matcher:PRONUNCIATION_MATCHER,revision,caseSensitive,rules});
}
// Literal matching, original source offsets, deterministic longest match at the
// earliest position. Inserted aliases are never rescanned or interpreted as regex.
export function spokenPassage(source,value){
 const dictionary=normalizePronunciation(value);if(!dictionary)return {text:source,matches:[]};
 if(typeof source!=='string'||!source.isWellFormed()||source.length>6000)throw Error('Pronunciation resolution requires a bounded, well-formed source passage.');
 const candidates=[];
 dictionary.rules.forEach((rule,ruleIndex)=>{
  const pattern=new RegExp(escape(rule.from),dictionary.caseSensitive?'gu':'giu');let match;
  while((match=pattern.exec(source))){const start=match.index,end=start+match[0].length;
   if(!token(before(source,start))&&!token(String.fromCodePoint(source.codePointAt(end)??0)))candidates.push({start,end,ruleIndex,to:rule.to,from:match[0]});
  }
 });
 candidates.sort((a,b)=>a.start-b.start||(b.end-b.start)-(a.end-a.start)||a.ruleIndex-b.ruleIndex);
 let text='',through=0;const matches=[];
 for(const match of candidates){if(match.start<through)continue;text+=source.slice(through,match.start)+match.to;through=match.end;matches.push(match);if(text.length>MAX_SPOKEN_PASSAGE)throw Error('Pronunciation output exceeds 960 characters for one passage. Shorten the aliases.');}
 text+=source.slice(through);if(text.length>MAX_SPOKEN_PASSAGE)throw Error('Pronunciation output exceeds 960 characters for one passage. Shorten the aliases.');
 return {text,matches};
}
