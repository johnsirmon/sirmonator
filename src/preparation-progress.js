// Progress counts encoder acknowledgements, never elapsed-time estimates.
export function showPreparationProgress($,value,prefix='MP3',target='preparation-status'){
 const {phase,completedParts,totalParts}=value;
 const count=`${completedParts} of ${totalParts} audio passages encoded`;
 const text=phase==='starting'?'Starting encoder.':phase==='encoding'?count+'.':phase==='finalizing'?count+'. Finalizing MP3.':phase==='complete'?'MP3 encoding complete.':phase==='cancelled'?'Preparation cancelled. Saved audio remains available.':value.error||'Preparation failed. Retry from saved audio.';
 $(target).textContent=prefix+': '+text;
 const meter=$('preparation-meter');meter.max=Math.max(1,totalParts);meter.value=completedParts;meter.hidden=['complete','failed','cancelled'].includes(phase);
}
