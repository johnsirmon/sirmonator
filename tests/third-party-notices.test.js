import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {build} from 'vite';
import {noticeAssets,thirdPartyNotices} from '../scripts/third-party-notices.mjs';

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
