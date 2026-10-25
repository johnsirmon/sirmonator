import {characterVoice} from './character-settings.js';
import {getVoice} from './voices.js';
export function auditionUrl(id,base='./',edition='refined'){
  const voice=getVoice(id);
  return `${base}auditions/${voice.engine==='pocket'?characterVoice(id,edition):id}.wav${voice.revision?'?v='+voice.revision:''}`;
}
export function createAuditionPlayer({audio,setBusy,notify}){
  let sequence=0;
  const stop=()=>{sequence++;audio.pause();audio.onended=null;audio.onerror=null;setBusy(false);};
  const play=async url=>{
    stop();const current=sequence;
    audio.src=url;audio.hidden=false;setBusy(true);notify('Playing voice audition…');
    const finish=message=>{if(current!==sequence)return;sequence++;audio.onended=null;audio.onerror=null;setBusy(false);notify(message);};
    audio.onended=()=>finish('Audition finished. Choose a voice or read your sermon.');
    audio.onerror=()=>finish('The audition audio could not load. Please try again. Your manuscript is unchanged.');
    try{await audio.play();}
    catch(error){
      if(current!==sequence)return;
      finish(error.name==='NotAllowedError'?'Audition ready. Press Play in the sample player below.':'The audition audio could not load. Please try again. Your manuscript is unchanged.');
    }
  };
  return {play,stop};
}
