import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {integrationOriginSource,guardedControlsEntry} from '../scripts/integration-origin.mjs';
for(const origin of ['https://johnsirmon.github.io','http://127.0.0.1:4197','https://127.0.0.1:4198','http://localhost:4198'])test('harness fails closed before controls/DB activity on '+origin,()=>{
 let imports=0,opens=0,writes=0;const handlers={};
 const context=vm.createContext({location:{origin},loadControls(){imports++;opens++;handlers.click=()=>writes++;}});
 const entry=guardedControlsEntry.replace(/^import[^\n]*\n/,'').replace("await import('./integration-controls-safe.js');",'loadControls();');
 assert.throws(()=>vm.runInContext(integrationOriginSource(4198).replaceAll('export ','')+'\n'+entry,context),/refused this origin/);assert.equal(imports,0);assert.equal(opens,0);assert.equal(writes,0);assert.deepEqual(Object.keys(handlers),[]);
});
test('correct isolated origin loads controls once, and every generated entry carries the same guard',async()=>{
 let imports=0;const context=vm.createContext({location:{origin:'http://127.0.0.1:4198'},loadControls(){imports++;}}),entry=guardedControlsEntry.replace(/^import[^\n]*\n/,'').replace("await import('./integration-controls-safe.js');",'loadControls();');
 vm.runInContext(integrationOriginSource(4198).replaceAll('export ','')+'\n'+entry,context);assert.equal(imports,1);
 const generator=await readFile('scripts/prepare-integration-harness.mjs','utf8');assert.match(generator,/integration-bootstrap\.js',`import '\.\/integration-origin\.js'/);assert.match(generator,/integration-controls-safe\.js',`import \{assertIntegrationOrigin\} from '\.\/integration-origin\.js'/);assert.match(generator,/writeFile\('\.cache\/integration-controls\.js',guardedControlsEntry\)/);
});
