import {test} from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import {Mp3Encoder} from '@breezystack/lamejs';
import {encodeMp3,mp3Duration} from '../src/mp3.js';
import {episodePackage,packageZip,publicUrl,appleValidationUrl,podcastReadiness,DISCLOSURE} from '../src/podcast.js';
import {openStorage} from '../src/storage.js';
import {makeRecording} from '../src/recording.js';
import {recordingBlob} from '../src/job-runner.js';
const settings={voice:'af_sarah',edition:'refined',delivery:'natural',speed:1};
const bytes=encodeMp3(Float32Array.from({length:24000},(_,i)=>.2*Math.sin(2*Math.PI*440*i/24000)),24000,Mp3Encoder);
const fields={showTitle:'Faith & <hope> — café',showDescription:'Original "description"',author:'A & B',episodeTitle:'Hello <script>alert(1)</script>',episodeDescription:'Words & hope',language:'en',category:'Religion & Spirituality',explicit:'no',audioUrl:'https://cdn.example.com/audio.mp3?a=1&b=2',artworkUrl:'https://cdn.example.com/cover.jpg',feedUrl:'https://podcasts.example.com/feed.xml',websiteUrl:'https://www.example.com/'};
async function fixture(){const store=await openStorage(indexedDB,'podcast-'+crypto.randomUUID()),job=await makeRecording('Synthetic test manuscript. Do not rewrite this text.',settings);await store.ensureJob(job);await store.claim('owner');await store.commit(job.id,0,{bytes,seconds:mp3Duration(bytes),sampleRate:24000},'owner');await store.podcastGuid(job.id);return {store,job:await store.job(job.id)};}

test('episode ZIP contains byte-identical MP3, XML escaped RSS and separate disclosure without changing manuscript',async()=>{
 const {store,job}=await fixture(),original=job.source,{blob}=await recordingBlob(store,job),result=await episodePackage(job,blob,fields);
 const zip=await JSZip.loadAsync(await packageZip(result.files).arrayBuffer(),{checkCRC32:true});
 assert.equal(Object.keys(zip.files).length,5);
 const mp3=Object.keys(zip.files).find(name=>name.endsWith('.mp3'));assert.deepEqual(await zip.file(mp3).async('uint8array'),bytes);
 const metadata=JSON.parse(await zip.file('metadata.json').async('string'));assert.equal(metadata.episode.audio.bytes,bytes.length);assert.equal(metadata.episode.audio.durationSeconds,mp3Duration(bytes));assert.equal(metadata.guid,job.episodeGuid);
 const xml=await zip.file('feed-draft.xml').async('string');assert.match(xml,/xmlns:itunes=/);assert.match(xml,/Faith &amp; &lt;hope&gt; — café/);assert.ok(!xml.includes('<script>'));assert.ok(xml.includes('&lt;script&gt;'));assert.ok(xml.includes('a=1&amp;b=2'));assert.ok(xml.includes(`length="${bytes.length}" type="audio/mpeg"`));assert.ok(xml.includes(new Date(job.createdAt).toUTCString()));assert.ok(xml.includes(job.episodeGuid));
 assert.equal(job.source,original);assert.equal(metadata.rightsConfirmed,false);assert.equal(metadata.spokenDisclosureConfirmed,false);assert.ok(metadata.episode.description.includes(DISCLOSURE));store.close();
});

test('episode GUID persists through reload, repeated exports and independent concurrent reads',async()=>{
 const {store,job}=await fixture(),id=job.id,name='identity-'+crypto.randomUUID();store.close();
 let saved=await openStorage(indexedDB,name);await saved.ensureJob(job);const ids=await Promise.all([saved.podcastGuid(id),saved.podcastGuid(id)]);assert.equal(ids[0],ids[1]);saved.close();saved=await openStorage(indexedDB,name);assert.equal(await saved.podcastGuid(id),job.episodeGuid);saved.close();
});

test('incomplete, mislabeled and damaged audio cannot become an episode; missing hosting stays a local package',async()=>{
 const {store,job}=await fixture();await assert.rejects(episodePackage({...job,next:0},new Blob([bytes],{type:'audio/mpeg'}),fields),/Partial/);
 await assert.rejects(episodePackage(job,new Blob([bytes],{type:'audio/wav'}),fields),/actual MP3/);
 await assert.rejects(episodePackage(job,new Blob([bytes.slice(0,-1)],{type:'audio/mpeg'}),fields),/Incomplete/);
 const result=await episodePackage(job,new Blob([bytes],{type:'audio/mpeg'}),{});assert.equal(result.files.length,4);assert.ok(!result.files.some(f=>f.name.endsWith('.xml')));assert.ok(result.metadata.warnings.some(w=>w.includes('rights')));assert.ok(result.metadata.warnings.some(w=>w.includes('audible')));assert.ok(result.metadata.warnings.some(w=>w.includes('not measured')));store.close();
});

