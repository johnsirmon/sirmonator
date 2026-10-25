import {pcmReviewSummary,withPcmReviewReport} from './pcm-review.js';
import {createQuickListener} from './quick-listener.js';
import {createSourceImporter} from './source-importer.js';
import {createStorageUsageEditor} from './storage-usage-editor.js';
import {browserStorageEstimate,storageEstimateText} from './storage-usage.js';
import {createSynthesisClient} from './synthesis-client.js';
import {abortable,assertActive} from './continuity.js';
import {FOUNDATION_PIPELINE} from './engine-specs.js';
import {createReferenceEditor} from './reference-editor.js';
import {createSpeechReviewEditor} from './speech-review-editor.js';
import {reviewSelectionMatches} from './speech-review.js';
import {createPronunciationEditor} from './pronunciation-editor.js';
import {chunkSource,WORD_BOUNDARIES,LEGACY_BOUNDARIES} from './text-boundaries.js';
import {createTakeEditor} from './take-editor.js';
import {createChapterCache} from './chapter-cache.js';
import {showPreparationProgress} from './preparation-progress.js';
import {episodePackage,packageZip,appleValidationUrl,publicUrl} from './podcast.js';
import './style.css';
import {voices as catalog,getVoice,voiceCapabilities} from './voices.js';
import {auditionUrl,createAuditionPlayer} from './audition-player.js';
import {characterVoice} from './character-settings.js';
import {chaptersFor,selectedText,makeRecording,normalizeSettings,MAX_DOCUMENT,MAX_READING} from './recording.js';
import {portableFilename as safeFilename} from './export-safety.js';
import {openStorage} from './storage.js';
import {runRecording,recordingBlob as encodeRecordingBlob,validateCheckpoint,renderReport,createPlaybackPreparation} from './job-runner.js';
import {importDocument} from './import-document.js';
const $=id=>document.getElementById(id),base=import.meta.env.BASE_URL;
function recordingBlob(store,job,chapter=null,maxBytes,options={}){return encodeRecordingBlob(store,job,chapter,maxBytes,{createWorker:()=>new Worker(new URL('./mp3-review-worker.js',import.meta.url),{type:'module'}),...options});}

