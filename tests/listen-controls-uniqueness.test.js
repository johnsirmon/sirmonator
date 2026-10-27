import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html=await readFile('index.html','utf8');
test('merged reader has one Listen surface and preserves cloning, ASR and manual review controls',()=>{
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
 assert.equal(ids.length,new Set(ids).size,'Every document ID must be unique');
 for(const id of ['listen','local-cloning','review-asr','review-transcript','take-regenerate','download','audio','add-text','choose-voice','create-audio'])
  assert.equal(ids.filter(value=>value===id).length,1,id+' must occur exactly once');
 assert.equal((html.match(/src="\/src\/cloning\/bootstrap.js"/g)||[]).length,1);
});
