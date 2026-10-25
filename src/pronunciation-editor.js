import {parsePronunciation,normalizePronunciation,spokenPassage,PRONUNCIATION_MATCHER,LEGACY_PRONUNCIATION_MATCHER} from './pronunciation.js';
import {chunkSource,LEGACY_BOUNDARIES,WORD_BOUNDARIES} from './text-boundaries.js';
// Draft controls are separate from immutable saved recording settings.
export function createPronunciationEditor({$,source,onChange,policy=()=>LEGACY_BOUNDARIES}){
 let revision=1,matcher=PRONUNCIATION_MATCHER;
 const config=()=>parsePronunciation($('pronunciation-rules').value,{revision,matcher,caseSensitive:$('pronunciation-case').checked});
 function refresh(){
  let dictionary;try{dictionary=config();}catch(error){$('pronunciation-source').textContent='';$('pronunciation-spoken').textContent='';$('pronunciation-status').textContent=error.message;$('pronunciation-rules').setAttribute('aria-invalid','true');return null;}
  try{const full=source();let text=full.slice(0,6240);if(policy()===WORD_BOUNDARIES&&/[\uD800-\uDBFF]$/.test(text))text=text.slice(0,-1);const parts=chunkSource(text,policy()),shown=[];let count=0,characters=0,splitToken=false;
   for(const part of parts){if(characters+part.length>6000)break;const result=spokenPassage(part,dictionary);shown.push(result.text);count+=result.matches.length;characters+=part.length;const next=String.fromCodePoint(full.codePointAt(characters)??0);if(/[\p{L}\p{M}\p{N}_]/u.test([...part].at(-1)??'')&&/[\p{L}\p{M}\p{N}_]/u.test(next))splitToken=true;}
   $('pronunciation-source').textContent=text.slice(0,characters);$('pronunciation-spoken').textContent=shown.join('');
   $('pronunciation-status').textContent=dictionary?`Draft dictionary revision ${revision}: ${dictionary.rules.length} rules; ${count} matches in this preview. ${characters<full.length?'Preview shortened to complete source passages. ':''}Saved recordings keep their own rules. Alias spelling is guidance to the voice, not a pronunciation guarantee.`:'Rules are off. The engine receives the original source text.'+(characters<full.length?' Preview shortened to complete source passages.':'');
   if(dictionary&&splitToken)$('pronunciation-status').textContent+=' A token is split between passages in this preview; per-passage rules can match only part of that token. Inspect the spoken input or remove ambiguous rules.';
   if(dictionary&&policy()===WORD_BOUNDARIES&&dictionary.rules.some(rule=>/\s/u.test(rule.from)))$('pronunciation-status').textContent+=' Multi-word rules that span saved passage boundaries are not substituted. Review the frozen spoken input; no cross-passage alias rewriting is performed.';
   $('pronunciation-rules').setAttribute('aria-invalid','false');return dictionary;
  }catch(error){$('pronunciation-source').textContent='';$('pronunciation-spoken').textContent='';$('pronunciation-status').textContent='Text preview: '+error.message;$('pronunciation-rules').setAttribute('aria-invalid','false');return null;}
 }
 const changed=()=>{revision++;matcher=PRONUNCIATION_MATCHER;refresh();onChange();};
 $('pronunciation-rules').addEventListener('input',changed);$('pronunciation-case').addEventListener('change',changed);
 return {config,refresh,snapshot:()=>({lines:$('pronunciation-rules').value,caseSensitive:$('pronunciation-case').checked,revision,matcher}),restore(value){const dictionary=normalizePronunciation(value);revision=dictionary?.revision??1;matcher=dictionary?.matcher??PRONUNCIATION_MATCHER;$('pronunciation-rules').value=dictionary?.rules.map(r=>r.from+' => '+r.to).join('\n')??'';$('pronunciation-case').checked=dictionary?.caseSensitive??false;refresh();},restoreDraft(value,fallback){if(!value){this.restore(fallback);return;}revision=Number.isSafeInteger(value.revision)&&value.revision>0?value.revision:1;matcher=value.matcher??fallback?.matcher??PRONUNCIATION_MATCHER;if(![PRONUNCIATION_MATCHER,LEGACY_PRONUNCIATION_MATCHER].includes(matcher))throw Error('Unsupported draft pronunciation matcher.');$('pronunciation-rules').value=typeof value.lines==='string'?value.lines:'';$('pronunciation-case').checked=value.caseSensitive===true;refresh();}};
}
