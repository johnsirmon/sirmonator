export const PCM_REVIEW_METHOD='pcm-review-v1';
export const PCM_REVIEW_NOTE='Review hints only, not proof of omitted words, clipping or poor sound. Quiet spans include deliberate and engine pauses. PCM16 measurements cannot detect non-finite or over-range values before quantization. No audio is corrected or rejected by these diagnostics.';
const rates=[22050,24000,44100,48000],quiet=.001,nearFullScale=.999,longQuietSeconds=3;

// Constant-memory, single-pass statistics; chunks never need concatenation.
export function createPcmReviewStats({sampleRate,domain='pcm-s16le'}={}){
 if(!rates.includes(sampleRate)||!['pcm-s16le','float32'].includes(domain))throw Error('Unsupported PCM review format.');
 let sampleCount=0,nonFiniteSamples=0,quietSamples=0,quietRun=0,longestQuietSamples=0,nearFullScaleSamples=0,outOfRangeSamples=0,peak=0,scale=0,sumSquares=1;
 function add(value){
  if(!Number.isSafeInteger(++sampleCount))throw Error('PCM review sample limit exceeded.');
  if(!Number.isFinite(value)){nonFiniteSamples++;quietRun=0;return;}
  const amplitude=Math.abs(value);peak=Math.max(peak,amplitude);
  if(amplitude>0){if(scale<amplitude){sumSquares=1+sumSquares*(scale/amplitude)**2;scale=amplitude;}else sumSquares+=(amplitude/scale)**2;}
  if(amplitude<=quiet){quietSamples++;longestQuietSamples=Math.max(longestQuietSamples,++quietRun);}else quietRun=0;
  if(amplitude>=nearFullScale)nearFullScaleSamples++;if(amplitude>1)outOfRangeSamples++;
 }
 return {
  addPcm16(bytes){if(!(bytes instanceof ArrayBuffer)||bytes.byteLength%2)throw Error('Invalid PCM review bytes.');const view=new DataView(bytes);for(let offset=0;offset<view.byteLength;offset+=2)add(view.getInt16(offset,true)/32768);},
  addFloat32(samples){for(const value of samples)add(value);},
  finish(){
   const finiteSamples=sampleCount-nonFiniteSamples,allNearSilence=sampleCount>0&&quietSamples===sampleCount,longQuietSpan=longestQuietSamples>=sampleRate*longQuietSeconds;
   const reviewHints=[];if(allNearSilence)reviewHints.push('all-near-silence');if(longQuietSpan)reviewHints.push('long-quiet-span-may-be-intentional');if(nearFullScaleSamples)reviewHints.push('near-full-scale-not-clipping-proof');if(nonFiniteSamples)reviewHints.push('non-finite-input');if(outOfRangeSamples)reviewHints.push('over-range-float-input');
   return {schema:1,method:PCM_REVIEW_METHOD,status:'measured',domain,sampleRate,sampleCount,seconds:sampleCount/sampleRate,finiteSamples,nonFiniteSamples,peak:finiteSamples?peak:null,rms:finiteSamples?scale*Math.sqrt(sumSquares/finiteSamples):null,quietSamples,longestQuietSamples,longestQuietSeconds:longestQuietSamples/sampleRate,nearFullScaleSamples,outOfRangeSamples,allNearSilence,longQuietSpan,thresholds:{quietAmplitude:quiet,nearFullScaleAmplitude:nearFullScale,longQuietSeconds},rawFloatNonFiniteSamples:domain==='float32'?nonFiniteSamples:null,includesIntentionalPauses:true,reviewHints,note:PCM_REVIEW_NOTE};
  },
 };
}
export function validPcmReview(value){
 if(!value||value.schema!==1||value.method!==PCM_REVIEW_METHOD||value.status!=='measured'||!['pcm-s16le','float32'].includes(value.domain)||!rates.includes(value.sampleRate))return false;
 for(const key of ['sampleCount','finiteSamples','nonFiniteSamples','quietSamples','longestQuietSamples','nearFullScaleSamples','outOfRangeSamples'])if(!Number.isSafeInteger(value[key])||value[key]<0||value[key]>value.sampleCount)return false;
 if(value.finiteSamples+value.nonFiniteSamples!==value.sampleCount||value.quietSamples>value.finiteSamples||value.longestQuietSamples>value.quietSamples)return false;
 if(value.seconds!==value.sampleCount/value.sampleRate||value.longestQuietSeconds!==value.longestQuietSamples/value.sampleRate)return false;
 if(value.nearFullScaleSamples>value.finiteSamples||value.outOfRangeSamples>value.finiteSamples)return false;
 if(value.finiteSamples){if(!Number.isFinite(value.peak)||!Number.isFinite(value.rms)||value.rms<0||value.peak+1e-12<value.rms)return false;}else if(value.peak!==null||value.rms!==null)return false;
 return Array.isArray(value.reviewHints)&&value.reviewHints.length<=5&&value.includesIntentionalPauses===true;
}

// Decorate the existing codec, rather than changing encoding or render inputs.
// Diagnostics failure never changes the original worker response or PCM bytes.
export function installPcmReviewWorker(scope,{createStats=createPcmReviewStats,now=()=>performance.now()}={}){
 const encode=scope.onmessage,post=scope.postMessage.bind(scope);let stats=null,analysisMs=0;
 scope.onmessage=event=>{
  try{const start=now(),data=event.data;if(data.type==='start'){stats=createStats({sampleRate:data.sampleRate});analysisMs=0;}else if(data.type==='part')stats?.addPcm16(data.bytes);analysisMs+=now()-start;}catch{stats=null;}
  return encode(event);
 };
 scope.postMessage=(data,transfer)=>{
  if(data.type==='finish'&&data.metrics&&!data.error){
   let pcmReview={schema:1,method:PCM_REVIEW_METHOD,status:'unavailable',note:'Optional PCM review diagnostics unavailable. Audio was not changed.'};
   try{if(stats)pcmReview={...stats.finish(),analysisMs};}catch{}
   try{data={...data,metrics:{...data.metrics,pcmReview}};}catch{}
  }
  return post(data,transfer);
 };
}
export function pcmReviewSummary(value){
 if(!validPcmReview(value))return 'PCM diagnostics not measured for this artifact. Prepare PCM audio to measure; older/legacy reports may have no measurement.';
 const levels=value.peak===null?'no finite samples':`peak ${value.peak.toFixed(3)}, RMS ${value.rms.toFixed(3)}`;
 return `PCM review: ${value.sampleCount.toLocaleString()} samples, ${value.seconds.toFixed(2)} s, ${levels}; ${value.reviewHints.length} review hints. Includes deliberate pauses; not a word or sound-quality check. Full details are in the render report.`;
}
export function withPcmReviewReport(report){
 const preparations=Array.isArray(report.preparations)?report.preparations.slice(-4):[];
 const artifacts=preparations.filter(item=>item&&item.through===report.passages.length&&item.takeRevision===(report.takeSelection?.revision??0)&&item.metrics?.pcmReview?.domain==='pcm-s16le'&&validPcmReview(item.metrics.pcmReview)).map(item=>({chapter:item.chapter,through:item.through,takeRevision:item.takeRevision,diagnostics:item.metrics.pcmReview}));
 return {...report,pcmReview:{schema:1,status:artifacts.length?'measured-artifacts':'not-measured',artifacts,note:PCM_REVIEW_NOTE,scope:'Only saved preparation measurements matching this committed prefix and take revision. Chapter measurements do not claim to cover the entire recording.'}};
}
