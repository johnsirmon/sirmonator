import test from 'node:test';
import assert from 'node:assert/strict';
import {chunkText} from '../src/core.js';
import {parsePronunciation,spokenPassage,LEGACY_PRONUNCIATION_MATCHER,PRONUNCIATION_MATCHER} from '../src/pronunciation.js';
import {createPronunciationEditor} from '../src/pronunciation-editor.js';
import {importDocument} from '../src/import-document.js';
import {MAX_DOCUMENT} from '../src/recording.js';
test('split-token pronunciation ambiguity is visible while frozen v1/v2 matching and source remain unchanged',()=>{
 const source='x'.repeat(240)+'John ends here.',map=new Map(),$=id=>{if(!map.has(id))map.set(id,{value:'',checked:false,textContent:'',listeners:{},setAttribute(){},addEventListener(type,fn){this.listeners[type]=fn;}});return map.get(id);},editor=createPronunciationEditor({$,source:()=>source,onChange:()=>{}});
 for(const matcher of [LEGACY_PRONUNCIATION_MATCHER,PRONUNCIATION_MATCHER]){const rules=parsePronunciation('John => jon',{matcher});assert.equal(spokenPassage(source,rules).matches.length,0,'Whole-source token has no standalone John');assert.equal(chunkText(source).map(part=>spokenPassage(part,rules).text).join(''),'x'.repeat(240)+'jon ends here.');editor.restore(rules);assert.match($('pronunciation-status').textContent,/token is split between passages/);assert.equal($('pronunciation-source').textContent,source);assert.equal(editor.config().matcher,matcher);}
});
test('document and byte limits reject without returning a truncated replacement draft',async()=>{
 let read=false;await assert.rejects(importDocument({name:'synthetic.txt',size:10*1024*1024+1,arrayBuffer:async()=>{read=true;}}),/10 MB/);assert.equal(read,false);
 const bytes=new TextEncoder().encode('x'.repeat(MAX_DOCUMENT+1));await assert.rejects(importDocument({name:'synthetic.txt',size:bytes.length,arrayBuffer:async()=>bytes.buffer}),/2 million/);
});
test('TXT import describes existing editor newline/BOM semantics without changing its decoded source',async()=>{
 const source='First\r\nSecond\rThird\n😀',bytes=new Uint8Array([239,187,191,...new TextEncoder().encode(source)]),result=await importDocument({name:'synthetic.txt',size:bytes.length,arrayBuffer:async()=>bytes.buffer});assert.equal(result.text,source);assert.match(result.note,/LF line breaks/);assert.match(result.note,/BOM/);
});
