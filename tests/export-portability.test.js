import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {Mp3Encoder} from '@breezystack/lamejs';
import 'fake-indexeddb/auto';
import {encodeMp3,mp3Duration} from '../src/mp3.js';
import {makeRecording} from '../src/recording.js';
import {openStorage} from '../src/storage.js';
import {renderReport} from '../src/job-runner.js';
import {portableFilename} from '../src/export-safety.js';
import {episodePackage,packageZip,publicUrl,appleValidationUrl} from '../src/podcast.js';
const audioBytes=encodeMp3(Float32Array.from({length:2400},(_,i)=>.1*Math.sin(i/12)),24000,Mp3Encoder),audio=new Blob([audioBytes],{type:'audio/mpeg'});
const job={title:'Synthetic episode',episodeGuid:'urn:uuid:synthetic',source:'PRIVATE_SYNTHETIC_SOURCE',localPath:'C:/synthetic/not-exported',privateEmail:'private-synthetic@example.invalid',createdAt:Date.UTC(2026,0,1),next:1,passages:[{}],seconds:mp3Duration(audioBytes)};
const fields={showTitle:'Show <script>& " café',showDescription:'Description ]]> & more',author:'Synthetic & author',episodeTitle:'../../CON',episodeDescription:'Text <item> & "quoted"',language:'en',category:'Religion & Spirituality',explicit:'no',audioUrl:'https://cdn.example.com/audio.mp3?a=1&b=2',artworkUrl:'https://cdn.example.com/art.png',feedUrl:'https://feeds.example.com/rss.xml',websiteUrl:'https://www.example.com/'};

test('all download kinds use bounded portable stems including Windows reserved titles',async()=>{
 for(const title of ['CON','con','PRN','AUX','NUL','COM1','LPT9','COM¹','LPT²','../..','C:\\synthetic\\file','./a/b','🌍漢字','é'.repeat(10000),'a'.repeat(10000),'\u202eCON\u0000']){
  const stem=portableFilename(title);assert.ok(stem.length<=76);assert.match(stem,/^[a-z0-9-]+$/i);
  for(const suffix of ['.mp3','-source.txt','-reviewed-source.txt','-render-report.json','-podcast-preparation.zip','-manual-review-passage-150000-r9007199254740991.json']){const name=stem+suffix;assert.ok(new TextEncoder().encode(name).length<255);assert.ok(!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name));}
 }
 const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');assert.match(main,/import \{portableFilename as safeFilename\} from '\.\/export-safety\.js'/);
 assert.match(await readFile(new URL('../src/podcast.js',import.meta.url),'utf8'),/portableFilename as safeFilename/);
});

test('ZIP rejects traversal, absolute, reserved, duplicate and malformed entry names',()=>{
 for(const name of ['../outside.mp3','/absolute.mp3','C:\\outside.mp3','folder/file.mp3','folder\\file.mp3','..','.','NUL.mp3','COM¹.mp3','bad\u0000.mp3','bad\ud800.mp3','trailing.','trailing ','a'.repeat(256)])assert.throws(()=>packageZip([{name,data:new Uint8Array([1])}]),/portable single-file names/);
 assert.throws(()=>packageZip([{name:'Audio.mp3',data:''},{name:'audio.mp3',data:''}]),/unique/);
 assert.throws(()=>packageZip(new Array(65536)),/Too many/);
});

test('valid UTF-8 archive names preserve bytes with valid CRC and no unsafe original entries',async()=>{
 const name='café-漢字-🌍.txt',data=new TextEncoder().encode('Original\r\nUnicode 🌍 and zero \u0000 byte');
 const zip=await JSZip.loadAsync(await packageZip([{name,data}]).arrayBuffer(),{checkCRC32:true});
 assert.deepEqual(Object.keys(zip.files),[name]);assert.equal(zip.files[name].unsafeOriginalName,name);assert.deepEqual(await zip.file(name).async('uint8array'),data);
});

test('saved title and GUID controls and incomplete metadata Unicode fail before reading audio',async()=>{
 let reads=0;const unread={type:'audio/mpeg',arrayBuffer:async()=>{reads++;return audioBytes.buffer;}};
 for(const overrides of [{title:'bad\u0001title'},{episodeGuid:'bad\u0000guid'},{title:'bad\ud800title'},{episodeGuid:'bad\udfff'}])await assert.rejects(episodePackage({...job,...overrides},unread,fields),/control characters or incomplete Unicode/);
 await assert.rejects(episodePackage(job,unread,{...fields,author:'bad\ud800author'}),/control characters or incomplete Unicode/);assert.equal(reads,0);
});

