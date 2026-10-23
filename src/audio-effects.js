// Resampling lowers pitch/formants. The TTS speed compensates before synthesis,
// so character voices retain the requested overall delivery pace.
export function characterEffect(input, sampleRate, profile={}){
  const pitch=profile.pitch??1;
  if(pitch===1&&!profile.grit&&!profile.bass&&!profile.metal)return input;
  const output=new Float32Array(Math.ceil(input.length/pitch));
  const alpha=1-Math.exp(-2*Math.PI*180/sampleRate);
  let low=0;
  const bass=(Math.pow(10,(profile.bass??0)/20)-1)*.55;
  for(let i=0;i<output.length;i++){
    const position=i*pitch,index=Math.floor(position),fraction=position-index;
    let sample=(input[index]??0)*(1-fraction)+(input[index+1]??0)*fraction;
    low+=alpha*(sample-low);sample+=bass*low;
    const grit=profile.grit??0;
    if(grit)sample=(1-grit)*sample+grit*Math.tanh(sample*4)/1.5;
    if(profile.metal)sample*=1-profile.metal+profile.metal*Math.cos(2*Math.PI*52*i/sampleRate);
    const edge=Math.min(1,i/(sampleRate*.004),(output.length-1-i)/(sampleRate*.008));
    output[i]=Math.max(-.98,Math.min(.98,sample*.92))*Math.max(0,edge);
  }
  return output;
}
export function pauseAfter(text,style='natural'){
  if(style==='continuous')return 0;
  const scale=style==='reflective'?1.55:1;
  if(/\n\s*\n\s*$/.test(text))return .48*scale;
  if(/[.!?]["'”’)]*\s*$/.test(text))return .16*scale;
  if(/[:;]["'”’)]*\s*$/.test(text))return .12*scale;
  return 0;
}
