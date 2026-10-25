import test from 'node:test';
import assert from 'node:assert/strict';
import {chunkText} from '../src/core.js';
import {chunkSource,WORD_BOUNDARIES,LEGACY_BOUNDARIES} from '../src/text-boundaries.js';
import {makeRecording} from '../src/recording.js';
import {currentManifest,assertSupportedManifest,FOUNDATION_PIPELINE} from '../src/render-provenance.js';
import {validateCheckpoint} from '../src/job-runner.js';
import {fidelitySeeds,fidelityAtoms,fidelityRandom} from '../scripts/text-fidelity-fixture.mjs';
import archived from '../src/render-contract-d71b201.json' with {type:'json'};
import {createPronunciationEditor} from '../src/pronunciation-editor.js';
import {parsePronunciation,spokenPassage} from '../src/pronunciation.js';
const base={voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE};
const legacy=()=>{const manifest=currentManifest(base);manifest.source=archived.source;manifest.chunker={revision:LEGACY_BOUNDARIES,maxCharacters:240};return {...base,renderManifest:manifest};};

for(const seed of fidelitySeeds)test('new boundary seed '+seed+' preserves complete source, words and grapheme clusters',()=>{
 const random=fidelityRandom(seed),atoms=fidelityAtoms.filter(atom=>atom.length<240);
 for(let n=0;n<32;n++){const source=Array.from({length:100},()=>atoms[Math.floor(random()*atoms.length)]).join(' '),parts=chunkSource(source,WORD_BOUNDARIES),safe=new Set([0]);for(const item of new Intl.Segmenter('en',{granularity:'grapheme'}).segment(source))safe.add(item.index+item.segment.length);let offset=0;assert.equal(parts.join(''),source);
  for(const part of parts){assert.ok(part.length<=240&&part.isWellFormed());offset+=part.length;assert.ok(safe.has(offset),'Split a grapheme');if(offset<source.length)assert.ok(/\s/u.test(source[offset-1])||/\s/u.test(source[offset]),'Split a whitespace-delimited word');}
 }
});
test('new policy rejects oversized tokens/clusters explicitly; exact-limit tokens and old policy remain usable',()=>{
 for(const source of ['x'.repeat(241),'a'+'\u0301'.repeat(241),'👩‍👧'.repeat(60)]){assert.throws(()=>chunkSource(source,WORD_BOUNDARIES),/token or joined Unicode cluster exceeds 240/);assert.equal(chunkSource(source,LEGACY_BOUNDARIES).join(''),source);}
 assert.deepEqual(chunkSource('x'.repeat(240)+' b',WORD_BOUNDARIES),['x'.repeat(240),' b']);
 assert.deepEqual(chunkSource('x'.repeat(240)+' \u0301b',WORD_BOUNDARIES),['x'.repeat(240),' \u0301b']);
 const source=('e\u0301 👩‍👧 🇺🇸 क्‍ष a \u0301b\r\n\r\n').repeat(20);assert.equal(chunkSource(source,WORD_BOUNDARIES).join(''),source);assert.deepEqual(chunkSource(source,LEGACY_BOUNDARIES),chunkText(source));
});
test('new policy accepts a full-length ordinary manuscript without dropping trailing whitespace',async()=>{
 const source='word '.repeat(30000),job=await makeRecording(source,base);assert.equal(source.length,150000);assert.equal(job.source,source);assert.equal(job.passages.map(p=>source.slice(p.start,p.end)).join(''),source);assert.ok(job.passages.every(p=>p.end-p.start<=240));assert.deepEqual(await validateCheckpoint({parts:async()=>[]},job),[]);
});
test('multi-word alias crossing a new passage remains unchanged with an explicit preview warning',()=>{
 const source='x'.repeat(235)+' John John ends.',rules=parsePronunciation('John John => pair'),parts=chunkSource(source,WORD_BOUNDARIES);assert.equal(parts[0].length,240);assert.notEqual(spokenPassage(source,rules).text,source);assert.equal(parts.map(p=>spokenPassage(p,rules).text).join(''),source);
 const map=new Map(),$=id=>{if(!map.has(id))map.set(id,{value:'',checked:false,textContent:'',setAttribute(){},addEventListener(){}});return map.get(id);},editor=createPronunciationEditor({$,source:()=>source,onChange(){},policy:()=>WORD_BOUNDARIES});editor.restore(rules);assert.equal($('pronunciation-source').textContent,source);assert.equal($('pronunciation-spoken').textContent,source);assert.match($('pronunciation-status').textContent,/Multi-word rules that span saved passage boundaries are not substituted/);
});
test('new recording identity binds frozen offsets and validates without recutting under changed/missing segmenter',async()=>{
 const source=('These exact words include e\u0301 and 👩‍👧. ').repeat(25),job=await makeRecording(source,base),historical=await makeRecording(source,legacy());assert.notEqual(job.id,historical.id);assert.equal(job.settings.renderManifest.chunker.revision,WORD_BOUNDARIES);assert.match(job.boundaryPlanHash,/^[a-f0-9]{64}$/);assert.equal(historical.boundaryPlanHash,undefined);assertSupportedManifest(job.settings);assertSupportedManifest(historical.settings);
 const segmenter=Intl.Segmenter;try{Intl.Segmenter=undefined;assert.deepEqual(await validateCheckpoint({parts:async()=>[]},job),[]);assert.deepEqual(await validateCheckpoint({parts:async()=>[]},historical),[]);await assert.rejects(makeRecording(source,base),/browser cannot prepare/);}finally{Intl.Segmenter=segmenter;}
 const changed=structuredClone(job);changed.passages[0].end--;changed.passages[1].start--;await assert.rejects(validateCheckpoint({parts:async()=>[]},changed),/integrity/);
 const missing=structuredClone(job);delete missing.boundaryPlanHash;await assert.rejects(validateCheckpoint({parts:async()=>[]},missing),/integrity/);
 assert.equal((await makeRecording(source,job.settings,'Different title')).id,job.id);
});
test('new complete-token policy prevents artificial suffix aliases; legacy previews keep their explicit warning',()=>{
 const source='x'.repeat(240)+'John ends here.',rules=parsePronunciation('John => jon');assert.equal(chunkText(source).map(part=>spokenPassage(part,rules).text).join(''),'x'.repeat(240)+'jon ends here.');assert.throws(()=>chunkSource(source,WORD_BOUNDARIES),/exceeds/);
 const map=new Map(),$=id=>{if(!map.has(id))map.set(id,{value:'',checked:false,textContent:'',setAttribute(){},addEventListener(){}});return map.get(id);};let policy=LEGACY_BOUNDARIES;const editor=createPronunciationEditor({$,source:()=>source,onChange(){},policy:()=>policy});editor.restore(rules);assert.match($('pronunciation-status').textContent,/token is split/);policy=WORD_BOUNDARIES;editor.refresh();assert.match($('pronunciation-status').textContent,/exceeds 240/);assert.equal($('pronunciation-rules').value,'John => jon');
});
