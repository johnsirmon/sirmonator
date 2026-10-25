export function renderMetrics({started,synthesized,finished,audio,encodingMs=0,outputSeconds,format,engine}){
 const runtime=audio.runtime??{},audioSeconds=audio.samples.length/audio.sampleRate;
 return {schema:1,engine,provider:runtime.provider??'unknown',dtype:runtime.dtype??'unknown',
  renderMs:synthesized-started,loadMs:runtime.loadMs??null,inferenceMs:runtime.inferenceMs??null,
  postprocessMs:Math.max(0,finished-synthesized-encodingMs),encodingMs,totalMs:finished-started,
  modelLoadAttempts:runtime.modelLoadAttempts??null,retries:runtime.retries??null,
  modelState:runtime.modelLoadAttempts===0?'reused':runtime.modelLoadAttempts>0?'loaded-this-request':'unobserved',
  synthesisAudioSeconds:audioSeconds,outputAudioSeconds:outputSeconds,format,
  renderRTF:audioSeconds>0?(synthesized-started)/1000/audioSeconds:null,
  encoding:format==='pcm-s16le'?'deferred-to-artifact':'passage'};
}
export function validMetrics(m){
 if(!m||m.schema!==1||!['kokoro','supertonic','pocket','empty'].includes(m.engine)||!['webgpu','wasm','cpu','none','unknown'].includes(m.provider)||typeof m.dtype!=='string')return false;
 for(const key of ['renderMs','postprocessMs','encodingMs','totalMs','synthesisAudioSeconds','outputAudioSeconds'])if(!Number.isFinite(m[key])||m[key]<0)return false;
 for(const key of ['loadMs','inferenceMs','renderRTF'])if(m[key]!==null&&(!Number.isFinite(m[key])||m[key]<0))return false;
 for(const key of ['modelLoadAttempts','retries'])if(m[key]!==null&&(!Number.isInteger(m[key])||m[key]<0))return false;
 return ['pcm-s16le','mp3'].includes(m.format)&&['reused','loaded-this-request','unobserved'].includes(m.modelState);
}
export function validFrozenMetrics(m,engine,empty=false){
 return validMetrics(m)&&m.engine===(empty?'empty':engine)&&m.provider!=='unknown'&&m.dtype!=='unknown'&&
  m.modelLoadAttempts!==null&&m.retries!==null&&m.loadMs!==null&&m.inferenceMs!==null&&
  m.format==='pcm-s16le'&&m.encodingMs===0&&m.encoding==='deferred-to-artifact'&&
  m.totalMs>=m.renderMs&&m.renderMs+1e-6>=m.loadMs+m.inferenceMs;
}
export function metricsSummary(parts){
 const measured=parts.filter(p=>validMetrics(p.metrics)),sum=key=>measured.length&&measured.every(p=>p.metrics[key]!==null)?measured.reduce((n,p)=>n+p.metrics[key],0):null;
 return {passages:parts.length,measured:measured.length,missing:parts.length-measured.length,renderMs:sum('renderMs'),loadMs:sum('loadMs'),inferenceMs:sum('inferenceMs'),modelLoadAttempts:sum('modelLoadAttempts'),providers:[...new Set(measured.map(p=>p.metrics.provider))],note:'Measured successful passages only; cancelled/failed attempts are not retained. Render time includes loading. Timing does not measure spoken accuracy.'};
}
