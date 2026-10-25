import {parsePronunciation,normalizePronunciation,spokenPassage} from './pronunciation.js';
import {chunkText} from './core.js';
// Draft controls are separate from immutable saved recording settings.
export function createPronunciationEditor({$,source,onChange}){
 let revision=1;
 const config=()=>parsePronunciation($('pronunciation-rules').value,{revision,caseSensitive:$('pronunciation-case').checked});
 function refresh(){
  try{const dictionary=config(),full=source(),text=full.slice(0,6240),parts=chunkText(text),shown=[];let count=0,characters=0;
   for(const part of parts){if(characters+part.length>6000)break;const result=spokenPassage(part,dictionary);shown.push(result.text);count+=result.matches.length;characters+=part.length;}
   $('pronunciation-source').textContent=text.slice(0,characters);$('pronunciation-spoken').textContent=shown.join('');
   $('pronunciation-status').textContent=dictionary?`Draft dictionary revision ${revision}: ${dictionary.rules.length} rules; ${count} matches in this preview. ${characters<full.length?'Preview shortened to complete source passages. ':''}Saved recordings keep their own rules. Alias spelling is guidance to the voice, not a pronunciation guarantee.`:'Rules are off. The engine receives the original source text.'+(characters<full.length?' Preview shortened to complete source passages.':'');
   $('pronunciation-rules').setAttribute('aria-invalid','false');return dictionary;
  }catch(error){$('pronunciation-source').textContent='';$('pronunciation-spoken').textContent='';$('pronunciation-status').textContent=error.message;$('pronunciation-rules').setAttribute('aria-invalid','true');return null;}
 }
 const changed=()=>{revision++;refresh();onChange();};
 $('pronunciation-rules').addEventListener('input',changed);$('pronunciation-case').addEventListener('change',changed);
 return {config,refresh,snapshot:()=>({lines:$('pronunciation-rules').value,caseSensitive:$('pronunciation-case').checked,revision}),restore(value){const dictionary=normalizePronunciation(value);revision=dictionary?.revision??1;$('pronunciation-rules').value=dictionary?.rules.map(r=>r.from+' => '+r.to).join('\n')??'';$('pronunciation-case').checked=dictionary?.caseSensitive??false;refresh();},restoreDraft(value,fallback){if(!value){this.restore(fallback);return;}revision=Number.isSafeInteger(value.revision)&&value.revision>0?value.revision:1;$('pronunciation-rules').value=typeof value.lines==='string'?value.lines:'';$('pronunciation-case').checked=value.caseSensitive===true;refresh();}};
}