test('hostile metadata produces parseable escaped RSS and a flat byte-preserving package',async()=>{
 const result=await episodePackage(job,audio,{...fields,privateExtra:'PRIVATE_SYNTHETIC_EXTRA'});
 const zip=await JSZip.loadAsync(await packageZip(result.files).arrayBuffer(),{checkCRC32:true});
 const mp3=Object.keys(zip.files).find(n=>n.endsWith('.mp3'));assert.equal(mp3,'sirmonator-CON.mp3');assert.deepEqual(await zip.file(mp3).async('uint8array'),audioBytes);
 for(const entry of Object.values(zip.files)){assert.equal(entry.name,entry.unsafeOriginalName);assert.ok(!/[\\/:]/.test(entry.name));if(!entry.name.endsWith('.mp3')){const text=await entry.async('string');for(const marker of ['PRIVATE_SYNTHETIC_SOURCE','PRIVATE_SYNTHETIC_EXTRA','private-synthetic@example.invalid','C:/synthetic/not-exported'])assert.ok(!text.includes(marker),entry.name);}}
 const xml=await zip.file('feed-draft.xml').async('string'),errors=[];
 const document=new DOMParser({errorHandler:{warning:message=>errors.push(message),error:message=>errors.push(message),fatalError:message=>errors.push(message)}}).parseFromString(xml,'application/xml');assert.deepEqual(errors,[]);
 assert.equal(document.getElementsByTagName('item').length,1);assert.equal(document.getElementsByTagName('script').length,0);assert.equal(document.getElementsByTagName('title')[0].textContent,fields.showTitle);assert.equal(document.getElementsByTagName('enclosure')[0].getAttribute('url'),fields.audioUrl);
});

test('URL handoff retains exact valid URLs but excludes synthetic local and credential URLs',async()=>{
 for(const value of ['file:///C:/synthetic/a.mp3','https://127.1/a','https://0x7f000001/a','https://[::1]/a','https://host.local/a','https://host.internal/a','https://synthetic:placeholder@cdn.example.com/a']){assert.equal(publicUrl(value),false);assert.throws(()=>appleValidationUrl(value));}
 assert.equal(new URL(appleValidationUrl(fields.feedUrl+'?a=1&b=2#part')).searchParams.get('submitfeed'),fields.feedUrl+'?a=1&b=2#part');
 const result=await episodePackage(job,audio,{...fields,audioUrl:'file:///C:/PRIVATE_SYNTHETIC_URL'});assert.equal(result.metadata.episode.audio.url,'');assert.ok(!result.files.some(f=>f.name==='feed-draft.xml'));assert.ok(!JSON.stringify(result.metadata).includes('PRIVATE_SYNTHETIC_URL'));
});

test('actual TXT handlers preserve original UTF-8 manuscript bytes through filename changes',async()=>{
 const text='\uFEFFOriginal <script> & café\r\n漢字 🌍\nspell => spoken\r\n',main=await readFile(new URL('../src/main.js',import.meta.url),'utf8'),nodes=new Map(),outputs=[];
 const $=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};$('text').value=text;$('title').value='CON';
 const context=vm.createContext({$,Blob,selectedJob:{title:'CON',source:text},safeFilename:portableFilename,saveFile:(blob,name)=>outputs.push({blob,name})});
 for(const id of ['backup-draft','transcript']){const handler=main.split('\n').find(line=>line.startsWith("$('"+id+"').onclick="));assert.ok(handler);vm.runInContext(handler,context);$(id).onclick();}
 for(const output of outputs){assert.ok(output.name.startsWith('sirmonator-CON'));assert.deepEqual(new Uint8Array(await output.blob.arrayBuffer()),new TextEncoder().encode(text));}
});

test('render report projects provenance without manuscript, local-path or unrelated saved fields',async()=>{
 const source='PRIVATE_SYNTHETIC_MANUSCRIPT 漢字 🌍',store=await openStorage(indexedDB,'export-report-'+crypto.randomUUID());
 try{const draft=await makeRecording(source,{voice:'af_sarah',edition:'refined',delivery:'natural',speed:1},'CON');await store.ensureJob(draft);await store.claim('owner');await store.commit(draft.id,0,{bytes:audioBytes,seconds:mp3Duration(audioBytes),sampleRate:24000},'owner');const saved=await store.job(draft.id),report=await renderReport(store,{...saved,localPath:'C:/PRIVATE_SYNTHETIC_PATH',privateEmail:'PRIVATE_SYNTHETIC_EMAIL',podcast:{unrelated:'PRIVATE_SYNTHETIC_EXTRA'}}),json=JSON.stringify(report);
  for(const marker of [source,'PRIVATE_SYNTHETIC_PATH','PRIVATE_SYNTHETIC_EMAIL','PRIVATE_SYNTHETIC_EXTRA'])assert.ok(!json.includes(marker));assert.equal(report.sourceHash,saved.sourceHash);assert.equal(report.sourceCharacters,source.length);assert.equal((await store.job(draft.id)).source,source);
 }finally{store.close();}
});
