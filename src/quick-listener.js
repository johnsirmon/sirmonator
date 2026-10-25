// Device speech is started only by an explicit caller. Each run owns its exact
// source, selected voice, rate and callbacks; cancelled events cannot own a retry.
export function createQuickListener({getSpeech,createUtterance,split,onState,notify}){
 let active=null;
 const sameVoice=(a,b)=>a===b||(a.voiceURI===b.voiceURI&&a.name===b.name&&a.lang===b.lang);
 const state=()=>onState({active:!!active,paused:!!active?.paused});
 const detach=run=>{if(run.utterance){run.utterance.onend=null;run.utterance.onerror=null;run.utterance=null;}};
 function finish(run,message,cancel=false){
  if(active!==run)return;active=null;detach(run);
  if(cancel)try{run.speech.cancel();}catch{}
  state();if(message)notify(message);
 }
 function stop({silent=false}={}){if(active)finish(active,silent?null:'Quick listening stopped.',true);}
 function next(run){
  if(active!==run||run.paused||run.utterance)return;
  if(run.index===run.passages.length){finish(run,'Quick listening finished. No recording was created.');return;}
  try{
   const voice=(run.speech.getVoices?.()??[]).find(candidate=>sameVoice(candidate,run.voice));
   if(!voice){finish(run,'The selected device voice became unavailable. Choose an available voice or Studio mode.',true);return;}
   const utterance=createUtterance(run.passages[run.index]);run.utterance=utterance;
   utterance.voice=voice;utterance.rate=run.speed;
   const current=()=>active===run&&run.utterance===utterance;
   utterance.onend=()=>{if(!current())return;detach(run);run.index++;next(run);};
   utterance.onerror=()=>{if(current())finish(run,'Device reading interrupted. Choose Studio for resumable recordings.',true);};
   run.speech.speak(utterance);
  }catch{finish(run,'Device reading could not start or was interrupted. Choose Studio for resumable recordings.',true);}
 }
 function start({text,voice,speed}){
  stop({silent:true});
  if(typeof text!=='string'||!text.trim()){notify('Add some text first.');return;}
  let speech,selected,passages;
  try{
   speech=getSpeech();const voices=speech?.getVoices?.()??[];
   selected=voice&&voices.find(candidate=>sameVoice(candidate,voice));
   if(!speech||typeof speech.speak!=='function'||!selected){notify('The selected device voice is unavailable. Choose an available voice or Studio mode.');return;}
   if(!Number.isFinite(speed)||speed<.7||speed>1.3)throw Error('Invalid narration speed');
   passages=split(text);if(!passages.length||passages.join('')!==text)throw Error('Invalid device speech passages');
  }catch{notify('Device reading could not start. Your source was kept. Choose an available voice or Studio mode.');return;}
  const run={speech,voice:selected,speed,passages,index:0,paused:false,utterance:null};active=run;
  state();notify('Quick listening. No MP3 is being saved.');
  try{if(speech.paused)speech.resume();}catch{finish(run,'Device reading could not resume. Choose Studio for resumable recordings.',true);return;}
  next(run);
 }
 function togglePause(){
  const run=active;if(!run)return;run.paused=!run.paused;
  try{run.paused?run.speech.pause():run.speech.resume();}catch{finish(run,'Device reading interrupted while pausing or resuming. Choose Studio for resumable recordings.',true);return;}
  if(active!==run)return;state();if(!run.paused)next(run);
 }
 return {start,stop,togglePause};
}
