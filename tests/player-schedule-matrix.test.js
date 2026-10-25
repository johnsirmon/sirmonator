import {test} from 'node:test';
import assert from 'node:assert/strict';
import {playerScheduleMatrix} from '../scripts/player-schedule-matrix.mjs';
test('seeded deferred UI completions preserve acknowledged player identity and latest intent',async()=>{const report=await playerScheduleMatrix();assert.equal(report.passed,true);assert.equal(report.rows.length,8);});
