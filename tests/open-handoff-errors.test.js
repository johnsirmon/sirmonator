import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openHandoffErrors} from '../scripts/player-schedule-matrix.mjs';
test('Open reports active post-handoff read/flush/validation failures and suppresses superseded failures',async()=>{const report=await openHandoffErrors();assert.equal(report.passed,true);assert.equal(report.rows.length,16);});
