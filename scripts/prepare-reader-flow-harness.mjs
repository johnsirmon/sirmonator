// Local synthetic UX QA only. Never requests a speech model.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
const port=process.argv.find(arg=>arg.startsWith('--port='))??'--port=4395';
execFileSync(process.execPath,['scripts/prepare-integration-harness.mjs',port],{stdio:'inherit'});
let main=await readFile('.cache/integration-main.js','utf8');
// The relocated main must still point to the production MP3 preparation worker.
main=main.replace("new URL('./mp3-review-worker.js',import.meta.url)","new URL('/src/mp3-review-worker.js',import.meta.url)");
if(process.argv.includes('--browser-download')){
 const sink=(await readFile('src/main.js','utf8')).split('\n').find(line=>line.startsWith('function saveFile('));
 if(!sink)throw Error('Review the production save function before using this harness');
 main=main.replace('function saveFile(blob,filename){window.captureIntegrationArtifact(blob,filename);}',sink).replaceAll('Harness captured in memory:','Download started:');
}
await writeFile('.cache/integration-main.js',main);
const html=(await readFile('.cache/integration-app.html','utf8')).replaceAll('<audio ','<audio muted ');
await writeFile('.cache/integration-app.html',html);
await writeFile('.cache/narrow-flow.html','<!doctype html><html><head><title>375px desktop reader QA</title><style>body{margin:0;background:#eee}iframe{width:375px;height:812px;border:0;display:block}</style></head><body><iframe title="375 pixel desktop reader fixture" src="/.cache/integration-app.html"></iframe></body></html>');
console.log('Muted synthetic QA ready. Native file saving: '+process.argv.includes('--browser-download'));
