import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {abortable} from '../src/continuity.js';
import {createStorageUsageEditor} from '../src/storage-usage-editor.js';
import {usageAnchor} from '../src/storage-usage.js';
test('actual Refresh audio handler invalidates measured revision zero when another connection changed selected takes',async()=>{
 const main=await readFile('src/main.js','utf8'),player=main.slice(main.indexOf('async function loadChapter('),main.indexOf('function mediaControls(')),handler=main.split('\n').find(line=>line.startsWith("$('play-chapter').onchange=")),map=new Map(),$=id=>{if(!map.has(id))map.set(id,{value:'1',textContent:'',hidden:false,currentTime:0,pause(){}});return map.get(id);},original={id:'synthetic',next:1,bytes:600,createdAt:1,passages:[{chapter:0}],takeSelection:{revision:0}};let fresh=original,takeUiRevision;
 const context=vm.createContext({$,busy:()=>false,selectedJob:original,renderToken:0,selectionToken:0,loadedChapter:0,loadedThrough:1,loadedJobId:original.id,audioURL:null,playbackController:null,AbortController,abortable,controls(){},chapterCache:{},store:{job:async()=>fresh},createPlaybackPreparation:async(_store,job)=>({job,prepare:async()=>({blob:new Blob(['synthetic'])}),dispose(){}}),URL:{createObjectURL:()=> 'blob:new',revokeObjectURL(){}},mediaControls(){},warn:error=>error.message,takeEditor:{update:job=>{takeUiRevision=job.takeSelection.revision;}}});
 const store={job:async()=>fresh,usage:async()=>({anchor:usageAnchor(original),originalBytes:600,alternativeBytes:0,originalRows:1,alternativeRows:0,metadataJsonBytes:100,metadataComplete:true,scanComplete:true,rowsFetched:1,requests:3,through:1,takeRevision:0,measuredAt:Date.now()})};context.storageUsageEditor=createStorageUsageEditor({$,getStore:()=>store,getJob:()=>context.selectedJob,getSelection:()=>0,isBusy:()=>false,estimate:()=>undefined});context.storageUsageEditor.update(original);await $('recording-usage-refresh').onclick();assert.match($('recording-usage-summary').textContent,/Alternative takes: 0 B/);
 vm.runInContext(player+'\n'+handler,context);fresh={...original,takeSelection:{revision:1,selected:{0:'new-take'}}};await $('refresh-audio').onclick();assert.equal(context.selectedJob.takeSelection.revision,1);assert.equal(takeUiRevision,1);assert.equal($('recording-usage-summary').textContent,'');assert.match($('recording-usage-status').textContent,/not current.*Refresh/);
});
