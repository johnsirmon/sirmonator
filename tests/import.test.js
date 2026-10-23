import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import mammoth from 'mammoth';
test('Word import extracts fixture sermon without adding or losing words',async()=>{
 const buffer=await readFile(new URL('./fixtures/sermon.docx',import.meta.url));
 const expected=await readFile(new URL('./fixtures/sermon.txt',import.meta.url),'utf8');
 const result=await mammoth.extractRawText({buffer});
 assert.equal(result.value.trim(),expected);assert.deepEqual(result.messages,[]);
});
