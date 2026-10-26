import test from 'node:test';
import assert from 'node:assert/strict';
import {installReaderHistory} from '../src/reader-flow.js';

// Browser-like hash history: same-hash navigation creates no entry; Back and
// Forward restore URL entries and dispatch hashchange without app navigation.
function historyWindow(initialHash) {
  const entries=[initialHash],listeners=[]; let index=0;
  const dispatch=()=>listeners.forEach(listener=>listener());
  const window={location:{},addEventListener(type,listener){assert.equal(type,'hashchange');listeners.push(listener);}};
  Object.defineProperty(window.location,'hash',{
    get:()=>entries[index],
    set:value=>{const hash=value.startsWith('#')?value:'#'+value;if(hash===entries[index])return;entries.splice(++index);entries.push(hash);dispatch();},
  });
  return {window,back(){if(index){index--;dispatch();}},forward(){if(index<entries.length-1){index++;dispatch();}},get length(){return entries.length;}};
}

for(const initial of ['', '#reader', '#unrelated-anchor'])test(`Back to ${initial || 'landing page'} restores Add text after repeated stage navigation`,()=>{
  const history=historyWindow(initial),calls=[];
  let visible;
  const go=installReaderHistory(history.window,(stage,focus=true)=>{visible=stage;calls.push({stage,focus});});
  assert.deepEqual(calls,[{stage:'add-text',focus:false}]);
  go('choose-voice'); assert.equal(visible,'choose-voice');
  history.back(); assert.equal(history.window.location.hash,initial);assert.equal(visible,'add-text');
  history.forward();assert.equal(visible,'choose-voice');
  go('create-audio');go('listen');
  for(let repeat=0;repeat<3;repeat++){
    history.back();assert.equal(visible,'create-audio');
    history.back();assert.equal(visible,'choose-voice');
    history.back();assert.equal(visible,'add-text');
    history.forward();assert.equal(visible,'choose-voice');
    history.forward();assert.equal(visible,'create-audio');
    history.forward();assert.equal(visible,'listen');
  }
  assert.ok(calls.slice(1).every(call=>call.focus));
});

for(const initial of ['#listen','#choose-voice','#create-audio','#add-text'])test(`direct entry ${initial} survives Back/Forward and same-stage activation`,()=>{
  const history=historyWindow(initial),calls=[];
  const go=installReaderHistory(history.window,(stage,focus=true)=>calls.push({stage,focus}));
  assert.deepEqual(calls[0],{stage:initial.slice(1),focus:false});
  go(initial.slice(1));assert.equal(history.length,1);assert.equal(calls.at(-1).stage,initial.slice(1));
  go('invalid');assert.equal(history.length,1);
  const next=initial==='#listen'?'add-text':'listen';go(next);
  history.back();assert.equal(calls.at(-1).stage,initial.slice(1));
  history.forward();assert.equal(calls.at(-1).stage,next);
  history.window.location.hash='#reader';assert.equal(calls.at(-1).stage,'add-text');
  history.back();assert.equal(calls.at(-1).stage,next);
});
