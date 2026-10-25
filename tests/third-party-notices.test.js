import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import {noticeAssets,thirdPartyNotices} from '../scripts/third-party-notices.mjs';

test('notice evidence distinguishes canonical Git blobs from platform artifact bytes',async()=>{
 const evidence=JSON.parse(await readFile('evidence/shipped-notices-review.json','utf8')),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(evidence.schema,2);assert.equal(evidence.buildContext.platform,'win32');assert.match(evidence.buildContext.byteConvention,/No cross-platform artifact identity/);
 // This is an archived five-file Windows build, not a current inventory count.
 assert.equal(evidence.notices.length,5);for(const record of evidence.notices)assert.ok(noticeAssets.some(([source,target])=>source===record.source&&target===record.shipped));
 for(const record of evidence.notices){
  // HEAD also works in a shallow checkout; compare its bytes to the recorded
  // canonical digest rather than requiring the historical build commit locally.
  const canonical=execFileSync('git',['show','HEAD:'+record.source],{windowsHide:true}),checkout=await readFile(record.source);
  assert.equal(hash(canonical),record.canonicalGit.sha256);assert.equal(canonical.length,record.canonicalGit.bytes);
  assert.equal(checkout.toString('utf8').replaceAll('\r\n','\n'),canonical.toString('utf8'),'notice text changed beyond checkout line endings');
  assert.deepEqual(record.checkout,record.dist,'recorded build retained its own checkout bytes');
  // Evidence describes a Windows build. Verify its recorded CRLF hash without
  // assuming this test runner uses the same checkout line-ending policy.
  const windows=Buffer.from(canonical.toString('utf8').replaceAll('\n','\r\n'));
  assert.equal(hash(windows),record.checkout.sha256);assert.equal(windows.length,record.checkout.bytes);
 }
});

test('Kokoro runtime notice comes from the exact installed locked package, without assuming voice rights',async()=>{
 const installed=JSON.parse(await readFile('node_modules/kokoro-js/package.json','utf8')),lock=JSON.parse(await readFile('package-lock.json','utf8'));
 assert.equal(installed.version,'1.2.1');assert.equal(installed.version,lock.packages['node_modules/kokoro-js'].version);assert.equal(installed.license,'Apache-2.0');
 assert.ok(noticeAssets.some(([source,target])=>source==='node_modules/kokoro-js/LICENSE'&&target==='vendor/KOKORO-LICENSE.txt'));
 const notice=await readFile('public/vendor/THIRD-PARTY-NOTICES.html','utf8');assert.match(notice,/KOKORO-LICENSE\.txt/);assert.match(notice,/not a blanket voice license/);
});

test('development notice links serve the same canonical bytes without a catch-all route',async()=>{
 let handle;thirdPartyNotices().configureServer({middlewares:{use:handler=>handle=handler}});
 for(const [source,target] of noticeAssets){let actual,type;await handle({url:'/'+target+'?check=1'},{setHeader:(_name,value)=>type=value,end:bytes=>actual=bytes},()=>assert.fail('notice route fell through'));assert.deepEqual(actual,await readFile(source));assert.equal(type,'text/plain; charset=utf-8');}
 let fellThrough=false;await handle({url:'/vendor/../private-file'},{end:()=>assert.fail('unexpected route')},()=>fellThrough=true);assert.equal(fellThrough,true);
});

test('production build retains canonical notices and links beneath a Pages base',async()=>{
 // Dedicated new output; never empties an existing user directory. Kept in temp
 // for inspection if a build or assertion fails.
 const outDir=await mkdtemp(join(tmpdir(),'sirmonator-notices-'));
 await build({configFile:resolve('vite.config.js'),logLevel:'silent',build:{outDir,emptyOutDir:false}});
 for(const [source,target] of noticeAssets)assert.deepEqual(await readFile(join(outDir,target)),await readFile(source),target+' must retain exact canonical bytes');
 const html=await readFile(join(outDir,'index.html'),'utf8');
 assert.match(html,/href="\.\/vendor\/THIRD-PARTY-NOTICES\.html"/);
 const notice=await readFile(join(outDir,'vendor/THIRD-PARTY-NOTICES.html'),'utf8');
 const base=new URL('https://example.invalid/sirmonator/vendor/THIRD-PARTY-NOTICES.html');
 let localLinks=0;for(const match of notice.matchAll(/href="([^"]+)"/g)){
  if(/^https?:/.test(match[1]))continue;
  const url=new URL(match[1],base);assert.ok(url.pathname.startsWith('/sirmonator/'),'notice link escapes Pages base');
  let path=url.pathname.slice('/sirmonator/'.length);if(!path)path='index.html';
  assert.ok((await readFile(join(outDir,path))).length,'empty notice target');localLinks++;
 }
 assert.ok(localLinks>=10,'all license, source notice and return links checked');
 for(const phrase of ['SoundTouchJS 0.3.0','pocket-tts-js 0.1.0','Supertone copyright','LGPL 2.1','CC BY 4.0','do not establish redistribution permission','not been cleared for public distribution','release-readiness limitation'])assert.ok(notice.includes(phrase),'missing distinction: '+phrase);
});
