import assert from 'node:assert/strict';
// Read/export-heavy fixtures can outlive a lease between mutations. Reclaim
// through the real ownership API; never force another owner's live lease.
export async function withFixtureLease(store,owner,action){
 assert.equal(await store.claim(owner),true,'Fixture could not acquire its generation lease');
 return action();
}
