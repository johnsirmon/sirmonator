// Explicit editions keep the accepted voice reproducible after future tuning.
export function characterVoice(id,edition='refined'){
  if(!['prime','fenix'].includes(id))throw Error('Unknown character voice');
  if(!['refined','previous'].includes(edition))throw Error('Unknown voice edition');
  return id+(edition==='previous'?'-v2':'');
}
export function characterSettings(voice){
  if(voice==='prime')return {steps:4,temperature:0.65};
  if(voice==='fenix')return {steps:4,temperature:0.60};
  if(['prime-v2','fenix-v2'].includes(voice))return {steps:1,temperature:0.7};
  throw Error('Unknown character voice');
}