test('public URL and encoded Apple handoff reject local URLs and credentials without network access',()=>{
 for(const url of ['blob:https://host.com/id','data:audio/mp3,test','file:///C:/test.mp3','http://host.com/feed','https://localhost/feed','https://127.0.0.1/feed','https://192.168.1.2/feed','https://[::1]/feed','https://site.local/feed','https://name:secret@host.com/feed','https://2130706433/feed']){assert.equal(publicUrl(url),false,url);assert.throws(()=>appleValidationUrl(url));}
 assert.equal(publicUrl(fields.feedUrl),true);assert.equal(new URL(appleValidationUrl(fields.feedUrl+'?a=1&b=2')).searchParams.get('submitfeed'),fields.feedUrl+'?a=1&b=2');
 assert.ok(podcastReadiness({}).length>=12);
});

test('long export uses one ordered storage snapshot and preserves MP3 bytes; missing or reordered parts fail',async()=>{
 const {store,job}=await fixture();let reads=0;
 const measured={...store,parts:async id=>{reads++;return store.parts(id);},part:async()=>{throw Error('Unexpected individual read');}};
 const result=await recordingBlob(measured,job);assert.equal(reads,1);assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),bytes);
 const part=(await store.parts(job.id))[0];await assert.rejects(recordingBlob({...store,parts:async()=>[{...part,index:3}]},job),/integrity/);store.close();
});

test('ordered export snapshot remains valid when generation appends more audio',async()=>{
 const store=await openStorage(indexedDB,'append-'+crypto.randomUUID()),job=await makeRecording('One original passage.\n\nTwo original passages.',settings);await store.ensureJob(job);await store.claim('owner');
 const first=await store.commit(job.id,0,{bytes,seconds:mp3Duration(bytes),sampleRate:24000},'owner');await store.commit(job.id,1,{bytes,seconds:mp3Duration(bytes),sampleRate:24000},'owner');
 const result=await recordingBlob(store,first);assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),bytes);store.close();
});

test('podcast metadata survives reopen without changing episode identity; XML control characters are rejected',async()=>{
 const {store,job}=await fixture();await store.savePodcast(job.id,fields);const saved=await store.job(job.id);assert.deepEqual(saved.podcast,fields);assert.equal(await store.podcastGuid(job.id),job.episodeGuid);
 await assert.rejects(episodePackage(job,new Blob([bytes],{type:'audio/mpeg'}),{...fields,showTitle:'Invalid\u0001XML'}),/control characters/);store.close();
});

test('preparation metadata cannot be mistaken for publication or platform approval',async()=>{
 const {store,job}=await fixture(),result=await episodePackage(job,new Blob([bytes],{type:'audio/mpeg'}),fields),metadata=result.metadata;
 assert.equal(metadata.publishedAt,undefined);assert.equal(metadata.proposedPublicationDate,new Date(job.createdAt).toISOString());
 assert.equal(metadata.status,'local preparation only; not published or platform validated');
 assert.deepEqual(metadata.episode.audio.sampleRates,[24000]);assert.deepEqual(metadata.episode.audio.channels,[1]);
 assert.ok(metadata.warnings.some(w=>w.includes('no 44.1/48 kHz resampling')));
 assert.ok(metadata.warnings.some(w=>w.includes('Loudness')&&w.includes('not measured')));
 assert.ok(metadata.warnings.some(w=>w.includes('artwork dimensions')&&w.includes('not been verified')));
 assert.ok(!DISCLOSURE.includes('reviewed by its author'));store.close();
});

test('credential URLs are rejected before audio reads or artifact creation for every hosting field',async()=>{
 const {store,job}=await fixture();let reads=0;
 const audio={type:'audio/mpeg',arrayBuffer:async()=>{reads++;return bytes.buffer;}};
 for(const key of ['audioUrl','artworkUrl','feedUrl','websiteUrl']){
  await assert.rejects(episodePackage(job,audio,{...fields,[key]:'https://demo-user:demo-secret@host.example.com/file'}),error=>/embedded credentials/.test(error.message)&&!error.message.includes('demo-user')&&!error.message.includes('demo-secret'));
 }
 assert.equal(reads,0);store.close();
});

test('rejected hosting URLs never survive in any text entry of the preparation ZIP',async()=>{
 const {store,job}=await fixture();
 for(const key of ['audioUrl','artworkUrl','feedUrl','websiteUrl']){
  const invalid='malformed demo-user:demo-secret@not-a-public-host';
  const result=await episodePackage(job,new Blob([bytes],{type:'audio/mpeg'}),{...fields,[key]:invalid});
  const zip=await JSZip.loadAsync(await packageZip(result.files).arrayBuffer(),{checkCRC32:true});
  for(const entry of Object.values(zip.files))if(!entry.name.endsWith('.mp3')){
   const text=await entry.async('string');assert.ok(!text.includes('demo-secret'),entry.name);assert.ok(!text.includes('demo-user'),entry.name);assert.ok(!text.includes(invalid),entry.name);
  }
 }
 store.close();
});
