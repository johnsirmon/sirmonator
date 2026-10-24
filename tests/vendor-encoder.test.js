import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('replaceable browser MP3 encoder matches the pinned package with license and source notices',async()=>{
 const bundled=await readFile(new URL('../public/vendor/lamejs.js',import.meta.url)),installed=await readFile(new URL(import.meta.resolve('@breezystack/lamejs')));
 assert.deepEqual(bundled,installed);
 const notice=await readFile(new URL('../public/vendor/LAME-NOTICE.txt',import.meta.url),'utf8');assert.ok(notice.includes('@breezystack/lamejs 1.2.7'));assert.ok(notice.includes('LGPL-3.0'));assert.ok(notice.includes('lamejs-source.tar.gz'));assert.ok(notice.includes('https://lame.sourceforge.net/'));
 for(const name of ['GPL-3.0.txt','LGPL-3.0.txt'])assert.ok((await readFile(new URL('../public/vendor/'+name,import.meta.url))).length>7000);
});
