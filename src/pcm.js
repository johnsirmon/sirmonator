export function decodePcmWav(buffer){
  const view=new DataView(buffer),tag=p=>String.fromCharCode(...new Uint8Array(buffer,p,4));
  if(buffer.byteLength<44||tag(0)!=='RIFF'||tag(8)!=='WAVE')throw Error('Invalid reference WAV');
  let sampleRate,channels,bits,format,dataOffset,dataLength;
  for(let offset=12;offset+8<=buffer.byteLength;){
    const length=view.getUint32(offset+4,true),kind=tag(offset),body=offset+8;
    if(body+length>buffer.byteLength)throw Error('Incomplete reference WAV');
    if(kind==='fmt '){format=view.getUint16(body,true);channels=view.getUint16(body+2,true);sampleRate=view.getUint32(body+4,true);bits=view.getUint16(body+14,true);}
    if(kind==='data'){dataOffset=body;dataLength=length;}
    offset=body+length+(length%2);
  }
  if(format!==1||bits!==16||!channels||!sampleRate||!dataLength)throw Error('Reference must be 16-bit PCM WAV');
  const frames=Math.floor(dataLength/(2*channels)),samples=new Float32Array(frames);
  for(let i=0;i<frames;i++)for(let c=0;c<channels;c++)samples[i]+=view.getInt16(dataOffset+(i*channels+c)*2,true)/32768/channels;
  return {samples,sampleRate};
}
export function concatenate(parts){
  const result=new Float32Array(parts.reduce((n,p)=>n+p.length,0));let position=0;
  for(const part of parts){result.set(part,position);position+=part.length;}return result;
}
