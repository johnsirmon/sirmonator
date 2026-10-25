import test from 'node:test';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {runSeededScenario} from '../scripts/resilience-scenario.mjs';
import {oracleEncode} from '../scripts/resilience-oracle.mjs';
import {createNodeExportWorker} from '../scripts/export-node.mjs';
globalThis.IDBKeyRange=IDBKeyRange;
for(const seed of [0x19b04,0xc0ffee,0xdeadbeef])test('seeded recording/take/review/export resilience seed '+seed,async()=>{
 await runSeededScenario({seed,steps:48,factory:indexedDB,createWorker:createNodeExportWorker,oracleEncode});
});
