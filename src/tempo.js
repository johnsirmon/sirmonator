import {SoundTouch,SimpleFilter} from 'soundtouchjs';
// WSOLA tempo adjustment changes pace without lowering pitch or formants.
export function changeTempo(input,speed=1,sampleRate=24000){
  if(speed===1)return input;
  if(!Number.isFinite(speed)||speed<.5||speed>2)throw Error('Invalid reading speed');
  const source={extract(target,count,position){
    // Padding flushes the time-stretcher so the last spoken word survives.
    const available=Math.max(0,Math.min(count,input.length+sampleRate-position));
    for(let i=0;i<available;i++)target[2*i]=target[2*i+1]=input[position+i]??0;
    return available;
  }};
  const sound=new SoundTouch();sound.stretch.setParameters(sampleRate,0,0,8);sound.tempo=speed;sound.pitch=1;
  const filter=new SimpleFilter(source,sound),stereo=new Float32Array(8192*2);
  const output=new Float32Array(Math.ceil(input.length/speed));let position=0;
  while(position<output.length){
    const frames=filter.extract(stereo,Math.min(8192,output.length-position));if(!frames)break;
    for(let i=0;i<frames;i++)output[position+i]=stereo[i*2];position+=frames;
  }
  return output;
}
