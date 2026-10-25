// Experimental Node route only. Never an accepted recording/resume pipeline.
export const CUSTOM_REFERENCE_CONTRACT=Object.freeze({
 schema:1,provider:'pocket-custom-reference-node-v1',artifact:'experimental-reference-pcm-v1',
 runtime:'onnxruntime-node-1.21.0-cpu',package:'pocket-tts-js-0.1.0',
 workerSha256:'0e2d18c0f309c42099c3a56c0c54e3cf31605bee457f62433b0644776dc606dc',
 modelInventorySha256:'25491f670771aa597ed59bd5693edac00d88f6ce208603099150186125d366bd',
 modelRevision:'c469236dbc5f68287fa2fbf175b66de3b80123af',language:'english_2026-04',
 sampleRate:24000,sampling:'upstream-v0.1.0-steps1-temperature0.7-eos-4',
 personalSynthesisEnabled:false,resumable:false
});
export function assertCustomReferenceContract(value){
 if(JSON.stringify(value)!==JSON.stringify(CUSTOM_REFERENCE_CONTRACT))throw Error('Unsupported custom-reference runtime contract. Recreate the experimental session.');
}
