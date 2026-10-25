import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {writeFile} from 'node:fs/promises';
import {runSeededScenario} from './resilience-scenario.mjs';
import {createNodeExportWorker} from './export-node.mjs';
import {oracleEncode} from './resilience-oracle.mjs';
globalThis.IDBKeyRange=IDBKeyRange;
const runs=[];for(const seed of [0x19b04,0xc0ffee,0xdeadbeef])runs.push(await runSeededScenario({seed,steps:48,factory:indexedDB,createWorker:createNodeExportWorker,oracleEncode}));
const report={schema:1,kind:'Deterministic seeded storage/take/review/export scenarios, synthetic CC0 PCM only',runs,limits:'Fake-indexeddb plus production storage/take/review/codec APIs; bounded fixed seeds are not exhaustive proof, acoustic validation or phone testing.'};await writeFile('evidence/seeded-resilience.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,seeds:runs.map(r=>r.seed),steps:runs.reduce((n,r)=>n+r.steps,0),publications:runs.reduce((n,r)=>n+r.publications,0)}));
