import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageUsageEditor} from '../src/storage-usage-editor.js';
import {usageAnchor} from '../src/storage-usage.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function setup(){const map=new Map(),$=id=>{if(!map.has(id))map.set(id,{textContent:'',disabled:false});return map.get(id);};let job={id:'synthetic',next:2,bytes:600,createdAt:1,takeSelection:{revision:0}},selection=0,summary={schema:1,originalBytes:600,alternativeBytes:0,originalRows:2,alternativeRows:0,metadataJsonBytes:100,metadataComplete:true,scanComplete:true,unmeasurableAudioRows:0,rowsFetched:2,requests:3,through:2,takeRevision:0,measuredAt:Date.now()};const store={usage:async()=>({...summary,anchor:usageAnchor(job)}),job:async()=>job},editor=createStorageUsageEditor({$,getStore:()=>store,getJob:()=>job,getSelection:()=>selection,isBusy:()=>false,estimate:()=>undefined});return {$,store,editor,get job(){return job;},set job(value){job=value;},navigate(){selection++;editor.cancel();},summary};}
test('usage UI labels scoped sizes and unavailable browser estimates without disk/free-space guarantees',async()=>{
 const {$,editor}=setup();await $('recording-usage-refresh').onclick();assert.match($('recording-usage-summary').textContent,/Original audio: 600 B.*Alternative takes: 0 B.*not actual disk allocation.*plus one freshness read/);assert.match($('recording-usage-summary').textContent,/estimate unavailable/);assert.equal(editor.busy,false);assert.equal($('recording-usage-cancel').disabled,true);
});
test('navigation/cancel prevents deferred usage result publication and preserves selected context',async()=>{
 const view=setup(),gate=deferred();let signal;view.store.usage=(id,options)=>{signal=options.signal;return gate.promise;};const pending=view.$('recording-usage-refresh').onclick();view.navigate();assert.equal(signal.aborted,true);gate.resolve({...view.summary,anchor:usageAnchor(view.job)});await pending;assert.equal(view.$('recording-usage-summary').textContent,'');assert.equal(view.editor.busy,false);
});
test('another connection changing the selected revision rejects the finished snapshot without adopting its selection',async()=>{
 const view=setup(),original=view.job;view.store.job=async()=>({...original,takeSelection:{revision:1}});await view.$('recording-usage-refresh').onclick();assert.match(view.$('recording-usage-status').textContent,/Recording changed/);assert.equal(view.$('recording-usage-summary').textContent,'');assert.equal(view.job.takeSelection.revision,0);
});
test('partial scans never present total payloads as complete',async()=>{
 const view=setup();view.summary.scanComplete=false;view.summary.metadataComplete=false;await view.$('recording-usage-refresh').onclick();const text=view.$('recording-usage-summary').textContent;assert.match(text,/Partial scan.*unknown \/ measurement budget/);assert.doesNotMatch(text,/Measured payload:/);
});
