// The LGPL encoder is loaded as a separate, replaceable module in public/vendor.
export function encodeMp3(samples,sampleRate,Encoder){
  if(![22050,24000,44100,48000].includes(sampleRate))throw Error('Unsupported recording sample rate.');
  const encoder=new Encoder(1,sampleRate,64),parts=[];let bytes=0;
  const keep=data=>{if(data.length){const part=new Uint8Array(data);parts.push(part);bytes+=part.length;}};
  for(let offset=0;offset<samples.length;offset+=1152){
    const slice=samples.subarray(offset,offset+1152),pcm=new Int16Array(slice.length);
    for(let i=0;i<slice.length;i++){if(!Number.isFinite(slice[i]))throw Error('The voice produced invalid audio.');const v=Math.max(-1,Math.min(1,slice[i]));pcm[i]=v<0?v*32768:v*32767;}
    keep(encoder.encodeBuffer(pcm));
  }
  keep(encoder.flush());const result=new Uint8Array(bytes);let offset=0;
  for(const part of parts){result.set(part,offset);offset+=part.length;}
  return result;
}
export function inspectMp3(bytes){
  let offset=0,seconds=0;const sampleRates=new Set(),channels=new Set();
  while(offset+4<=bytes.length){
    const a=bytes[offset],b=bytes[offset+1],c=bytes[offset+2];
    if(a!==255||(b&224)!==224||(b&6)!==2)throw Error('Invalid MP3 frame.');
    const version=(b>>3)&3,index=(c>>4)&15,rateIndex=(c>>2)&3;
    const rate=[44100,48000,32000][rateIndex]/(version===3?1:version===2?2:4);
    const bitrate=(version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[index];
    if(!rate||!bitrate||version===1)throw Error('Unsupported MP3 frame.');
    const length=Math.floor((version===3?144000:72000)*bitrate/rate)+((c>>1)&1);
    if(offset+length>bytes.length)throw Error('Incomplete MP3 frame.');
    sampleRates.add(rate);channels.add((bytes[offset+3]>>6)===3?1:2);seconds+=(version===3?1152:576)/rate;offset+=length;
  }
  if(offset!==bytes.length)throw Error('Incomplete MP3 recording.');
  return {seconds,sampleRates:[...sampleRates],channels:[...channels]};
}

export function mp3Duration(bytes){return inspectMp3(bytes).seconds;}