let store,chapters=[],deviceVoices=[],selectedJob=null;
let boundaryError='';
let storageReady=false,storageOpening=false,draftRevision=0;
let creating=false,auditionBusy=false,importing=false,quick=false,quickPaused=false,pauseRequested=false,cancelled=false;
let audioURL=null,previewURL=null,wake=null,owner=crypto.randomUUID(),draftTimer,saveChain=Promise.resolve(),dirty=false,undo=null;
let renderToken=0,selectionToken=0,loadedChapter=0,loadedThrough=0,loadedJobId=null,positionSaved=0,exporting=false;
let exportController=null,playbackController=null;
var takeEditor,pronunciationEditor,speechReview,referenceEditor,storageUsageEditor,sourceImporter;
const chapterCache=createChapterCache({prepare:(job,chapter,options)=>{const token=renderToken,selection=selectionToken;return recordingBlob(store,job,chapter,undefined,{...options,onProgress:value=>{if(token===renderToken&&selection===selectionToken&&!exporting)showPreparationProgress($,value,'Chapter '+(chapter+1));}});},onChange:()=>controls()});
function cancelPreparations(){const active=exportController||playbackController||chapterCache.preparing;exportController?.abort();playbackController?.abort();chapterCache.clear();if(active){$('preparation-meter').hidden=true;$('preparation-status').textContent='Audio preparation interrupted. Saved audio remains available.';}}
const status=message=>$('status').textContent=message;
const warn=error=>error?.name==='QuotaExceededError'?'Local storage could not accept this write. Previously committed passages were kept. Export available audio and source text before retrying; choose fewer chapters or another device. Browser estimates do not guarantee success.':(error?.message||'Could not save on this device.');
const busy=()=>creating||auditionBusy||importing||quick||exporting||(typeof takeEditor!=='undefined'&&takeEditor?.busy)||(typeof speechReview!=='undefined'&&speechReview?.busy)||(typeof referenceEditor!=='undefined'&&referenceEditor?.busy);
function controls(){
  for(const id of ['text','title','file','sample','clear','undo-clear','engine','voice','voice-edition','delivery','speed','review','start','preview','custom-preview','range-from','range-to','remember','open-recording','saved-recordings','pronunciation-rules','pronunciation-case','text-boundaries'])$(id).disabled=busy();
  document.querySelectorAll('[data-voice]').forEach(b=>b.disabled=busy());
  $('pause').disabled=!(creating||quick)||pauseRequested;$('pause').textContent=quick?(quickPaused?'Resume listening':'Pause listening'):(pauseRequested?'Saving current passage…':'Pause creation');
  $('stop').disabled=!(importing||creating||quick||auditionBusy||exporting||playbackController||chapterCache.preparing||(typeof takeEditor!=='undefined'&&takeEditor?.busy)||(typeof speechReview!=='undefined'&&speechReview?.busy)||(typeof referenceEditor!=='undefined'&&referenceEditor?.busy));$('resume-recording').disabled=busy();
  $('stop').textContent=importing?'Cancel document import':(typeof referenceEditor!=='undefined'&&referenceEditor?.busy)?'Cancel reference operation':(typeof speechReview!=='undefined'&&speechReview?.busy)?'Cancel review operation':exporting||playbackController||chapterCache.preparing?'Cancel audio preparation':'Cancel creation';
  $('delete-recording').disabled=busy()||!$('saved-recordings').value;
  if(!busy())$('open-recording').disabled=!$('saved-recordings').value;
  for(const id of ['download','download-chapter','share','render-report'])$(id).disabled=busy()||!selectedJob?.next;
  document.querySelectorAll('#podcast-prep input,#podcast-prep select,#podcast-prep textarea').forEach(input=>input.disabled=busy());
  $('pod-export').disabled=busy()||!selectedJob||selectedJob.next!==selectedJob.passages.length;
  podcastHandoff();
  if(typeof takeEditor!=='undefined')takeEditor?.controls();
  if(typeof speechReview!=='undefined')speechReview?.controls();
  if(typeof referenceEditor!=='undefined')referenceEditor?.controls();
  if(typeof storageUsageEditor!=='undefined')storageUsageEditor?.controls();
  $('retry-storage').disabled=storageOpening||busy();$('retry-storage').hidden=storageReady;
  for(const id of ['refresh-audio','play-chapter'])$(id).disabled=busy()||!storageReady||!selectedJob?.next;
  if(!storageReady){for(const id of ['resume-recording','open-recording','delete-recording','download','download-chapter','share','render-report','pod-export','refresh-audio','play-chapter'])$(id).disabled=true;if($('engine').value==='studio')$('start').disabled=true;}
}
function storageStateChanged({state,message}){
  if(state==='ready')return;
  $('storage-state').textContent=message;
  if(state==='versionchange'||state==='closed'){
    storageReady=false;cancelled=true;pauseRequested=true;clearTimeout(draftTimer);clearTimeout(podcastSaveTimer);
    beginSelection();killWorker();takeEditor?.cancel();$('audio').pause();
    $('save-status').textContent='Draft edits may be unsaved. Download a text backup before reloading.';
    status(message);controls();
  }
}
const audition=createAuditionPlayer({audio:$('audition-audio'),setBusy:value=>{auditionBusy=value;controls();},notify:status});
const quickListener=createQuickListener({getSpeech:()=>window.speechSynthesis,createUtterance:text=>new SpeechSynthesisUtterance(text),split:text=>chaptersFor(text,240).map(p=>text.slice(p.start,p.end)),onState:state=>{quick=state.active;quickPaused=state.paused;controls();},notify:status});
function settings(allowInvalid=false){const config={voice:$('voice').value,edition:$('voice-edition').value,speed:Number($('speed').value),delivery:$('delivery').value,pipeline:FOUNDATION_PIPELINE};try{const pronunciation=pronunciationEditor?.config();if(pronunciation)config.pronunciation=pronunciation;}catch(error){if(!allowInvalid)throw error;}return config;}
function fillVoices(){
  const prior=$('voice').value,device=$('engine').value==='device',selected=device?deviceVoices[Number(prior)]:null;deviceVoices=window.speechSynthesis?.getVoices()??[];$('voice').replaceChildren();
  const entries=$('engine').value==='studio'?catalog.map(v=>[v.id,`${v.name} · ${v.detail}`]):deviceVoices.map((v,i)=>[String(i),`${v.name} · ${v.lang}`]);
  for(const [value,label] of entries){const option=new Option(label,value);$('voice').add(option);}
  const selectedIndex=selected?deviceVoices.findIndex(v=>v===selected||(v.voiceURI===selected.voiceURI&&v.name===selected.name&&v.lang===selected.lang)):-1;
  if(device&&selectedIndex>=0)$('voice').value=String(selectedIndex);
  else if(!device)$('voice').value=entries.some(([id])=>id===prior)?prior:'st-m1';
  else {const en=deviceVoices.findIndex(v=>v.lang.startsWith('en'));if(en>=0)$('voice').value=String(en);}
}
function narratorNote(){
  const studio=$('engine').value==='studio',profile=studio?getVoice($('voice').value):null,character=profile?.engine==='pocket';
  $('character-controls').hidden=!character;$('voice-reference').hidden=!character;$('reference-audio').pause();
  $('voice-note').textContent=character?'An unofficial character impression. Compare the sample; resemblance varies.':'Choose a narrator, then audition a short sample. More choices are available in this list.';
  if(studio){const capability=voiceCapabilities(profile.id);$('voice-note').textContent+=' '+capability.license+'. '+capability.note;}
  $('engine-note').textContent=studio?'Studio creates MP3 recordings with saved progress.':'Device voices read now without creating a recording. Keep the page open; interruption restarts this quick reading.';
  if(character){$('reference-audio').src=base+'references/'+characterVoice(profile.id,$('voice-edition').value)+'.wav?v=3';$('reference-credit').textContent=profile.referenceCredit;$('reference-source').href=profile.referencePage;$('reference-interview').href=profile.performancePage;}
  document.querySelectorAll('[data-voice]').forEach(b=>b.setAttribute('aria-pressed',String(studio&&b.dataset.voice===$('voice').value)));
  $('speed-value').textContent=Number($('speed').value)+'×';preflight();
}
const draftBoundaryPolicy=()=>$('engine').value==='device'?LEGACY_BOUNDARIES:$('text-boundaries').value;
function rangeText(){if(!chapters.length)return '';return selectedText($('text').value,chapters,Number($('range-from').value),Number($('range-to').value));}
function countWords(text){let count=0;for(const _ of text.matchAll(/\S+/gu))count++;return count;}
function updateText({resetRange=true,save=true}={}){
  const text=$('text').value,words=countWords(text);boundaryError='';try{chapters=chaptersFor(text,undefined,draftBoundaryPolicy());}catch(error){chapters=[];boundaryError=error.message;}
  const from=Number($('range-from').value)||0,to=Number($('range-to').value)||0;
  $('range-from').replaceChildren();$('range-to').replaceChildren();
  chapters.forEach((c,i)=>{const label=`${i+1} · ${countWords(text.slice(c.start,c.end)).toLocaleString()} words`;$('range-from').add(new Option(label,String(i)));$('range-to').add(new Option(label,String(i)));});
  if(chapters.length){$('range-from').value=String(resetRange?0:Math.min(from,chapters.length-1));$('range-to').value=String(resetRange?(text.length<=MAX_READING?chapters.length-1:0):Math.max(Number($('range-from').value),Math.min(to,chapters.length-1)));}
  $('chapter-range').hidden=!text.length;$('count').textContent=`${words.toLocaleString()} words · about ${Math.ceil(words/150)||0} min listening`;
  updateRange(false);if(save)scheduleSave();
}
function updateRange(save=true){
  if(Number($('range-to').value)<Number($('range-from').value))$('range-to').value=$('range-from').value;
  const text=rangeText(),words=countWords(text);$('range-summary').textContent=`Selected: ${words.toLocaleString()} words · ${text.length.toLocaleString()} characters · about ${Math.ceil(words/150)||0} min listening${text.length>MAX_READING?' · choose fewer chapters for this recording':''}`;
  $('range-preview').textContent=text.length>12000?text.slice(0,12000)+'\n\n[Preview shortened. The full selected text will be read.]':text;
  pronunciationEditor?.refresh();if(save){$('review').checked=false;scheduleSave();}preflight();
}
function preflight(){
  if(boundaryError){$('preflight').textContent=boundaryError;return;}
  if($('engine').value==='studio'&&draftBoundaryPolicy()!==WORD_BOUNDARIES){$('preflight').textContent='Legacy preview mode preserves earlier boundaries. Choose New text boundaries and review before creating a new Studio recording. Saved recordings can still resume below.';return;}
  const text=rangeText();if(!text.trim()){$('preflight').textContent='Add text to see listening time and download details.';return;}
  const minutes=countWords(text)/150,profile=$('engine').value==='studio'?getVoice($('voice').value):null;
  if(!profile){$('preflight').textContent=`About ${Math.ceil(minutes)} minutes of device speech. No download or saved audio.`;return;}
  const mb=profile.engine==='pocket'?150:profile.engine==='supertonic'?400:'93–326';
  $('preflight').textContent=`About ${Math.ceil(minutes/Number($('speed').value))} min listening · estimated MP3 ${(minutes/Number($('speed').value)*.48).toFixed(1)} MB. Smooth recordings keep uncompressed local checkpoints (about 3–6 MB/min); MP3 preparation takes additional time. First voice use may download about ${mb} MB; pinned model URLs may need a fresh cache even after earlier versions. Creation time depends on your device.`;
}
function draft(){return {text:$('text').value,title:$('title').value,settings:settings(true),pronunciationDraft:pronunciationEditor?.snapshot(),boundaryPolicy:$('text-boundaries').value,engine:$('engine').value,review:$('review').checked,from:Number($('range-from').value),to:Number($('range-to').value),updatedAt:Date.now()};}
function scheduleSave(){quickListener.stop();audition.stop();dirty=true;draftRevision++;clearTimeout(draftTimer);if(!$('remember').checked){$('save-status').textContent='Draft autosave is off. Created recordings are saved separately.';return;}$('save-status').textContent='Saving draft…';draftTimer=setTimeout(()=>queueSave(),350);}
async function flushDraft(){
  clearTimeout(draftTimer);if(!$('remember').checked)return;if(!store||!storageReady){$('save-status').textContent='Draft is not saved while local storage is unavailable. Download a text backup.';return;}
  const snapshot=draft();if(snapshot.text.length>MAX_DOCUMENT){$('save-status').textContent='Draft exceeds 2 million characters. Download a text backup and reduce its size.';return;}
  const target=store,revision=draftRevision,current=()=>storageReady&&store===target&&draftRevision===revision;saveChain=saveChain.catch(()=>{}).then(()=>target.saveDraft(snapshot));
  try{await saveChain;if(current())$('save-status').textContent='Draft saved on this device. Private browsing or clearing site data can remove it.';}
  catch(error){if(current())$('save-status').textContent='Draft not saved: '+warn(error);throw error;}
}
function queueSave(){flushDraft().catch(()=>{});}
function saveFile(blob,filename){const url=URL.createObjectURL(blob);try{const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(error){URL.revokeObjectURL(url);throw error;}}
async function refreshLibrary(){
  if(!store)return;const jobs=await store.jobs(),prior=selectedJob?.id||$('saved-recordings').value;
  $('saved-recordings').replaceChildren(new Option(jobs.length?'Choose a saved recording':'No recordings yet',''));
  for(const job of jobs)$('saved-recordings').add(new Option(`${job.title} · ${job.next===job.passages.length?'ready':job.next+'/'+job.passages.length+' passages saved'}`,job.id));
  if(jobs.some(j=>j.id===prior))$('saved-recordings').value=prior;
  $('library-count').textContent=String(jobs.length);controls();return jobs;
}
function availableChapters(job){return [...new Set(job.passages.slice(0,job.next).map(p=>p.chapter))];}
function displayProgress(job){
  renderDetails(job);
  $('recording-title').textContent=job.title;
  $('recording-status').textContent=`${getVoice(job.settings.voice).name} · ${job.settings.edition} · ${job.next} of ${job.passages.length} passages saved · ${job.next===job.passages.length?'Complete recording':'Incomplete — saved audio only'}. ${Math.round(job.seconds/60)} min saved.`;
  $('resume-recording').hidden=job.next===job.passages.length||creating;
  const chapters=availableChapters(job),current=$('play-chapter').value;
  $('play-chapter').replaceChildren();for(const i of chapters)$('play-chapter').add(new Option(`Chapter ${i+1}${job.next<job.passages.length&&job.passages[job.next].chapter===i?' · saved so far':''}`,String(i)));
  if(chapters.includes(Number(current)))$('play-chapter').value=current;
  $('play-chapter').disabled=!chapters.length;$('refresh-audio').disabled=!job.next;
  $('share').hidden=typeof navigator.share!=='function';controls();
}
function beginSelection(){if(typeof storageUsageEditor!=='undefined')storageUsageEditor?.cancel();if(typeof speechReview!=='undefined')speechReview?.cancel();if(typeof referenceEditor!=='undefined')referenceEditor?.cancel();cancelPreparations();renderToken++;return ++selectionToken;}
function playbackFailure(id,channels,message){
  const notices=playbackFailure.notices??=new Map(),notice={id,message};
  for(const channel of channels){$(channel).textContent=message;notices.set(channel,notice);}
}
function playbackRetry(id){
  const notices=playbackFailure.notices??=new Map(),prior=[...notices].filter(([,notice])=>notice.id===id);
  // A retry may clear only the errors it inherited, and only while their
  // displayed text still belongs to them. Preserve later/unrelated warnings.
  return ()=>{for(const [channel,notice] of prior)if(notices.get(channel)===notice&&$(channel).textContent===notice.message){$(channel).textContent='';notices.delete(channel);}};
}
async function showRecording(job,{keepAudio=false,selection=beginSelection()}={}){
  // Cancel old reads before validation or metadata saving can yield to another selection.
  if(selection!==selectionToken)return;
  playbackController?.abort();const controller=new AbortController();playbackController=controller;controls();let preparation;
  try{await abortable(flushPodcast(),controller.signal);if(selection!==selectionToken)return;
    job=await abortable(store.job(job.id),controller.signal);if(selection!==selectionToken)return;
    if(!job)throw Error('The selected recording is no longer available.');
    preparation=await createPlaybackPreparation(store,job,{signal:controller.signal,isCurrent:()=>selection===selectionToken});job=preparation.job;if(selection!==selectionToken){preparation.dispose();return;}
  }catch(error){preparation?.dispose();if(selection===selectionToken)throw error;return;}
  finally{if(playbackController===controller)playbackController=null;controls();}
  // A recording with audio becomes the selected/labelled player only after
  // its validated artifact and replacement URL are ready. Keep the old player
  // coherent while preparing, and on failure or cancellation.
  if((!keepAudio||(loadedJobId!==null&&loadedJobId!==job.id))&&job.next){const available=availableChapters(job),c=available.includes(job.position?.chapter)?job.position.chapter:available[0];return !!await loadChapter(c,job.position?.chapter===c?job.position.time:0,preparation,true);}
  renderToken++;selectedJob=job;restorePodcast(job);$('empty-player').hidden=true;$('result').hidden=false;displayProgress(job);preparation.dispose();
  if(!job.next){$('audio').pause();$('audio').onloadedmetadata=null;$('audio').removeAttribute('src');if(audioURL)URL.revokeObjectURL(audioURL);audioURL=null;loadedJobId=null;}
}
async function loadChapter(chapter,time=0,preparation=null,selectRecording=false){
  const target=preparation?.job??selectedJob;if(!target?.next)return;const token=++renderToken,id=target.id,priorId=selectedJob?.id,selection=selectionToken,clearRetryErrors=playbackRetry(id);
  $('preparation-meter').hidden=true;$('preparation-status').textContent='Preparing chapter '+(chapter+1)+' audio.';
  playbackController?.abort();const controller=new AbortController();playbackController=controller;controls();
  const current=()=>token===renderToken&&selection===selectionToken&&(selectedJob?.id===priorId||selectedJob?.id===id);
  let handedOff=false;
  try{let job=preparation?.job??await abortable(store.job(id),controller.signal);if(!current())return;
    if(job?.id!==id)throw Error('The selected recording is no longer available.');
    preparation??=await createPlaybackPreparation(store,job,{signal:controller.signal,isCurrent:current});job=preparation.job;if(!current())return;
    handedOff=true;const {blob,metrics,metricsPersisted}=await preparation.prepare(chapterCache,chapter,{signal:controller.signal,isCurrent:current});if(!current()||controller.signal.aborted)return;
    const nextURL=URL.createObjectURL(blob);$('audio').pause();if(audioURL)URL.revokeObjectURL(audioURL);audioURL=nextURL;loadedChapter=chapter;loadedThrough=job.next;loadedJobId=job.id;selectedJob=job;$('play-chapter').value=String(chapter);
    if(selectRecording){restorePodcast(job);$('empty-player').hidden=true;$('result').hidden=false;displayProgress(job);$('play-chapter').value=String(chapter);}
    renderDetails(job,metrics,metricsPersisted);
    $('audio').onloadedmetadata=()=>{if(current()&&loadedJobId===id&&Number.isFinite($('audio').duration))$('audio').currentTime=Math.max(0,Math.min(time,$('audio').duration-.05));};
    $('audio').src=audioURL;$('audio').playbackRate=Number($('playback-speed').value);mediaControls(job);
    $('preparation-status').textContent='Chapter '+(chapter+1)+' audio ready.';
    clearRetryErrors();
    return true;
  }catch(error){if(current()&&!controller.signal.aborted)playbackFailure(id,['preparation-status','export-status'],warn(error));}
  finally{if(current())$('preparation-meter').hidden=true;if(!handedOff)preparation?.dispose();if(playbackController===controller){if(selectedJob?.id===loadedJobId)$('play-chapter').value=String(loadedChapter);playbackController=null;}controls();}
}
async function openRecording(){
  if(busy())return;const id=$('saved-recordings').value;if(!id)return;
  const selection=beginSelection(),token=renderToken,clearRetryErrors=playbackRetry(id);
  playbackController?.abort();const controller=new AbortController();playbackController=controller;
  let handedOff=false,handoffController;const ownsIntent=()=>selection===selectionToken&&token===renderToken;
  const current=()=>ownsIntent()&&!controller.signal.aborted;
  $('preparation-meter').hidden=true;$('preparation-status').textContent='Preparing selected recording.';controls();
  try{await abortable(savePosition(),controller.signal);if(!current())return;const job=await abortable(store.job(id),controller.signal);if(!current())return;if(!job)throw Error('The selected recording is no longer available.');handedOff=true;const opening=showRecording(job,{selection});handoffController=playbackController;const opened=await opening;if(selection===selectionToken&&(opened===true||!job.next))clearRetryErrors();}
  // showRecording deliberately replaces/aborts this controller. The intent
  // still owns its validation errors until Stop or newer navigation changes it.
  catch(error){if(handedOff?ownsIntent()&&!handoffController?.signal.aborted:current())playbackFailure(id,['preparation-status','status'],warn(error));}
  finally{if(playbackController===controller){playbackController=null;controls();}}
}
async function changeChapter(){
  if(busy()||!selectedJob?.next)return;
  const chapter=Number($('play-chapter').value),id=selectedJob.id,selection=selectionToken,token=++renderToken;
  playbackController?.abort();const controller=new AbortController();playbackController=controller;
  const current=()=>selection===selectionToken&&token===renderToken&&selectedJob?.id===id&&!controller.signal.aborted;
  if(loadedJobId===id)$('play-chapter').value=String(loadedChapter);
  $('preparation-status').textContent='Preparing chapter '+(chapter+1)+' audio.';controls();
  try{await abortable(savePosition().catch(()=>{}),controller.signal);if(current())await loadChapter(chapter);}
  catch(error){if(current())$('export-status').textContent=warn(error);}
  finally{if(playbackController===controller){playbackController=null;if(selectedJob?.id===loadedJobId)$('play-chapter').value=String(loadedChapter);controls();}}
}
function renderDetails(job,preparation,persisted){
 if(typeof storageUsageEditor!=='undefined')storageUsageEditor?.update(job);
 if(typeof takeEditor!=='undefined')takeEditor?.update(job);
 if(typeof speechReview!=='undefined')speechReview?.update(job);
 const note=job.settings?.renderManifest?'Frozen render inputs saved. Pinned inputs do not guarantee identical speech across devices.':'Legacy recording: historical model/voice revision was not recorded. Playback and export are preserved; new recordings use pinned inputs.';
 $('render-provenance').textContent=note+(job.settings?.pronunciation?' Pronunciation dictionary revision '+job.settings.pronunciation.revision+' is frozen for this recording. Draft rule edits do not affect it.':' No pronunciation substitutions are stored for this recording.')+(job.settings?.renderManifest?.checkpointIntegrity==='original-pcm-sha256-v1'?' Original PCM uses SHA-256 checkpoint validation.':' Historical original-audio checksum policy was not recorded.');
 const p=job.performance;
 $('render-performance').textContent=p?`Original passages: measured ${p.measured} of ${job.next}, ${(p.renderMs/1000).toFixed(2)} s render${job.settings?.renderManifest?` including ${(p.loadMs/1000).toFixed(2)} s loading; ${(p.inferenceMs/1000).toFixed(2)} s engine calls.`:'. Legacy summary does not establish a complete loading/inference breakdown; use the render report for recorded details.'} Providers: ${p.providers.join(', ')}. Cancelled attempts are not included.${job.takeSelection?.revision?' Alternative-take measurements, when recorded, are in the render report.':''}`:'No durable render timing was recorded for these passages.';
 if(preparation)$('artifact-performance').textContent=`This artifact: ${(preparation.preparationMs/1000).toFixed(2)} s preparation, ${(preparation.encodingMs/1000).toFixed(2)} s MP3 encoding (separate from synthesis). Timing does not measure speech accuracy.${persisted===false?' Preparation measurements (timing and PCM diagnostics) were not confirmed saved on this device.':''}`;
 else $('artifact-performance').textContent='MP3 preparation timing appears when an artifact is prepared.';
 $('artifact-performance').textContent+=' '+pcmReviewSummary(preparation?.pcmReview);
 $('render-report').disabled=busy()||!job.next;
}
function mediaControls(job){
  if(!navigator.mediaSession)return;
  if(window.MediaMetadata)navigator.mediaSession.metadata=new MediaMetadata({title:job.title,artist:'Sirmonator',album:`Chapter ${loadedChapter+1}`,artwork:[{src:new URL(base+'art/sirmonator-sermon-to-audio.webp',location.href).href,sizes:'1254x1254',type:'image/webp'}]});
  for(const [name,action] of Object.entries({play:()=>{$('audio').play().catch(()=>{});},pause:()=>{$('audio').pause();},seekbackward:()=>skip(-15),seekforward:()=>skip(15)})){try{navigator.mediaSession.setActionHandler(name,action);}catch{}}
}
function skip(delta){const a=$('audio');if(Number.isFinite(a.duration))a.currentTime=Math.max(0,Math.min(a.duration,a.currentTime+delta));}
async function savePosition(){if(store&&loadedJobId&&Number.isFinite($('audio').currentTime)&&$('audio').currentSrc===audioURL)await store.position(loadedJobId,{chapter:loadedChapter,time:$('audio').currentTime});}
const synthesisClient=createSynthesisClient({
 createWorker:()=>new Worker(new URL('./tts-worker.js',import.meta.url),{type:'module'}),
 onStage:status,onLoading:data=>status(`Downloading voice: ${Math.round(data.progress??0)}% of ${data.file??'file'}. Keep this page open.`)
});
function killWorker(){synthesisClient.cancel();}
function generate(text,voiceSettings,last,preview=false){const normalized=normalizeSettings(voiceSettings);return synthesisClient.generate({text,settings:normalized,last,preview},getVoice(normalized.voice).engine+':'+(normalized.pipeline===FOUNDATION_PIPELINE?'frozen':'legacy'));}
async function withLease(action){
  const leaseStore=store;
  const execute=async force=>{
    if(!await leaseStore.claim(owner,force))throw Error('Another window is creating audio. If it was closed, try Resume again in 20 seconds.');
    let lost=false;const interval=setInterval(()=>{leaseStore.renew(owner).then(ok=>{if(!ok){lost=true;killWorker();}}).catch(()=>{lost=true;killWorker();});},5000);
    try{return await action(()=>lost);}finally{clearInterval(interval);try{await leaseStore.release(owner);}catch(error){if(error.name!=='StorageClosedError')throw error;}}
  };
  if(navigator.locks)return navigator.locks.request('sirmonator-generation',{ifAvailable:true},lock=>{if(!lock)throw Error('Another Sirmonator window is creating audio. Pause it first.');return execute(true);});
  return execute(false);
}
async function createAudio(id){
  if(busy())return;
  if(!id&&$('engine').value==='device'){if(!$('review').checked){status('Review the selected text and check the confirmation.');return;}quickListen(rangeText());return;}
  if(!id&&$('engine').value==='studio'&&(boundaryError||draftBoundaryPolicy()!==WORD_BOUNDARIES)){status(boundaryError||'Choose New text boundaries, review the source, then create audio. Existing recordings retain their own policy.');$(boundaryError?'text':'text-boundaries').focus();return;}
  if(!id&&!$('review').checked){status('Review your selected text and check the confirmation.');$('review').focus();return;}
  if(!store||!storageReady){status('Local storage is unavailable. Retry local storage, download a text backup, or use Quick listen in More settings.');return;}
  const selection=beginSelection();creating=true;pauseRequested=false;cancelled=false;controls();status('Preparing your recording.');
  let job,viewReady=false;
  try{
    await flushDraft();
    if(id)job=await store.job(id);
    else{
      const text=rangeText();if(!$('review').checked){status('Review your selected text and check the confirmation.');$('review').focus();return;}
      if($('text').value.length>MAX_DOCUMENT)throw Error('Reduce the draft to under 2 million characters.');
      if($('engine').value==='device'){quickListen(text);return;}
      const estimate=await browserStorageEstimate({estimate:()=>navigator.storage?.estimate?.()});if(cancelled||pauseRequested){status(cancelled?'Cancelled before a new recording was saved. Existing passages were kept.':'Paused before a new recording was saved. Existing passages were kept.');return;}const needed=countWords(text)/150/Number($('speed').value)*60*96000*1.5+2*1024*1024;
      if(estimate?.quota&&estimate.quota-estimate.usage<needed)throw Error('The shared-origin storage estimate is below this recording’s estimated needs. Export existing audio and source text first; choose fewer chapters or another device. Estimates do not guarantee success.');
      job=await store.ensureJob(await makeRecording(text,settings(),$('title').value));
    }
    if(!job)throw Error('Recording not found.');
    audition.stop();$('audio').pause();controls();$('progress').hidden=false;
    if(await showRecording(job,{selection})===false||selection!==selectionToken)return;viewReady=true;await refreshLibrary();
    if(cancelled||pauseRequested){status(cancelled?'Cancelled preparation. Saved passages were kept.':'Paused before synthesis. Resume this recording when ready.');return;}
    if(job.next===job.passages.length){status('This recording is already complete. Listen or save it below.');return;}
    navigator.wakeLock?.request('screen').then(lock=>{if(creating)wake=lock;else lock.release().catch(()=>{});}).catch(()=>{});
    const started=performance.now(),initial=job.next;let sinceSaved=0;
    job=await withLease(lost=>runRecording({store,id:job.id,owner,generate,shouldPause:()=>pauseRequested||cancelled||lost(),onSaved:async saved=>{
      job=saved;selectedJob=saved;$('progress').value=saved.next/saved.passages.length;displayProgress(saved);
      const elapsed=(performance.now()-started)/1000,done=saved.next-initial,remaining=(saved.passages.length-saved.next)*elapsed/Math.max(1,done);
      status(`${saved.next} of ${saved.passages.length} passages saved.${done>=2?' Roughly '+Math.max(1,Math.round(remaining/60))+' min creation remaining.':' Estimating creation time…'}`);
      if(!audioURL&&saved.next)await loadChapter(availableChapters(saved)[0]);
      if(++sinceSaved===1)await refreshLibrary();
    }}));
    status(job.next===job.passages.length?'Complete. Your MP3 is ready to listen or save.':`Paused. ${job.next} passages are saved. Resume whenever you are ready.`);
  }catch(error){status(warn(error));}
  finally{creating=false;synthesisClient.idle();wake?.release().catch(()=>{});wake=null;controls();
    if(viewReady&&job&&selection===selectionToken)try{const latest=await store.job(job.id)??job;await validateCheckpoint(store,latest);if(selection===selectionToken){selectedJob=latest;displayProgress(selectedJob);await refreshLibrary();}}catch(error){if(selection===selectionToken)status(warn(error));}
  }
}
function quickListen(text){
  quickListener.start({text,voice:deviceVoices[Number($('voice').value)],speed:Number($('speed').value)});
}
async function exportAudio({chapter=null,share=false}={}){
  if(busy()||!selectedJob)return;$('preparation-meter').hidden=true;exporting=true;controls();$('export-status').textContent='Preparing saved MP3 passages…';
  const id=selectedJob.id,selection=selectionToken,controller=new AbortController();exportController=controller;
  const options={signal:controller.signal,isCurrent:()=>selectedJob?.id===id&&selectionToken===selection,onProgress:value=>{if(selectedJob?.id===id&&selectionToken===selection)showPreparationProgress($,value,'MP3','export-status');}},check=()=>assertActive(options);
  try{const job=await abortable(store.job(id),controller.signal);check();if((job.takeSelection?.revision??0)!==(selectedJob.takeSelection?.revision??0))throw Error('Passage selection changed in another window. Load latest saved audio before export.');const {blob,metrics,metricsPersisted}=await recordingBlob(store,job,chapter,undefined,options);check();renderDetails(job,metrics,metricsPersisted);
    const partial=job.next<job.passages.length;const filename=safeFilename(job.title)+(chapter!==null?'-chapter-'+(chapter+1):'')+(partial?'-partial':'')+(job.takeSelection?.revision?'-takes-r'+job.takeSelection.revision:'')+'.mp3';
    const file=new File([blob],filename,{type:'audio/mpeg'});
    if(share){if(!navigator.canShare?.({files:[file]}))throw Error('File sharing is unavailable here. Use Save MP3 instead.');await navigator.share({files:[file],title:job.title});$('export-status').textContent='Share sheet closed. Your saved recording is still available.';}
    else{saveFile(blob,filename);$('export-status').textContent=`Download started: ${filename} (${(blob.size/1048576).toFixed(1)} MB).${partial?' This contains saved passages only, not the complete source.':''}`;}
  }catch(error){$('export-status').textContent=error.name==='AbortError'?'Audio preparation cancelled. Your audio is still saved.':warn(error);}finally{if(exportController===controller)exportController=null;exporting=false;controls();}
}
$('start').onclick=()=>createAudio();$('resume-recording').onclick=()=>createAudio(selectedJob?.id);
$('pause').onclick=()=>{if(quick){quickListener.togglePause();}else{pauseRequested=true;status('Pausing after the current passage is saved…');}controls();};
$('stop').onclick=()=>{if(importing){sourceImporter?.cancel();return;}killWorker();if(typeof takeEditor!=='undefined')takeEditor?.cancel();if(typeof speechReview!=='undefined')speechReview?.cancel();if(typeof referenceEditor!=='undefined')referenceEditor?.cancel();cancelPreparations();renderToken++;if(creating){cancelled=true;status('Cancelled the current passage. Completed passages are saved.');}else if(quick){quickListener.stop();}else{audition.stop();status('Audio preparation cancelled. Saved passages were kept.');}};
$('preview').onclick=()=>{if($('engine').value==='studio')audition.play(auditionUrl($('voice').value,base,$('voice-edition').value));else quickListen('Good morning, church. Let us begin.');};
$('custom-preview').onclick=async()=>{if(busy())return;if(boundaryError){status(boundaryError);$('text').focus();return;}let first;try{first=chunkSource(rangeText(),draftBoundaryPolicy())[0]??'';}catch(error){status(error.message);return;}if(!first.trim()){status('Add text first.');return;}if($('engine').value==='device'){quickListen(first);return;}
  creating=true;cancelled=false;controls();try{const audio=await generate(first,settings(),true,true);const nextURL=URL.createObjectURL(new Blob([audio.bytes],{type:'audio/mpeg'}));if(previewURL)URL.revokeObjectURL(previewURL);previewURL=nextURL;$('audition-audio').src=previewURL;$('audition-audio').hidden=false;$('audition-audio').play().catch(()=>{});status('Your passage preview is ready. Press Play in the sample player.');}catch(error){status(warn(error));}finally{creating=false;synthesisClient.idle();controls();}
};
$('engine').onchange=()=>{$('review').checked=false;fillVoices();narratorNote();updateText({resetRange:false});};$('voice').onchange=()=>{$('voice-edition').value='refined';narratorNote();scheduleSave();};
for(const id of ['voice-edition','delivery','speed'])$(id).onchange=()=>{narratorNote();scheduleSave();};$('speed').oninput=()=>{$('speed-value').textContent=Number($('speed').value)+'×';preflight();scheduleSave();};
$('title').oninput=scheduleSave;$('review').onchange=scheduleSave;
$('text-boundaries').onchange=()=>{$('review').checked=false;updateText();};
$('text').oninput=()=>{$('source').textContent='Edited / pasted text';$('import-note').hidden=true;$('review').checked=false;updateText();};
for(const id of ['range-from','range-to'])$(id).onchange=()=>updateRange();
$('remember').onchange=async()=>{try{if($('remember').checked)await flushDraft();else{clearTimeout(draftTimer);await saveChain.catch(()=>{});await store?.deleteDraft();$('save-status').textContent='Draft autosave off. Created recordings remain saved separately.';}}catch(error){$('save-status').textContent=warn(error);}};
$('backup-draft').onclick=()=>saveFile(new Blob([$('text').value],{type:'text/plain;charset=utf-8'}),safeFilename($('title').value)+'-source.txt');
$('clear').onclick=()=>{undo=draft();$('source').textContent='Paste or upload text';$('import-note').hidden=true;$('text').value='';$('review').checked=false;$('undo-clear').hidden=false;updateText();};
$('undo-clear').onclick=()=>{if(!undo)return;$('review').checked=false;$('source').textContent='Restored text — review before creating';$('import-note').hidden=true;$('text').value=undo.text;$('title').value=undo.title;$('text-boundaries').value=undo.boundaryPolicy??LEGACY_BOUNDARIES;$('undo-clear').hidden=true;updateText();};
$('sample').onclick=()=>{$('import-note').hidden=true;$('text').value='Good morning, church. Today, let us make room for hope.\n\nEven in a difficult season, we can show kindness to a neighbor, listen to a friend, and take the next faithful step.\n\nMay our words become actions, and may our actions reflect love. Amen.';$('title').value='Example sermon';$('review').checked=false;$('source').textContent='Example sermon';updateText();};
document.querySelectorAll('[data-voice]').forEach(b=>b.onclick=()=>{$('review').checked=false;$('engine').value='studio';fillVoices();$('voice').value=b.dataset.voice;$('voice-edition').value='refined';narratorNote();updateText({resetRange:false});$('choose-voice').scrollIntoView({behavior:'smooth'});});
sourceImporter=createSourceImporter({read:importDocument,getRevision:()=>draftRevision,onIntent:()=>{dirty=true;draftRevision++;},onReading:value=>{importing=value;controls();},apply:(result,file)=>{$('text').value=result.text;$('title').value=file.name.replace(/\.[^.]+$/,'');$('source').textContent=file.name;$('review').checked=false;$('import-note').hidden=false;$('import-note').textContent=result.note;updateText();},persist:flushDraft,notify:status,formatError:warn});
$('file').onchange=()=>{const file=$('file').files[0];$('file').value='';if(file)return sourceImporter.start(file);};
const upload=$('file').previousElementSibling;upload.tabIndex=0;upload.setAttribute('role','button');upload.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&!busy()){e.preventDefault();$('file').click();}};
$('saved-recordings').onchange=controls;$('open-recording').onclick=openRecording;
$('delete-recording').onclick=async()=>{const id=$('saved-recordings').value;if(!id||!confirm('Delete this saved recording, its audio and saved manual reviews from this browser? Download a copy first.'))return;beginSelection();try{if(typeof speechReview!=='undefined')await speechReview?.deleteJob(id);await store.deleteJob(id);if(selectedJob?.id===id){renderToken++;selectedJob=null;$('audio').pause();$('audio').removeAttribute('src');if(audioURL)URL.revokeObjectURL(audioURL);audioURL=null;$('result').hidden=true;$('empty-player').hidden=false;}await refreshLibrary();status('Recording deleted from this browser. Your draft was kept.');}catch(error){status(warn(error));}};
$('play-chapter').onchange=changeChapter;$('refresh-audio').onclick=()=>loadChapter(loadedChapter,$('audio').currentTime);
$('back').onclick=()=>skip(-15);$('forward').onclick=()=>skip(15);$('playback-speed').onchange=()=>{$('audio').playbackRate=Number($('playback-speed').value);};
$('audio').ontimeupdate=()=>{if(Date.now()-positionSaved>1000){positionSaved=Date.now();savePosition().catch(()=>{});}};$('audio').onpause=()=>savePosition().catch(()=>{});
$('audio').onended=async()=>{if((typeof playbackController!=='undefined'&&playbackController)||!selectedJob||selectedJob.id!==loadedJobId)return;const id=loadedJobId,selection=selectionToken,render=renderToken;const job=await store.job(id).catch(error=>{if(selection===selectionToken)status(warn(error));return null;});if(render!==renderToken||selection!==selectionToken||selectedJob?.id!==id||loadedJobId!==id||!job)return;if((job.takeSelection?.revision??0)!==(selectedJob.takeSelection?.revision??0)){$('export-status').textContent='Passage selection changed in another window. Load latest saved audio before continuing or exporting.';return;}selectedJob=job;
  const moreCurrent=job.passages.slice(loadedThrough,job.next).some(p=>p.chapter===loadedChapter);
  if(moreCurrent){const time=$('audio').currentTime;if(!await loadChapter(loadedChapter,time))return;if(selection!==selectionToken||selectedJob?.id!==id)return;$('audio').play().catch(()=>{});}
  else if(availableChapters(job).includes(loadedChapter+1)){if(!await loadChapter(loadedChapter+1))return;if(selection!==selectionToken||selectedJob?.id!==id)return;$('audio').play().catch(()=>{});}
  else if(job.next<job.passages.length)$('export-status').textContent='You reached the saved audio. More is still being created; use Load latest saved audio when ready.';
};
$('download').onclick=()=>exportAudio();$('download-chapter').onclick=()=>exportAudio({chapter:loadedChapter});$('share').onclick=()=>exportAudio({share:true});
$('transcript').onclick=()=>{if(selectedJob)saveFile(new Blob([selectedJob.source],{type:'text/plain;charset=utf-8'}),safeFilename(selectedJob.title)+'-reviewed-source.txt');};
window.addEventListener('pagehide',()=>{sourceImporter?.cancel({silent:true});referenceEditor?.cancel();speechReview?.cancel();takeEditor?.cancel();cancelPreparations();queueSave();savePosition().catch(()=>{});cancelled=true;killWorker();store?.release(owner).catch(()=>{});quickListener.stop({silent:true});});
window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();queueSave();}});
fillVoices();window.speechSynthesis?.addEventListener('voiceschanged',()=>{if(!busy()){fillVoices();narratorNote();}});narratorNote();controls();
async function initialize(){
  if(storageOpening)return;storageOpening=true;storageReady=false;controls();
  const selection=beginSelection();
  try{store?.close();store=await openStorage(undefined,undefined,{onState:storageStateChanged});storageReady=true;const saved=await store.draft();if(!storageReady)throw Error('Local storage connection changed during startup. Close other tabs and retry.');
    if(saved&&!dirty){$('text-boundaries').value=saved.boundaryPolicy===WORD_BOUNDARIES?WORD_BOUNDARIES:LEGACY_BOUNDARIES;pronunciationEditor.restoreDraft(saved.pronunciationDraft,saved.settings?.pronunciation);$('text').value=saved.text;$('title').value=saved.title;$('engine').value=saved.engine??'studio';fillVoices();if([...$('voice').options].some(o=>o.value===saved.settings?.voice))$('voice').value=saved.settings.voice;for(const [key,id] of [['edition','voice-edition'],['delivery','delivery'],['speed','speed']])if(saved.settings?.[key]!==undefined)$(id).value=saved.settings[key];updateText({save:false});$('range-from').value=String(Math.min(saved.from??0,Math.max(0,chapters.length-1)));$('range-to').value=String(Math.min(saved.to??0,Math.max(0,chapters.length-1)));updateRange(false);$('review').checked=!!saved.review;document.body.classList.toggle('has-draft',!!saved.text);}
    $('storage-state').textContent='Local recordings connected. Saved data was not reset.';
    $('save-status').textContent=dirty?'Your current draft was kept. Edit to autosave, or download a text backup.':saved?'Draft restored from this device. Download a text backup for safekeeping.':'Autosave ready. Drafts and recordings stay on this browser and device.';
    narratorNote();const jobs=await refreshLibrary();if(jobs?.length&&selection===selectionToken){document.body.classList.add('has-draft');$('saved-recordings').value=jobs[0].id;await showRecording(jobs[0],{selection});}
    const estimate=await browserStorageEstimate({estimate:()=>navigator.storage?.estimate?.()});$('storage-info').textContent=storageEstimateText(estimate);
  }catch(error){$('storage-state').textContent=warn(error);if(storageReady){$('save-status').textContent='Saved data could not be fully restored. Download a text backup and check My recordings.';status(warn(error));}else{$('save-status').textContent='Local saving unavailable: '+warn(error);status(error.name==='StorageVersionError'?warn(error):'Close other Sirmonator tabs and retry local storage. Text backup and Quick listen remain available.');}}
  finally{storageOpening=false;controls();}
}
$('retry-storage').onclick=()=>{if(!busy())return initialize();};
pronunciationEditor=createPronunciationEditor({$,source:rangeText,policy:draftBoundaryPolicy,onChange:()=>{$('review').checked=false;scheduleSave();}});
storageUsageEditor=createStorageUsageEditor({$,getStore:()=>store,getJob:()=>selectedJob,getSelection:()=>selectionToken,isBusy:()=>!storageReady||busy(),onBusy:controls});
takeEditor=createTakeEditor({$,getStore:()=>store,getJob:()=>selectedJob,isBusy:()=>!storageReady||creating||auditionBusy||importing||quick||exporting||speechReview?.busy||referenceEditor?.busy,withLease,generate,owner,notify:status,onBusy:controls,onChanged:async job=>{const chapter=loadedChapter;beginSelection();$('audio').pause();$('audio').removeAttribute('src');$('audio').onloadedmetadata=null;if(audioURL)URL.revokeObjectURL(audioURL);audioURL=null;loadedJobId=null;selectedJob=job;displayProgress(job);await loadChapter(chapter);await refreshLibrary();}});
speechReview=createSpeechReviewEditor({$,getStore:()=>store,getJob:()=>selectedJob,getSelection:()=>selectionToken,isBusy:()=>!storageReady||creating||auditionBusy||importing||quick||exporting||takeEditor?.busy||referenceEditor?.busy,onBusy:controls,onListen:async snapshot=>{if(!reviewSelectionMatches(selectedJob,snapshot))throw Error('Load current selected audio first.');if(!await loadChapter(snapshot.anchor.chapter,snapshot.chapterOffsetSeconds))throw Error('Audio preparation did not finish. Saved audio was kept.');if(!reviewSelectionMatches(selectedJob,snapshot))throw Error('Selection changed while preparing audio; load the current review again.');},onRepair:snapshot=>{$('passage-takes').open=true;$('take-passage').value=String(snapshot.anchor.passage);$('take-passage').onchange();},onExport:payload=>saveFile(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),safeFilename(selectedJob?.title??'Recording')+'-manual-review-'+(payload.snapshot?'passage-'+(payload.snapshot.anchor.passage+1)+'-r'+payload.snapshot.anchor.selectionRevision:'archive')+'.json')});
initialize();
referenceEditor=createReferenceEditor({$,isBusy:()=>creating||auditionBusy||importing||quick||exporting||takeEditor?.busy||speechReview?.busy,onBusy:controls});

