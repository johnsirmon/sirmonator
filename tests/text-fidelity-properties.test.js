import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {chunkText} from '../src/core.js';
import {makeRecording,chaptersFor,selectedText,decodeText,MAX_READING,digest} from '../src/recording.js';
import {parsePronunciation,spokenPassage} from '../src/pronunciation.js';
import {fidelitySeeds,fidelityText} from '../scripts/text-fidelity-fixture.mjs';
const settings={voice:'af_sarah',edition:'refined',delivery:'natural',speed:1};

for(const seed of fidelitySeeds)test('seed '+seed+' preserves every UTF-16 source unit and valid codepoint boundary across chunk sizes',()=>{
 for(let caseIndex=0;caseIndex<64;caseIndex++){
  const source=fidelityText(seed+caseIndex);assert.equal(source.isWellFormed(),true);
  for(const max of [2,3,7,79,239,240,241]){const parts=chunkText(source,max);assert.equal(parts.join(''),source,`seed ${seed} case ${caseIndex} max ${max}`);assert.ok(parts.every(p=>p.length>0&&p.length<=max&&p.isWellFormed()));}
  const chapters=chaptersFor(source,503);assert.equal(chapters.map(c=>source.slice(c.start,c.end)).join(''),source);let through=0;for(const chapter of chapters){assert.equal(chapter.start,through);assert.ok(chapter.end>through);through=chapter.end;}assert.equal(through,source.length);
  const from=Math.floor(chapters.length/3),to=chapters.length-1;assert.equal(selectedText(source,chapters,from,to),source.slice(chapters[from].start,chapters[to].end));
 }
});
test('manuscript size and malformed-surrogate boundaries reject explicitly without truncating accepted input',async()=>{
 const source='x'.repeat(MAX_READING-2)+'😀',job=await makeRecording(source,settings);assert.equal(job.source,source);assert.equal(job.passages.map(p=>source.slice(p.start,p.end)).join(''),source);assert.equal(job.sourceHash,await digest(source));
 await assert.rejects(makeRecording(source+'x',settings),/smaller chapter range/);for(const text of ['a\ud800b','a\udc00b'])await assert.rejects(makeRecording(text,settings),/incomplete Unicode/);
 const a=await makeRecording('é',settings),b=await makeRecording('e\u0301',settings);assert.notEqual(a.id,b.id,'No silent NFC normalization');
});
test('TXT decoder preserves decoded Unicode/newlines and treats encoding BOMs explicitly, rejecting replacement decoding',()=>{
 const source='A\r\nB\rC\n😀 e\u0301 “John 3:16”\u2028';assert.equal(decodeText(new TextEncoder().encode(source)),source);
 const little=new Uint8Array(2+source.length*2),big=new Uint8Array(little.length);little.set([255,254]);big.set([254,255]);for(let i=0;i<source.length;i++){new DataView(little.buffer).setUint16(2+i*2,source.charCodeAt(i),true);new DataView(big.buffer).setUint16(2+i*2,source.charCodeAt(i),false);}assert.equal(decodeText(little),source);assert.equal(decodeText(big),source);assert.equal(decodeText(new Uint8Array([239,187,191,...new TextEncoder().encode(source)])),source);
 for(const bytes of [[0xc0,0xaf],[0xe2,0x28,0xa1],[0xf0,0x9f],[255,254,0,216],[65,0,66]])assert.throws(()=>decodeText(new Uint8Array(bytes)),/encoding/);
});
test('pronunciation mappings retain exact original offsets, literal inserted forms and all nonmatched text',()=>{
 const dictionary=parsePronunciation('John => $& <literal>\nJohn 3:16 => verse three sixteen\né => eh');
 for(const seed of fidelitySeeds)for(let i=0;i<32;i++)for(const source of chunkText(fidelityText(seed+i,20))){const result=spokenPassage(source,dictionary);let through=0,recovered='',spoken='';for(const match of result.matches){assert.ok(match.start>=through);assert.equal(source.slice(match.start,match.end),match.from);recovered+=source.slice(through,match.start)+match.from;spoken+=source.slice(through,match.start)+match.to;through=match.end;}assert.equal(recovered+source.slice(through),source);assert.equal(spoken+source.slice(through),result.text);}
 assert.equal(spokenPassage('e\u0301',dictionary).text,'e\u0301');assert.equal(spokenPassage('John',dictionary).text,'$& <literal>');
});
test('actual transcript export handler retains exact source UTF-8 bytes rather than spoken aliases',async()=>{
 const main=await readFile('src/main.js','utf8'),line=main.split('\n').find(l=>l.startsWith("$('transcript').onclick="));assert.ok(line);const node={},source='\ufeff Original\r\nJohn 3:16 e\u0301 😀\n',selectedJob={source,title:'Synthetic'};let captured;
 vm.runInNewContext(line,{$:()=>node,selectedJob,Blob,safeFilename:()=> 'fixture',saveFile:(blob,name)=>{captured={blob,name};}});node.onclick();assert.deepEqual(new Uint8Array(await captured.blob.arrayBuffer()),new TextEncoder().encode(source));assert.equal(captured.name,'fixture-reviewed-source.txt');
});
