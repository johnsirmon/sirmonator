import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {openStorage} from '../src/storage.js';
import {withFixtureLease} from '../scripts/fixture-lease.mjs';
test('fixture reclaims expired ownership after a deterministic 21-second export gap',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1000});const store=await openStorage(indexedDB,'fixture-lease-'+crypto.randomUUID());
 try{assert.equal(await store.claim('fixture'),true);t.mock.timers.tick(21000);let actions=0;await withFixtureLease(store,'fixture',async()=>{actions++;assert.equal(await store.claim('competitor'),false);});assert.equal(actions,1);}finally{store.close();}
});
test('fixture cannot reclaim another live owner or execute its protected mutation',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1000});const store=await openStorage(indexedDB,'fixture-conflict-'+crypto.randomUUID());
 try{await store.claim('fixture');t.mock.timers.tick(21000);assert.equal(await store.claim('competitor'),true);let actions=0;await assert.rejects(withFixtureLease(store,'fixture',async()=>actions++),/Fixture could not acquire/);assert.equal(actions,0);assert.equal(await store.claim('fixture'),false);}finally{store.close();}
});
