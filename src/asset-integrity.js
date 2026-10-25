export async function sha256Bytes(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function verifiedBytes(bytes,expected){
  if(!expected||bytes.byteLength!==expected.size||await sha256Bytes(bytes)!==expected.sha256)throw Object.assign(Error('Voice asset integrity check failed. No audio was created.'),{retryableGPU:false});
  return bytes;
}
