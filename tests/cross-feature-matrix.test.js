import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crossFeatureMatrix} from '../scripts/cross-feature-matrix.mjs';
test('seeded Unicode/PCM/takes/review/storage/export matrix preserves independent expectations',async()=>{
 const report=await crossFeatureMatrix();assert.equal(report.passed,true);assert.equal(report.recordingsReopened,2);
 for(const row of report.recordings){assert.ok(row.chapters>=2);assert.equal(row.finalTakeRevision,5);assert.equal(row.exports.length,7);assert.equal(row.originalTextPreserved,true);}
});