function podcastFields(){return {showTitle:$('pod-show-title').value,showDescription:$('pod-show-description').value,author:$('pod-author').value,episodeTitle:$('pod-episode-title').value,episodeDescription:$('pod-episode-description').value,language:$('pod-language').value,category:$('pod-category').value,explicit:$('pod-explicit').value,audioUrl:$('pod-audio-url').value,artworkUrl:$('pod-artwork-url').value,feedUrl:$('pod-feed-url').value,websiteUrl:$('pod-website-url').value,rightsConfirmed:$('pod-rights').checked,spokenDisclosureConfirmed:$('pod-spoken').checked,artworkConfirmed:$('pod-artwork').checked};}
$('pod-export').onclick=async()=>{
 if(busy()||!selectedJob||!store){$('pod-status').textContent='Select a saved complete recording first.';return;}
 const id=selectedJob.id,fields=podcastFields();$('preparation-meter').hidden=true;exporting=true;controls();
 const selection=selectionToken,controller=new AbortController();exportController=controller;
 const options={signal:controller.signal,isCurrent:()=>selectedJob?.id===id&&selectionToken===selection,onProgress:value=>{if(selectedJob?.id===id&&selectionToken===selection)showPreparationProgress($,value,'MP3','pod-status');}},check=()=>assertActive(options);
 try{await abortable(flushPodcast(),controller.signal);check();let job=await abortable(store.job(id),controller.signal);check();if((job.takeSelection?.revision??0)!==(selectedJob.takeSelection?.revision??0))throw Error('Passage selection changed in another window. Load latest saved audio before export.');if(job.next!==job.passages.length)throw Error('Finish this recording first. Partial audio is not an episode.');
 await abortable(store.podcastGuid(job.id),controller.signal);check();job=await abortable(store.job(job.id),controller.signal);check();if((job.takeSelection?.revision??0)!==(selectedJob.takeSelection?.revision??0))throw Error('Passage selection changed. Load latest saved audio before export.');const artifact=await recordingBlob(store,job,null,undefined,options);check();const result=await abortable(episodePackage(job,artifact.blob,fields,{seconds:artifact.seconds,takeRevision:artifact.takeRevision}),controller.signal);check();
 saveFile(packageZip(result.files),safeFilename(job.title)+'-podcast-preparation.zip');$('pod-status').textContent='Preparation ZIP download started. Nothing was uploaded. '+result.metadata.warnings.join(' ');
 }catch(error){$('pod-status').textContent=warn(error);}finally{if(exportController===controller)exportController=null;exporting=false;$('pod-export').disabled=false;controls();}
};
function podcastHandoff(){const fields=podcastFields();$('pod-apple').disabled=busy()||!(publicUrl(fields.feedUrl)&&fields.rightsConfirmed&&fields.spokenDisclosureConfirmed&&fields.artworkConfirmed);}
for(const id of ['pod-feed-url','pod-rights','pod-spoken','pod-artwork'])$(id).addEventListener('change',podcastHandoff);
$('pod-apple').onclick=()=>{try{window.open(appleValidationUrl(podcastFields().feedUrl),'_blank','noopener,noreferrer');}catch(error){$('pod-status').textContent=warn(error);}};function restorePodcast(job){
 const fields=job.podcast??{};
 for(const [key,id] of Object.entries({showTitle:'pod-show-title',showDescription:'pod-show-description',author:'pod-author',episodeTitle:'pod-episode-title',episodeDescription:'pod-episode-description',language:'pod-language',category:'pod-category',explicit:'pod-explicit',audioUrl:'pod-audio-url',artworkUrl:'pod-artwork-url',feedUrl:'pod-feed-url',websiteUrl:'pod-website-url'}))$(id).value=fields[key]??(key==='episodeTitle'?job.title:key==='language'?'en':'');
 for(const [key,id] of Object.entries({rightsConfirmed:'pod-rights',spokenDisclosureConfirmed:'pod-spoken',artworkConfirmed:'pod-artwork'}))$(id).checked=fields[key]===true;
 podcastHandoff();
}
let podcastSaveTimer,podcastPending=null,podcastSaveChain=Promise.resolve();
async function flushPodcast(){
 clearTimeout(podcastSaveTimer);
 podcastSaveChain=podcastSaveChain.catch(()=>{}).then(async()=>{
  while(podcastPending&&store){
   const pending=podcastPending;await store.savePodcast(pending.id,pending.fields);
   if(podcastPending===pending)podcastPending=null;
  }
 });
 await podcastSaveChain;
}
$('podcast-prep').addEventListener('input',()=>{if(!selectedJob||!store)return;podcastPending={id:selectedJob.id,fields:podcastFields()};clearTimeout(podcastSaveTimer);podcastSaveTimer=setTimeout(()=>flushPodcast().catch(error=>{$('pod-status').textContent=warn(error);}),300);podcastHandoff();});
window.addEventListener('pagehide',()=>flushPodcast().catch(()=>{}));

$('render-report').onclick=async()=>{
 if(busy()||!selectedJob||!store)return;const id=selectedJob.id,selection=selectionToken,controller=new AbortController();exportController=controller;exporting=true;controls();
 const check=()=>assertActive({signal:controller.signal,isCurrent:()=>selectedJob?.id===id&&selectionToken===selection});
 try{const job=await abortable(store.job(id),controller.signal);check();if((job.takeSelection?.revision??0)!==(selectedJob.takeSelection?.revision??0))throw Error('Passage selection changed in another window. Load latest saved audio before export.');const report=await abortable(renderReport(store,job),controller.signal);check();saveFile(new Blob([JSON.stringify(withPcmReviewReport(report,job),null,2)],{type:'application/json'}),safeFilename(job.title)+'-render-report.json');$('export-status').textContent='Render report download started. Historical unknowns remain labeled.';}
 catch(error){$('export-status').textContent=warn(error);}finally{if(exportController===controller)exportController=null;exporting=false;controls();}
};
