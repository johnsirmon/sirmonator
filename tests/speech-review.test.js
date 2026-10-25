import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {compareTranscript,captureReview,reviewSelectionMatches} from '../src/speech-review.js';
import {spokenPassage,parsePronunciation,LEGACY_PRONUNCIATION_MATCHER} from '../src/pronunciation.js';
import {makeRecording,digest} from '../src/recording.js';
import {openStorage} from '../src/storage.js';
import {openReviewStorage,REVIEW_LIMIT,REVIEW_BYTES} from '../src/review-storage.js';
import {FOUNDATION_PIPELINE} from '../src/engine-specs.js';
import {quantizePcm} from '../src/continuity.js';
import {renderMetrics} from '../src/render-metrics.js';
import {changePassage} from '../src/passage-takes.js';
import {createSpeechReviewEditor} from '../src/speech-review-editor.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
globalThis.IDBKeyRange=IDBKeyRange;
globalThis.Option=class{constructor(text,value){this.textContent=text;this.value=value;}};
const fake=(source,pronunciation=null)=>({key:'synthetic',source,spoken:spokenPassage(source,pronunciation).text,pronunciation,anchor:{start:100}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
test('supplied transcript flags candidate omission, substitution, extra and repeated words with exact source offsets',async()=>{
 const snapshot=fake('Paul spoke with hope.');
 for(const [transcript,kind,expected] of [['Paul with hope.','possible-omission','spoke'],['Paul spoke with faith.','possible-substitution','hope'],['Paul gently spoke with hope.','possible-extra',''],['Paul Paul spoke with hope.','possible-repetition','']]){
  const result=await compareTranscript(snapshot,transcript);assert.ok(result.findings.some(f=>f.kind===kind&&f.expected===expected),JSON.stringify(result.findings));assert.equal(result.audioVerified,false);assert.equal(result.automaticTranscription,false);
  for(const f of result.findings)if(f.expected)assert.equal(snapshot.source.slice(f.sourceStart-100,f.sourceEnd-100),f.expected);
 }
 const phrase=await compareTranscript(fake('Give thanks.'),'Give thanks give thanks.');assert.ok(phrase.findings.some(f=>f.kind==='possible-repetition'));
});
test('punctuation, case, NFC and intended pronunciation alternatives do not become acoustic claims',async()=>{
 for(const [source,transcript] of [["Paul’s hope.","PAULS HOPE!"],['José spoke.','Jose\u0301 SPOKE!'],['Hope, love; faith.','hope love faith']]){
  const result=await compareTranscript(fake(source),transcript);assert.equal(result.candidateCount,0);assert.equal(result.audioVerified,false);
 }
 const pronunciation=parsePronunciation('John Mark => jahn mark\nNebuchadnezzar => neb-uh-kad-NEZ-er'),snapshot=fake('John Mark met Nebuchadnezzar.',pronunciation);
 for(const transcript of ['John Mark met Nebuchadnezzar.','JAHN MARK met neb uh kad NEZ er.','John Mark met neb-uh-kad-NEZ-er.'])assert.equal((await compareTranscript(snapshot,transcript)).candidateCount,0);
 const changed=await compareTranscript(snapshot,'John Luke met Nebuchadnezzar.');assert.ok(changed.findings.some(f=>f.kind==='possible-substitution'&&f.expected==='John Mark'));
 const v2=parsePronunciation('a-a => X'),v1={...v2,matcher:LEGACY_PRONUNCIATION_MATCHER};assert.equal((await compareTranscript(fake('xa-a-a',v2),'xa X')).candidateCount,0);assert.ok((await compareTranscript(fake('xa-a-a',v1),'xa X')).candidateCount>0);
});
test('input bounds, explicit no-words observation, truncation and cooperative cancellation are enforced',async()=>{
 for(const transcript of ['',null,'x'.repeat(4001),'\ud800','word\0','!!!','a '.repeat(513)])await assert.rejects(compareTranscript(fake('Paul spoke.'),transcript));
 await assert.rejects(compareTranscript(fake('Paul spoke.'),'Paul',{noWordsHeard:true}),/Clear/);
 const empty=await compareTranscript(fake('Paul spoke.'),'',{noWordsHeard:true});assert.equal(empty.summary['possible-omission'],2);assert.equal(empty.audioVerified,false);
 const many=await compareTranscript(fake('a '.repeat(200)),'',{noWordsHeard:true});assert.equal(many.candidateCount,200);assert.equal(many.findings.length,128);assert.equal(many.truncated,true);
 const gate=deferred(),started=deferred(),controller=new AbortController(),pending=compareTranscript(fake('a '.repeat(100)),'b '.repeat(200),{signal:controller.signal,yieldTask:async()=>{started.resolve();await gate.promise;}});await started.promise;controller.abort();gate.resolve();await assert.rejects(pending,{name:'AbortError'});
});
const config={voice:'af_sarah',edition:'refined',delivery:'natural',speed:1,pipeline:FOUNDATION_PIPELINE};
function audio(job,text,level=.1){const samples=new Float32Array(2400).fill(level);return {bytes:quantizePcm(samples),sampleCount:2400,sampleRate:24000,channels:1,format:'pcm-s16le',seconds:.1,renderManifest:job.settings.renderManifest,...(job.settings.pronunciation?{spokenText:spokenPassage(text,job.settings.pronunciation).text}:{}),metrics:renderMetrics({started:0,synthesized:10,finished:11,audio:{samples,sampleRate:24000,runtime:{provider:'cpu',dtype:'q8',loadMs:2,inferenceMs:7,modelLoadAttempts:1,retries:0}},outputSeconds:.1,format:'pcm-s16le',engine:'kokoro'})};}
async function fixture(){const store=await openStorage(indexedDB,'review-audio-'+crypto.randomUUID());let job=await makeRecording('First exact words.\n\nMiddle exact words.\n\nFinal exact words.',config);await store.ensureJob(job);await store.saveDraft({text:'Preserved private draft'});await store.claim('owner');while(job.next<job.passages.length){const p=job.passages[job.next];job=await store.commit(job.id,job.next,audio(job,job.source.slice(p.start,p.end)),'owner');}return {store,job};}
const record=(snapshot,comparison=null)=>({schema:1,snapshot,transcript:comparison?.transcript??'',noWordsHeard:comparison?.noWordsHeard??false,listenedByUser:false,notes:'Manual note',comparison,automaticTranscription:false,audioVerified:false,savedAt:1});
test('review anchors exact immutable passage/take/revision/audio and cannot migrate across regeneration or undo',async()=>{
 const {store,job}=await fixture(),before=await store.job(job.id),snapshot=await captureReview(store,job.id,1),result=await compareTranscript(snapshot,'Middle words.');
 assert.equal(snapshot.source,'Middle exact words.\n\n');assert.equal(snapshot.anchor.start,job.passages[1].start);assert.equal(snapshot.chapterOffsetSeconds,.1);assert.match(snapshot.anchor.audioHash,/^[a-f0-9]{64}$/);assert.equal(reviewSelectionMatches(job,snapshot),true);
 const changed=await changePassage({store,id:job.id,index:1,owner:'owner',revision:0,generate:async text=>audio(job,text,.2)}),next=await captureReview(store,job.id,1);assert.notEqual(next.key,snapshot.key);assert.notEqual(next.anchor.audioHash,snapshot.anchor.audioHash);assert.equal(reviewSelectionMatches(changed,snapshot),false);
 const restored=await changePassage({store,id:job.id,owner:'owner',revision:1,action:'undo'}),undo=await captureReview(store,job.id,1);assert.equal(undo.anchor.audioHash,snapshot.anchor.audioHash);assert.notEqual(undo.key,snapshot.key);assert.equal(reviewSelectionMatches(restored,snapshot),false);assert.equal(result.anchor.selectionRevision,0);
 assert.equal((await store.draft()).text,'Preserved private draft');assert.equal((await store.job(job.id)).source,before.source);store.close();
});
test('review storage persists exact anchors/notes, rejects mismatched provenance and never changes audio',async()=>{
 const {store,job}=await fixture(),snapshot=await captureReview(store,job.id,1),comparison=await compareTranscript(snapshot,'Middle words.'),name='review-notes-'+crypto.randomUUID();let reviews=await openReviewStorage(indexedDB,name);const payload=record(snapshot,comparison);await reviews.save(payload);reviews.close();reviews=await openReviewStorage(indexedDB,name);assert.deepEqual(await reviews.load(snapshot),payload);
 await assert.rejects(reviews.save({...payload,snapshot:{...snapshot,spoken:'wrong'}}),/provenance/);await assert.rejects(reviews.save({...payload,comparison:{...comparison,snapshotKey:'other'}}),/frozen/);await assert.rejects(reviews.save({...payload,notes:'x'.repeat(1001)}),/Invalid/);
 await assert.rejects(reviews.save({...payload,transcript:'bad\0input',comparison:null}),/control/);assert.deepEqual(await reviews.load(snapshot),payload);
 const archive=await reviews.archive(job.id);assert.equal(archive.audioVerified,false);assert.equal(archive.automaticTranscription,false);assert.deepEqual(JSON.parse(JSON.stringify(archive)).reviews[0].comparison,comparison);await reviews.deleteJob(job.id);assert.equal((await reviews.archive(job.id)).reviews.length,0);assert.deepEqual(await store.job(job.id),job);reviews.close();store.close();
});
test('review archive cap rejects atomically and cancelled saves do not create records',async()=>{
 const {store,job}=await fixture(),base=await captureReview(store,job.id,0),reviews=await openReviewStorage(indexedDB,'review-budget-'+crypto.randomUUID());
 const comparison=await compareTranscript(base,'First exact words.');await assert.rejects(reviews.save(record(base,{...comparison,limitations:'x'.repeat(REVIEW_BYTES)})),/limit/);assert.equal((await reviews.archive(job.id)).reviews.length,0);
 for(let n=0;n<REVIEW_LIMIT;n++){const anchor={...base.anchor,selectionRevision:n},snapshot={...base,anchor,key:await digest(JSON.stringify(anchor))};await reviews.save(record(snapshot));}
 const anchor={...base.anchor,selectionRevision:REVIEW_LIMIT},next={...base,anchor,key:await digest(JSON.stringify(anchor))};await assert.rejects(reviews.save(record(next)),/limit/);assert.equal((await reviews.archive(job.id)).reviews.length,REVIEW_LIMIT);
 const controller=new AbortController();controller.abort();await assert.rejects(reviews.save(record(next),{signal:controller.signal}),{name:'AbortError'});assert.equal((await reviews.archive(job.id)).reviews.length,REVIEW_LIMIT);await reviews.remove(base);assert.equal((await reviews.archive(job.id)).reviews.length,REVIEW_LIMIT-1);reviews.close();store.close();
});
function elements(){const map=new Map();return id=>{if(!map.has(id))map.set(id,{value:'0',checked:false,textContent:'',options:[],listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},replaceChildren(...options){this.options=options;this.value=options[0]?.value??'';},add(option){this.options.push(option);},focus(){}});return map.get(id);};}
test('actual manual-review UI clears edited findings and marks changed take stale while retaining unsaved input',async()=>{
 const {store,job}=await fixture(),reviews=await openReviewStorage(indexedDB,'review-ui-'+crypto.randomUUID()),$=elements(),exports=[];let selected=job,selection=0,discard=false;
 const editor=createSpeechReviewEditor({$,getStore:()=>store,getJob:()=>selected,getSelection:()=>selection,isBusy:()=>false,onBusy:()=>{},onListen:()=>{},onRepair:()=>{},onExport:value=>exports.push(value),confirmDiscard:()=>discard,repository:reviews});await editor.update(job);
 $('review-transcript').value='First words.';$('review-transcript').listeners.input();await $('review-compare').onclick();assert.match($('review-findings').textContent,/possible omission/);assert.equal($('review-listened').checked,false);await $('review-save').onclick();
 $('review-transcript').value='First exact words.';$('review-transcript').listeners.input();assert.equal($('review-findings').textContent,'');await $('review-export').onclick();assert.equal(exports[0].comparison,null);assert.equal(exports[0].audioVerified,false);
 selected=await changePassage({store,id:job.id,index:0,owner:'owner',revision:0,generate:async text=>audio(job,text,.4)});selection++;await editor.update(selected);assert.equal($('review-transcript').value,'First exact words.');assert.equal($('review-save').disabled,true);assert.match($('review-status').textContent,/previous selection/);await $('review-refresh').onclick();assert.equal($('review-transcript').value,'First exact words.');discard=true;await $('review-refresh').onclick();assert.equal($('review-transcript').value,'');assert.match($('review-anchor').textContent,/revision 1/);assert.equal((await reviews.archive(job.id)).reviews.length,1);reviews.close();store.close();
});
test('Stop cancels pending compare without saving, and changed takes block old export',async()=>{
 const {store,job}=await fixture(),reviews=await openReviewStorage(indexedDB,'review-ui-stale-'+crypto.randomUUID()),$=elements(),gate=deferred(),started=deferred();let delay=false,selected=job,selection=0,publications=0;
 const wrapper={...store,job:async id=>{if(delay){delay=false;started.resolve();await gate.promise;}return store.job(id);}};
 const editor=createSpeechReviewEditor({$,getStore:()=>wrapper,getJob:()=>selected,getSelection:()=>selection,isBusy:()=>false,onBusy:()=>{},onListen:()=>{},onRepair:()=>{},onExport:()=>publications++,repository:reviews,confirmDiscard:()=>true});await editor.update(job);
 $('review-transcript').value='First words.';$('review-transcript').listeners.input();delay=true;const pending=$('review-compare').onclick();await started.promise;editor.cancel();gate.resolve();await pending;assert.equal($('review-findings').textContent,'');assert.equal((await reviews.archive(job.id)).reviews.length,0);assert.equal(editor.busy,false);
 selected=await changePassage({store,id:job.id,index:0,owner:'owner',revision:0,generate:async text=>audio(job,text,.2)});selection++;await editor.update(selected);await $('review-export').onclick();assert.equal(publications,0);assert.equal($('review-save').disabled,true);reviews.close();store.close();
});
test('take change during deferred comparison prevents late old findings and keeps old transcript input',async()=>{
 const {store,job}=await fixture(),reviews=await openReviewStorage(indexedDB,'review-race-'+crypto.randomUUID()),$=elements(),gate=deferred(),started=deferred();let selected=job,selection=0,delay=false;
 const wrapper={...store,job:async id=>{if(delay){delay=false;started.resolve();await gate.promise;}return store.job(id);}};
 const editor=createSpeechReviewEditor({$,getStore:()=>wrapper,getJob:()=>selected,getSelection:()=>selection,isBusy:()=>false,onBusy:()=>{},onListen:()=>{},onRepair:()=>{},onExport:()=>{throw Error('must not export');},repository:reviews});await editor.update(job);$('review-transcript').value='First words.';$('review-transcript').listeners.input();delay=true;
 const pending=$('review-compare').onclick();await started.promise;selected=await changePassage({store,id:job.id,index:0,owner:'owner',revision:0,generate:async text=>audio(job,text,.2)});selection++;await editor.update(selected);gate.resolve();await pending;
 assert.equal($('review-findings').textContent,'');assert.equal($('review-transcript').value,'First words.');assert.equal($('review-save').disabled,true);assert.equal((await reviews.archive(job.id)).reviews.length,0);reviews.close();store.close();
});
test('review loads after another operation finishes and restores saved manual notes on a new editor instance',async()=>{
 const {store,job}=await fixture(),reviews=await openReviewStorage(indexedDB,'review-ready-'+crypto.randomUUID()),$=elements(),loaded=deferred();let busy=true;
 const repository={...reviews,load:async snapshot=>{const result=await reviews.load(snapshot);loaded.resolve();return result;}};
 const options={getStore:()=>store,getJob:()=>job,getSelection:()=>0,isBusy:()=>busy,onBusy:()=>{},onListen:()=>{},onRepair:()=>{},onExport:()=>{},repository};const editor=createSpeechReviewEditor({...options,$});await editor.update(job);editor.controls();assert.equal($('review-compare').disabled,true);busy=false;editor.controls();await loaded.promise;await new Promise(resolve=>setImmediate(resolve));assert.equal($('review-source').textContent,'First exact words.\n\n');
 $('review-transcript').value='First words.';$('review-transcript').listeners.input();await $('review-compare').onclick();$('review-notes').value='Listen again before any repair.';await $('review-save').onclick();
 const other=elements(),reloaded=createSpeechReviewEditor({...options,$:other,repository:reviews});await reloaded.update(job);assert.equal(other('review-transcript').value,'First words.');assert.equal(other('review-notes').value,'Listen again before any repair.');assert.match(other('review-findings').textContent,/possible omission/);assert.equal(other('review-listened').checked,false);reviews.close();store.close();
});
test('confirmed recording deletion removes review metadata first and preserves audio if that cleanup fails',async()=>{
 const main=await readFile('src/main.js','utf8'),handler=main.split('\n').find(line=>line.startsWith("$('delete-recording').onclick="));assert.ok(handler);
 for(const fail of [false,true]){const calls=[],context=vm.createContext({$:()=>({value:'recording'}),confirm:()=>true,beginSelection:()=>{},speechReview:{deleteJob:async id=>{calls.push('reviews:'+id);if(fail)throw Error('review cleanup failed');}},store:{deleteJob:async id=>calls.push('audio:'+id)},selectedJob:null,refreshLibrary:async()=>{},status:()=>{},warn:error=>error.message});
  vm.runInContext(handler+"\nglobalThis.remove=()=>$('delete-recording').onclick();",context);
  // Keep the assigned element stable, as the real document does.
  const element={value:'recording'};context.$=()=>element;vm.runInContext(handler,context);await context.remove();assert.deepEqual(calls,fail?['reviews:recording']:['reviews:recording','audio:recording']);
 }
});
test('actual main controls expose Stop for a pending manual review with synthesis/export idle',async()=>{
 const main=await readFile('src/main.js','utf8'),controls=main.slice(main.indexOf('const busy='),main.indexOf('const audition=')),stop=main.split('\n').find(line=>line.startsWith("$('stop').onclick=")),elements=new Map();let cancelled=0;
 const $=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);};const review={busy:true,controls(){},cancel(){cancelled++;this.busy=false;}};
 const context=vm.createContext({$,speechReview:review,document:{querySelectorAll:()=>[]},podcastHandoff:()=>{},chapterCache:{preparing:false},killWorker:()=>{},cancelPreparations:()=>{},status:()=>{},audition:{stop(){}},window:{}});
 vm.runInContext(`let creating=false,auditionBusy=false,importing=false,quick=false,exporting=false,pauseRequested=false,quickPaused=false,playbackController=null,renderToken=0,selectedJob={next:1,passages:[{}]};${controls}\n${stop}\ncontrols();`,context);
 assert.equal($('stop').disabled,false);assert.equal($('stop').textContent,'Cancel review operation');assert.equal($('download').disabled,true);$('stop').onclick();assert.equal(cancelled,1);
});
