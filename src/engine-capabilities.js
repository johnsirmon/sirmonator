// Presets and bundled character conditioning are not personal voice enrollment.
const capabilities=Object.freeze({
 kokoro:Object.freeze({kind:'preset',local:true,personalReference:false}),
 supertonic:Object.freeze({kind:'preset',local:true,personalReference:false}),
 pocket:Object.freeze({kind:'bundled-reference',local:true,personalReference:false,referenceEncoderInCode:true}),
});
const referenceFields=['referenceAudio','referenceProfile','referencePlan','referenceId','referenceDigest','referenceVoice','referenceReceipt','referenceConsent','referenceConditioning'];
export function engineCapabilities(engine){if(!Object.hasOwn(capabilities,engine))throw Error('Unknown synthesis engine.');return capabilities[engine];}
export function assertEngineRequest(engine,settings){const capability=engineCapabilities(engine);if(referenceFields.some(key=>Object.hasOwn(settings??{},key)))throw Error('Personal reference synthesis is not enabled. A preset or bundled character cannot substitute for a requested clone.');return capability;}
