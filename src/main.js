import './style.css';
import {chunkText} from './core.js';
const $ = id => document.getElementById(id);
const natural = [['af_heart','Heart · American woman'],['af_bella','Bella · American woman'],['af_nicole','Nicole · American woman'],['am_michael','Michael · American man'],['am_fenrir','Fenrir · American man'],['am_puck','Puck · American man'],['bf_emma','Emma · British woman'],['bm_george','George · British man'],['bm_fable','Fable · British man']];
let voices=[],worker=null,busy=false,paused=false,run=0,audioURL=null,transcript='',audioFile=null,wake=null;
const status = text => $('status').textContent=text;
function fillVoices(){
  const prior=$('voice').value;$('voice').replaceChildren();
  voices=window.speechSynthesis?.getVoices()??[];
  const options=$('engine').value==='kokoro'?natural:voices.map((v,i)=>[String(i),`${v.name} · ${v.lang}`]);
  for(const [value,label] of options){const o=document.createElement('option');o.value=value;o.textContent=label;$('voice').append(o);}
  if(options.some(([id])=>id===prior))$('voice').value=prior;
  else if($('engine').value==='device'){const en=voices.findIndex(v=>v.lang.startsWith('en'));if(en>=0)$('voice').value=String(en);}
  if(!options.length){const o=document.createElement('option');o.textContent='No device voices yet — try Natural voices';o.value='';$('voice').append(o);}
}
fillVoices();if(window.speechSynthesis)window.speechSynthesis.onvoiceschanged=fillVoices;
function invalidate(){
  $('review').checked=false;$('result').hidden=true;transcript='';audioFile=null;
  $('audio').pause();$('audio').removeAttribute('src');
  if(audioURL){URL.revokeObjectURL(audioURL);audioURL=null;}
  const count=$('text').value.match(/\S+/gu)?.length??0;
  $('count').textContent=`${count.toLocaleString()} words · about ${Math.max(1,Math.ceil(count/150))} min`;
}
function state(value){busy=value;for(const id of ['text','file','sample','clear','engine','voice','speed','review','start','preview'])$(id).disabled=value;$('stop').disabled=!value;$('pause').disabled=!value||$('engine').value==='kokoro';if(!value){paused=false;$('pause').textContent='Pause';wake?.release().catch(()=>{});wake=null;}}
function stop(){run++;worker?.terminate();worker=null;window.speechSynthesis?.cancel();state(false);$('progress').hidden=true;status('Stopped. You can start again from the beginning.');}
$('stop').onclick=stop;
$('pause').onclick=()=>{if(!window.speechSynthesis)return;paused=!paused;paused?window.speechSynthesis.pause():window.speechSynthesis.resume();$('pause').textContent=paused?'Resume':'Pause';};
$('text').oninput=invalidate;
$('engine').onchange=()=>{fillVoices();$('engine-note').textContent=$('engine').value==='kokoro'?'Free Kokoro voices. Downloads a model on first use, then creates WAV audio locally. Long sermons take time; keep this page open and awake. For best results, create audio on a computer, then send it to your iPhone.':'Uses your device’s free voices. Keep this page open while listening. Audio download is available with Natural voices.';};
$('speed').oninput=()=>{$('speed-value').textContent=`${Number($('speed').value)}×`;};
$('clear').onclick=()=>{$('text').value='';$('source').textContent='Nothing stored after you leave';$('import-note').hidden=true;invalidate();};
$('sample').onclick=()=>{$('text').value='Good morning, church. Today, let us make room for hope.\n\nEven in a difficult season, we can show kindness to a neighbor, listen to a friend, and take the next faithful step.\n\nMay our words become actions, and may our actions reflect love. Amen.';$('source').textContent='Example sermon';$('import-note').hidden=true;invalidate();};
$('file').onchange=async()=>{
  const file=$('file').files[0];if(!file)return;
  state(true);$('stop').disabled=true;status('Reading your document locally…');
  try{
    if(file.size>10*1024*1024)throw Error('Please choose a document under 10 MB.');
    const ext=file.name.split('.').pop().toLowerCase();let text;
    if(ext==='txt')text=await file.text();
    else if(ext==='docx'){const {default:mammoth}=await import('mammoth/mammoth.browser');text=(await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;}
    else if(ext==='pdf'){
      const pdfjs=await import('pdfjs-dist');const {default:url}=await import('pdfjs-dist/build/pdf.worker.min.mjs?url');pdfjs.GlobalWorkerOptions.workerSrc=url;
      const pdf=await pdfjs.getDocument({data:await file.arrayBuffer(),isEvalSupported:false}).promise;
      try{if(pdf.numPages>100)throw Error('Please use a PDF with 100 pages or fewer.');const pages=[];
      for(let p=1;p<=pdf.numPages;p++){const page=await pdf.getPage(p);const content=await page.getTextContent();pages.push(content.items.map(item=>item.str===undefined?'':item.str+(item.hasEOL?'\n':' ')).join(''));}text=pages.join('\n\n');}finally{await pdf.destroy();}
    }else throw Error('Please choose a .txt, .docx, or text-based .pdf document.');
    if(!text.trim())throw Error('No readable text found. Scanned PDFs need text copied from another source.');
    if(text.length>150000)throw Error('Please split this document into smaller sermons (under 150,000 characters).');
    $('text').value=text;invalidate();$('source').textContent=file.name;
    $('import-note').hidden=false;$('import-note').textContent=ext==='txt'?'Text loaded. Review it, then check the confirmation below.':'Review the imported text before listening. Columns, headers, tables, footnotes, and text boxes may appear out of order or be missing. Compare against your original document.';
    status('Document loaded. Review the text, then confirm it below.');
  }catch(e){status(e.message);}finally{state(false);$('file').value='';}
};
async function speak(preview=false){
  if(busy)return;
  const text=preview?'Welcome. These are your words, ready to take on the road.':$('text').value;
  if(!text.trim()){status('Add your sermon text first.');$('text').focus();return;}
  if(!preview&&!$('review').checked){status('Please review the text and check the confirmation below it.');$('review').focus();return;}
  if(text.length>150000){status('Please split this sermon into sections under 150,000 characters.');return;}
  const chunks=chunkText(text),token=++run,speed=Number($('speed').value),voice=$('voice').value;
  state(true);$('progress').hidden=false;$('progress').value=0;status('Preparing your reading…');
  try{wake=await navigator.wakeLock?.request('screen');}catch{/* Optional on iPhone. */}
  if(token!==run)return;
  if($('engine').value==='device'){
    if(!window.speechSynthesis||!voices.length){state(false);status('No device voices available. Choose Natural voices instead.');return;}
    window.speechSynthesis.cancel();let i=0;
    const next=()=>{
      if(token!==run)return;
      while(i<chunks.length&&!chunks[i].trim())i++;
      if(i===chunks.length){state(false);$('progress').value=1;status('Reading finished.');return;}
      const utterance=new SpeechSynthesisUtterance(chunks[i]);utterance.voice=voices[Number(voice)];utterance.rate=speed;utterance.lang=utterance.voice?.lang??'en-US';
      utterance.onend=()=>{i++;$('progress').value=i/chunks.length;next();};
      utterance.onerror=e=>{if(token!==run)return;run++;state(false);status(`Reading interrupted (${e.error}). Start again or use Natural voices to create a file.`);};
      status(`Reading passage ${i+1} of ${chunks.length}. Keep this page open.`);window.speechSynthesis.speak(utterance);
    };next();return;
  }
  worker??=new Worker(new URL('./tts-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    if(token!==run)return;
    if(data.type==='loading')status(`Downloading voice engine: ${Math.round(data.progress??0)}% of ${data.file??'file'}. First use can take several minutes.`);
    if(data.type==='progress'){$('progress').value=data.done/data.total;status(`Creating passage ${data.done} of ${data.total}. Keep this page open. Stop discards unfinished audio.`);}
    if(data.type==='error'){worker.terminate();worker=null;state(false);status(`Could not finish: ${data.message}. Try Quick listen, or generate on a computer.`);}
    if(data.type==='complete'){
      state(false);if(audioURL)URL.revokeObjectURL(audioURL);const blob=new Blob([data.wav],{type:'audio/wav'});audioURL=URL.createObjectURL(blob);
      $('audio').src=audioURL;$('result').hidden=false;$('download').href=audioURL;
      $('download').hidden=preview;$('share').hidden=true;$('transcript').hidden=preview;
      if(!preview){transcript=text;audioFile=new File([blob],'my-sermon.wav',{type:'audio/wav'});$('share').hidden=!navigator.canShare?.({files:[audioFile]});}
      $('progress').value=1;status(preview?'Voice preview ready. Press play below.':'Every text passage was processed. Your complete audio and reading transcript are ready.');
    }
  };
  worker.onerror=e=>{if(token!==run)return;worker?.terminate();worker=null;state(false);status(`Voice engine could not start. Try Quick listen or a current desktop browser. ${e.message??''}`);};
  worker.postMessage({chunks,voice,speed});
}
$('preview').onclick=()=>speak(true);$('start').onclick=()=>speak(false);
$('share').onclick=async()=>{try{await navigator.share({files:[audioFile],title:'My sermon'});}catch(e){if(e.name!=='AbortError')status('Sharing unavailable. Use Save audio instead.');}};
$('transcript').onclick=()=>{const url=URL.createObjectURL(new Blob([transcript],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='my-sermon-reading-transcript.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('pagehide',()=>{window.speechSynthesis?.cancel();worker?.terminate();});
