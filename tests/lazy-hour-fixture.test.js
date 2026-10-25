import test from 'node:test';
import assert from 'node:assert/strict';
import {lazyHourFixture} from '../scripts/lazy-hour-fixture.mjs';
import {validateCheckpoint} from '../src/job-runner.js';
import {sha256Bytes} from '../src/asset-integrity.js';
test('lazy long-form fixture materializes bounded fresh PCM and rejects corruption at each position',async()=>{
 const fixture=await lazyHourFixture(6);await validateCheckpoint(fixture.store,fixture.job);assert.equal(fixture.reads.blobBytes,288000);assert.equal(fixture.reads.maxReadBytes,96000);
 for(const index of [0,1,2]){fixture.corrupt(index);await assert.rejects(validateCheckpoint(fixture.store,fixture.job),/integrity/);}fixture.corrupt(-1);
 const first=await fixture.parts[0].blob.arrayBuffer();new Uint8Array(first).fill(0);assert.equal(await sha256Bytes(await fixture.parts[0].blob.arrayBuffer()),fixture.parts[0].audioHash);
 fixture.select();assert.equal((await validateCheckpoint(fixture.store,fixture.job))[1].takeId,fixture.take.takeId);fixture.undo();assert.equal((await validateCheckpoint(fixture.store,fixture.job))[1].takeId,undefined);
});
test('hour fixture stays inside production manuscript limits without allocating logical PCM',async()=>{
 const fixture=await lazyHourFixture(3600);assert.equal(fixture.parts.length,1800);assert.ok(fixture.job.source.length<=150000);assert.equal(fixture.job.bytes,172800000);assert.equal(fixture.reads.blobReads,0);assert.equal(fixture.parts[1799].blob.size,96000);
});
