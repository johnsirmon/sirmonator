import {sha256Bytes} from './asset-integrity.js';
import {assertActive,abortable} from './continuity.js';
export const REFERENCE_FORMAT='wav-pcm16-mono-24000-v1',MAX_REFERENCE_BYTES=512*1024,MIN_REFERENCE_SECONDS=3,MAX_REFERENCE_SECONDS=10;
export async function inspectReferenceWav(buffer,{signal}={}){
 assertActive({signal});if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<44||buffer.byteLength>MAX_REFERENCE_BYTES)throw Error('Use a PCM WAV reference of at most 512 KiB.');
 const view=new DataView(buffer),tag=offset=>String.fromCharCode(...new Uint8Array(buffer,offset,4));
 if(tag(0)!=='RIFF'||tag(8)!=='WAVE'||view.getUint32(4,true)+8!==buffer.byteLength)throw Error('Invalid or unsupported RIFF/WAVE container. No conversion was performed.');
 let format=false,data=null,offset=12,chunks=0;
 while(offset<buffer.byteLength){
  if(++chunks>64||offset+8>buffer.byteLength)throw Error('Too many or incomplete WAV chunks.');
  const kind=tag(offset),size=view.getUint32(offset+4,true),start=offset+8,end=start+size;
  if(end+(size%2)>buffer.byteLength)throw Error('Incomplete WAV chunk.');
  if(kind==='fmt '){
   if(format||![16,18].includes(size))throw Error('Duplicate or unsupported WAV format chunk.');
   if(view.getUint16(start,true)!==1||view.getUint16(start+2,true)!==1||view.getUint32(start+4,true)!==24000||view.getUint32(start+8,true)!==48000||view.getUint16(start+12,true)!==2||view.getUint16(start+14,true)!==16||(size===18&&view.getUint16(start+16,true)!==0))throw Error('Reference must be mono, 24 kHz, 16-bit PCM WAV. No resampling or downmixing was performed.');
   format=true;
  }
  if(kind==='data'){if(!format||data||size%2)throw Error('Missing format, duplicate data or unaligned PCM.');data={start,size};}
  offset=end+(size%2);
 }
 if(!format||!data)throw Error('WAV format/audio data is missing.');
 const sampleCount=data.size/2,seconds=sampleCount/24000;
 if(seconds<MIN_REFERENCE_SECONDS||seconds>MAX_REFERENCE_SECONDS)throw Error('Use a reference from 3 to 10 seconds. Audio is never silently trimmed.');
 let sum=0,squares=0,peak=0,fullScaleSamples=0;
 for(let i=0;i<sampleCount;i++){const raw=view.getInt16(data.start+i*2,true),sample=raw/32768;sum+=sample;squares+=sample*sample;peak=Math.max(peak,Math.abs(sample));if(raw===-32768||raw===32767)fullScaleSamples++;}
 const dc=sum/sampleCount,rms=Math.sqrt(squares/sampleCount),acRms=Math.sqrt(Math.max(0,squares/sampleCount-dc*dc));
 if(peak<.005||acRms<.001)throw Error('Reference is silent, constant or too quiet for this bounded validator.');
 if(fullScaleSamples/sampleCount>.001)throw Error('Too many full-scale samples (over 0.1%). Choose a cleaner reference.');
 assertActive({signal});const [fileSha256,pcmSha256]=await abortable(Promise.all([sha256Bytes(buffer),sha256Bytes(new Uint8Array(buffer,data.start,data.size))]),signal);assertActive({signal});
 return {schema:1,format:REFERENCE_FORMAT,fileBytes:buffer.byteLength,fileSha256,pcmSha256,sampleRate:24000,channels:1,bits:16,sampleCount,seconds,signal:{peak,rms,acRms,dc,fullScaleSamples},speechVerified:false};
}
