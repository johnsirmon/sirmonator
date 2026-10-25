// Extract immutable local Git objects only. No checkout, download or model load.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,posix,resolve} from 'node:path';
import {createHash} from 'node:crypto';
export const DEPLOYED_BASE='c2f5cbbe980a8af6587bee3d4d95e7aa21fc5296';
export async function prepareCompatibilitySnapshot(){
 const root=resolve('.cache/compatibility-c2f5cbb'),files={},pending=['src/recording.js','src/storage.js','src/job-runner.js','src/mp3.js','src/mp3-export-worker.js','public/vendor/lamejs.js'];
 while(pending.length){const path=pending.pop();if(files[path])continue;if(path!=='public/vendor/lamejs.js'&&(!path.startsWith('src/')||!/^src\/[a-zA-Z0-9_./-]+\.(?:js|json)$/.test(path)))throw Error('Unexpected snapshot path');
  const bytes=execFileSync('git',['-c','core.fsmonitor=false','show',DEPLOYED_BASE+':'+path],{maxBuffer:4*1024*1024,windowsHide:true}),text=bytes.toString('utf8');files[path]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};await mkdir(dirname(resolve(root,path)),{recursive:true});await writeFile(resolve(root,path),bytes);
  for(const match of text.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]/g)){const dependency=posix.normalize(posix.join(posix.dirname(path),match[1]));if(/\.(js|json)$/.test(dependency))pending.push(dependency);}
 }
 const manifest={schema:1,commit:DEPLOYED_BASE,kind:'Unmodified local Git object extraction; no model assets',files:Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)))};await writeFile(resolve(root,'snapshot.json'),JSON.stringify(manifest,null,2)+'\n');return {root,manifest};
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/prepare-compatibility-snapshot.mjs'))console.log(JSON.stringify(await prepareCompatibilitySnapshot()));
