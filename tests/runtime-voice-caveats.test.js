import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile('index.html','utf8');
function description(control,id){
 const tag=html.match(new RegExp('<(?:select|button)\\b[^>]*\\bid="'+control+'"[^>]*>'))?.[0];
 assert.ok(tag,'Control exists: '+control);
 const refs=tag.match(/aria-describedby="([^"]+)"/)?.[1].split(/\s+/)??[];
 assert.ok(refs.includes(id),'Control exposes its caveat: '+control);
 assert.equal([...html.matchAll(new RegExp('\\bid="'+id+'"','g'))].length,1,'Description ID is unique');
 const note=html.match(new RegExp('<p\\b[^>]*\\bid="'+id+'"[^>]*>([^<]+)</p>'));
 assert.ok(note,'Plain-text caveat exists');assert.doesNotMatch(note[0],/\bhidden\b|aria-hidden="true"/);
 return note[1];
}

test('Quick listen privacy caveat is beside the mode selector and accessible without changing mode choices',()=>{
 const note=description('engine','engine-privacy');
 assert.match(note,/Quick listen.*OS or vendor online services/);assert.match(note,/Offline or private processing is not guaranteed/);
 assert.match(html,/<label for="engine">Listening mode<\/label><select id="engine"[^>]*><option value="studio" selected>Studio · MP3 downloads and resume<\/option><option value="device">Quick listen · device voices, no recording<\/option><\/select><p id="engine-privacy"/);
});

test('regeneration caveat is in the take panel and associated with the existing regeneration action',()=>{
 const note=description('take-regenerate','take-expectation');assert.match(note,/frozen inputs can produce identical audio/);assert.match(note,/Improvement is not guaranteed/);
 const panel=html.slice(html.indexOf('<details id="passage-takes">'),html.indexOf('<details id="speech-review">'));
 assert.ok(panel.includes('id="take-expectation"'));
 for(const id of ['take-regenerate','take-select','take-undo'])assert.match(panel,new RegExp('<button id="'+id+'"[^>]*class="secondary"'));
});
