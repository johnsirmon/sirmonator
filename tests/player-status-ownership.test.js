import {test} from 'node:test';
import assert from 'node:assert/strict';
import {playerHarness} from '../scripts/player-schedule-matrix.mjs';
test('failed native-style refresh settles Preparing; retry clears inherited failure and acknowledges new revision',async()=>{
 const h=playerHarness();await h.show(h.remote.get('A'));h.remote.get('A').takeSelection={revision:1};
 const gate=h.hold('preparation'),pending=h.click('refresh-audio');await gate.started;gate.reject(Error('Refresh unavailable'));await pending;
 assert.equal(h.$('preparation-status').textContent,'Refresh unavailable');assert.equal(h.$('export-status').textContent,'Refresh unavailable');assert.equal(h.state().preparing,false);assert.equal(h.$('stop').disabled,true);assert.equal(h.state().selected.takeSelection.revision,0);await h.invariant('failed refresh');
 await h.click('refresh-audio');assert.equal(h.$('export-status').textContent,'');assert.match(h.$('preparation-status').textContent,/audio ready/);assert.equal(h.state().selected.takeSelection.revision,1);await h.invariant('successful retry');
});
test('Open retry clears its own read failure only after successful acknowledgement',async()=>{
 const h=playerHarness();await h.show(h.remote.get('A'));let reads=0;const gate=h.hold('read',m=>m.id==='B'&&++reads===2),pending=h.open('B');await gate.started;gate.reject(Error('B read failed'));await pending;assert.equal(h.$('status').textContent,'B read failed');
 await h.open('B');assert.equal(h.$('status').textContent,'');assert.match(h.$('preparation-status').textContent,/audio ready/);await h.invariant('Open retry');
});
test('successful unrelated recording does not clear another recording error',async()=>{
 const h=playerHarness();await h.show(h.remote.get('A'));const gate=h.hold('read',m=>m.id==='B'),pending=h.open('B');await gate.started;gate.reject(Error('B read failed'));await pending;
 await h.open('A');assert.equal(h.$('status').textContent,'B read failed');await h.invariant('unrelated Open');
});
test('retry preserves newer unrelated warnings written while preparation is pending',async()=>{
 const h=playerHarness();await h.show(h.remote.get('A'));const failed=h.hold('preparation'),first=h.click('refresh-audio');await failed.started;failed.reject(Error('Old preparation error'));await first;
 const gate=h.hold('preparation'),retry=h.click('refresh-audio');await gate.started;h.$('export-status').textContent='New storage warning';h.$('status').textContent='New draft warning';gate.resolve();await retry;
 assert.equal(h.$('export-status').textContent,'New storage warning');assert.equal(h.$('status').textContent,'New draft warning');await h.invariant('new warnings');
});
test('late failed refresh after Stop does not overwrite cancellation or newer warning',async()=>{
 const h=playerHarness();await h.show(h.remote.get('A'));const gate=h.hold('preparation'),pending=h.click('refresh-audio');await gate.started;await h.click('stop');h.$('export-status').textContent='New warning';const stopped=h.$('preparation-status').textContent;gate.reject(Error('Late error'));await pending;
 assert.equal(h.$('preparation-status').textContent,stopped);assert.equal(h.$('export-status').textContent,'New warning');await h.invariant('cancelled refresh');
});
