export function integrationOriginSource(port){
 if(!Number.isSafeInteger(port)||port<4100||port>4999)throw Error('Invalid dedicated test port');
 return `export const REQUIRED_ORIGIN=${JSON.stringify('http://127.0.0.1:'+port)};\nexport function assertIntegrationOrigin(){if(globalThis.location?.origin!==REQUIRED_ORIGIN)throw Error('Integration harness refused this origin; no test controls were installed.');}\nassertIntegrationOrigin();\n`;
}
export const guardedControlsEntry="import {assertIntegrationOrigin} from './integration-origin.js';\nassertIntegrationOrigin();\nawait import('./integration-controls-safe.js');\n";
