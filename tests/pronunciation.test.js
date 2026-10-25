import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {normalizePronunciation,parsePronunciation,spokenPassage,PRONUNCIATION_MATCHER} from '../src/pronunciation.js';
import {createPronunciationEditor} from '../src/pronunciation-editor.js';
import {makeRecording,digest} from '../src/recording.js';
import {FOUNDATION_PIPELINE,assertSupportedManifest,currentManifest} from '../src/render-provenance.js';
import {openStorage} from '../src/storage.js';
import {runRecording,validateCheckpoint,recordingBlob,renderReport} from '../src/job-runner.js';
import {changePassage} from '../src/passage-takes.js';
import {validateTake} from '../src/take-selection.js';
import {quantizePcm,LEGACY_PIPELINE,CONTINUITY_PIPELINE} from '../src/continuity.js';
import {renderMetrics} from '../src/render-metrics.js';
import {getVoice} from '../src/voices.js';
import {characterEffect,pauseAfter} from '../src/audio-effects.js';
import {createNodeExportWorker} from '../scripts/export-node.mjs';
import {chunkText} from '../src/core.js';
import {sourceSnapshot} from '../scripts/update-render-catalog.mjs';
import baseline from '../src/render-contract-1458c2e.json' with {type:'json'};
import compatibility from '../src/pronunciation-compatibility.json' with {type:'json'};
globalThis.IDBKeyRange=IDBKeyRange;
const rules=lines=>parsePronunciation(lines),settings={voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE};
function output(job,text,level=.1){const samples=new Float32Array(2400).fill(level);return {bytes:quantizePcm(samples),sampleCount:2400,sampleRate:24000,format:'pcm-s16le',channels:1,seconds:.1,renderManifest:job.settings.renderManifest,...(job.settings.pronunciation?{spokenText:spokenPassage(text,job.settings.pronunciation).text}:{}),metrics:renderMetrics({started:0,synthesized:10,finished:11,audio:{samples,sampleRate:24000,runtime:{provider:'cpu',dtype:'q8',loadMs:2,inferenceMs:7,modelLoadAttempts:1,retries:0}},outputSeconds:.1,format:'pcm-s16le',engine:'kokoro'})};}
test('literal token matching retains offsets, handles Unicode/case, and does not normalize accents or expand case folding',()=>{
 const dictionary=rules('Paul => pawl\nJosé => ho-SAY\nK => kay\nStraße => street');
 const text="Paul Paulson Paul_2 2Paul Paul’s (PAUL). éPaul Paulé José Jose\u0301 K K Straße STRASSE.";
 const result=spokenPassage(text,dictionary);
 assert.equal(result.text,"pawl Paulson Paul_2 2Paul pawl’s (pawl). éPaul Paulé ho-SAY Jose\u0301 kay kay street STRASSE.");
 for(const match of result.matches)assert.equal(text.slice(match.start,match.end),match.from);
 const sensitive=parsePronunciation('Paul => pawl',{caseSensitive:true});assert.equal(spokenPassage('Paul PAUL paul',sensitive).text,'pawl PAUL paul');
 assert.equal(spokenPassage('𐐀Paul Paul𐐀 𐐀 Paul',dictionary).text,'𐐀Paul Paul𐐀 𐐀 pawl');
});
test('overlap uses longest at earliest position; replacement is literal and never cascades',()=>{
 const dictionary=rules('John => jahn\nJohn Mark => full-name\nMark => mark-alias\njahn => second-pass\nA+B => $&\\literal\n[a] => <spoken>');
 assert.equal(spokenPassage('John Mark and John, A+B [a].',dictionary).text,'full-name and jahn, $&\\literal <spoken>.');
 assert.equal(spokenPassage('a b c',rules('a b => first\nb c => second')).text,'first c');
 assert.equal(spokenPassage('John\n\nMark',dictionary).text,'jahn\n\nmark-alias');
 assert.equal(spokenPassage('C\\D',rules('C\\D => slash')).text,'slash');
});
test('phrase matching stays within original chunk boundaries and never skips or repeats split words',()=>{
 const source='X '.repeat(116)+'John Mark.',dictionary=rules('John Mark => full-name'),parts=chunkText(source);
 assert.equal(parts.length,2);assert.equal(spokenPassage(source,dictionary).text.endsWith('full-name.'),true);assert.equal(parts.map(p=>spokenPassage(p,dictionary).text).join(''),source);
});
test('invalid/duplicate/oversized rules reject, empty rules preserve identities, and snapshots are independent',()=>{
 for(const bad of ['Paul pawl','Paul =>','Paul => x => y','Paul => x\nPAUL => y','K => x\nK => y','A'.repeat(81)+' => a','A => \ud800'])assert.throws(()=>rules(bad));
 assert.throws(()=>rules(Array.from({length:33},(_,i)=>'Name'+i+' => x').join('\n')));
 assert.equal(rules(' \n'),null);assert.equal(spokenPassage('Exact text.',null).text,'Exact text.');
 const input=rules('Paul => pawl'),normalized=normalizePronunciation(input);input.rules[0].to='changed';assert.equal(normalized.rules[0].to,'pawl');
 assert.throws(()=>spokenPassage(('A ').repeat(240),rules('A => '+'x'.repeat(80))),/960/);
});
test('source and dictionary revisions produce immutable identities; source routing and historical identities are preserved',async()=>{
 const source='Paul met John Mark.\n\nPaul wrote a letter.',pronunciation=rules('Paul => pawl'),job=await makeRecording(source,{...settings,pronunciation});
 assert.equal(job.source,source);assert.equal(job.passages.map(p=>source.slice(p.start,p.end)).join(''),source);assert.deepEqual(job.settings.renderManifest.pronunciation,pronunciation);
 const original=await makeRecording(source,settings),other=await makeRecording(source,{...settings,pronunciation:rules('Paul => paul-alias')}),next=await makeRecording(source,{...settings,pronunciation:{...pronunciation,revision:2}});
 assert.notEqual(job.id,original.id);assert.notEqual(job.id,other.id);assert.notEqual(job.id,next.id);assert.equal((await makeRecording(source,{...settings,pronunciation:parsePronunciation('')})).id,original.id);
 pronunciation.rules[0].to='edited after create';assert.equal(job.settings.pronunciation.rules[0].to,'pawl');
 for(const pipeline of [LEGACY_PIPELINE,CONTINUITY_PIPELINE])await assert.rejects(makeRecording(source,{...settings,pipeline,pronunciation:rules('Paul => pawl')}),/new recording/);
 const tampered=structuredClone(job.settings);tampered.pronunciation.rules[0].to='different';await assert.rejects(makeRecording(source,tampered),/frozen/);
 const report=JSON.parse(await readFile('evidence/passage-takes-real-node.json','utf8')),historical=await makeRecording(report.source,report.after.settings);assert.equal(historical.id,report.after.recordingId);assertSupportedManifest(historical.settings);
});
test('no-rule compatibility overrides are exact pins and the old worker path is structurally unchanged',async()=>{
 const snapshot=await sourceSnapshot();for(const [name,hash] of Object.entries(compatibility.noRulesOverrides))assert.equal(snapshot.files[name],hash);
 let worker=await readFile('src/tts-worker.js','utf8');worker=worker.replace("import {spokenPassage} from './pronunciation.js';\n",'').replace("import {spokenPassage} from './pronunciation.js';\r\n",'').replace(/    const spoken=spokenPassage\(data.text,data.settings.pronunciation\).text;\r?\n/u,'').replace(/    if\(data.settings.pronunciation\)provenance.spokenText=spoken;\r?\n/u,'').replace('.pocket(spoken,','.pocket(data.text,').replace('.supertonic(spoken,','.supertonic(data.text,').replace(':await kokoro(spoken,',':await kokoro(data.text,');assert.equal(await digest(worker.replaceAll('\r\n','\n')),baseline.source.files['src/tts-worker.js']);
 const manifest=currentManifest(settings);manifest.source=baseline.source;assertSupportedManifest({...settings,renderManifest:manifest});manifest.source=structuredClone(baseline.source);manifest.source.files['src/tts-worker.js']='a'.repeat(64);assert.throws(()=>assertSupportedManifest({...settings,renderManifest:manifest}),/not supported/);
});
test('actual worker handler sends resolved text to the stub engine, retains original pause accounting and provenance',async()=>{
 const source='Paul?\n\n',job=await makeRecording(source,{...settings,pronunciation:rules('Paul? => pawl')}),messages=[],calls=[];
 const worker=await readFile('src/tts-worker.js','utf8'),handler=worker.slice(worker.indexOf('self.onmessage=async')).replaceAll('import.meta.url',JSON.stringify('file:///test/worker.js'));
 const context=vm.createContext({self:{postMessage:m=>messages.push(m)},performance:{now:()=>10},getVoice,LEGACY_PIPELINE,CONTINUITY_PIPELINE,FOUNDATION_PIPELINE,assertSupportedManifest,spokenPassage,renderMetrics,characterEffect,pauseAfter,quantizePcm,isPcmPipeline:p=>p===FOUNDATION_PIPELINE,Float32Array,ArrayBuffer,family:null,kokoro:async(text)=>{calls.push(text);return {samples:new Float32Array(24),sampleRate:24000,runtime:{provider:'cpu',dtype:'q8',loadMs:0,inferenceMs:0,modelLoadAttempts:0,retries:0}};}});
 vm.runInContext(handler,context);await context.self.onmessage({data:{requestId:1,text:source,settings:job.settings,last:false}});
 const passage=messages.find(m=>m.type==='passage');assert.deepEqual(calls,['pawl\n\n']);assert.equal(passage.spokenText,'pawl\n\n');assert.equal(passage.sampleCount,24+Math.round(pauseAfter(source,'natural')*24000));assert.deepEqual(passage.renderManifest,job.settings.renderManifest);
});
test('interruption/reload/resume, takes and exports retain the frozen pronunciation snapshot and spoken hashes',async()=>{
 const name='pronunciation-'+crypto.randomUUID();let store=await openStorage(indexedDB,name),job=await makeRecording('Paul arrived.\n\nPaul spoke.\n\nPaul left.',{...settings,pronunciation:rules('Paul => pawl')});await store.ensureJob(job);await store.claim('owner');let count=0;
 await assert.rejects(runRecording({store,id:job.id,owner:'owner',generate:async(text)=>{if(++count===2)throw new DOMException('Interrupted','AbortError');return output(job,text);}}),{name:'AbortError'});assert.equal((await store.job(job.id)).next,1);store.close();store=await openStorage(indexedDB,name);job=await store.job(job.id);await store.claim('owner');
 const seen=[];job=await runRecording({store,id:job.id,owner:'owner',generate:async(text,config)=>{seen.push({text,config});return output(job,text);}});assert.equal(seen.length,2);assert.deepEqual(seen[0].config.pronunciation,job.settings.pronunciation);assert.equal(job.source,'Paul arrived.\n\nPaul spoke.\n\nPaul left.');
 const original=await recordingBlob(store,job,null,undefined,{createWorker:createNodeExportWorker}),changed=await changePassage({store,id:job.id,index:1,owner:'owner',revision:0,generate:async(text,config)=>{assert.deepEqual(config.pronunciation,job.settings.pronunciation);return output(job,text,.3);}}),parts=await validateCheckpoint(store,changed);assert.equal(parts[1].spokenTextHash,await digest('pawl spoke.\n\n'));
 const report=await renderReport(store,changed);assert.equal(report.settings.renderManifest.pronunciation.revision,1);assert.equal(report.passages[1].spokenTextHash,parts[1].spokenTextHash);await assert.rejects(validateTake(changed,{...parts[1],spokenTextHash:'0'.repeat(64)}),/pronunciation integrity/);
 const restored=await changePassage({store,id:job.id,owner:'owner',revision:1,action:'undo'}),undone=await recordingBlob(store,restored,null,undefined,{createWorker:createNodeExportWorker});assert.deepEqual(await original.blob.arrayBuffer(),await undone.blob.arrayBuffer());store.close();
});
test('wrong spoken text fails atomically and cancellation cannot publish a differently resolved take',async()=>{
 const store=await openStorage(indexedDB,'pronunciation-fail-'+crypto.randomUUID()),job=await makeRecording('Paul spoke.',{...settings,pronunciation:rules('Paul => pawl')});await store.ensureJob(job);await store.claim('owner');
 await assert.rejects(store.commit(job.id,0,{...output(job,job.source),spokenText:job.source},'owner'),/frozen pronunciation/);assert.equal((await store.job(job.id)).next,0);const saved=await store.commit(job.id,0,output(job,job.source),'owner');
 const controller=new AbortController();await assert.rejects(changePassage({store,id:job.id,index:0,owner:'owner',revision:0,signal:controller.signal,generate:async text=>{controller.abort();return output(saved,text);}}),{name:'AbortError'});assert.equal((await store.takes(job.id)).length,0);assert.equal((await store.job(job.id)).takeSelection,undefined);store.close();
});
test('draft editor previews safely, preserves invalid edits on reload and bounds the preview without changing source',()=>{
 const map=new Map(),$=id=>{if(!map.has(id))map.set(id,{value:'',checked:false,textContent:'',listeners:{},setAttribute(){},addEventListener(type,fn){this.listeners[type]=fn;}});return map.get(id);};let changes=0;const source='Paul <Paul> & John.\n\n'.repeat(1000),editor=createPronunciationEditor({$,source:()=>source,onChange:()=>changes++});
 $('pronunciation-rules').value='Paul => <pawl> & $&';$('pronunciation-rules').listeners.input();assert.equal(changes,1);assert.ok($('pronunciation-source').textContent.length<=6000);assert.ok($('pronunciation-spoken').textContent.includes('<pawl> & $&'));assert.equal(source.startsWith('Paul'),true);assert.match($('pronunciation-status').textContent,/shortened/);
 $('pronunciation-rules').value='Invalid unfinished rule';$('pronunciation-rules').listeners.input();const snapshot=editor.snapshot();assert.throws(()=>editor.config());editor.restoreDraft(snapshot);assert.equal($('pronunciation-rules').value,'Invalid unfinished rule');assert.throws(()=>editor.config());assert.equal($('pronunciation-spoken').textContent,'');
});
test('pronunciation controls occur once and page IDs stay unique',async()=>{
 const html=await readFile('index.html','utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/gu)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
 for(const id of ['pronunciation-controls','pronunciation-rules','pronunciation-case','pronunciation-source','pronunciation-spoken','take-spoken'])assert.equal(ids.filter(value=>value===id).length,1);
});
