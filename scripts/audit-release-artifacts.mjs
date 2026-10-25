// Offline, read-only artifact checks. No credential contents are recorded.
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {sourceSnapshot} from './update-render-catalog.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function inventory(root){const result={};async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,item.name);if(item.isDirectory())await walk(p);else if(item.isFile()){const bytes=await readFile(p);result[relative(root,p).replaceAll('\\','/')]={bytes:bytes.length,sha256:hash(bytes)};}}}await walk(root);return Object.fromEntries(Object.entries(result).sort());}
const [a,b]=process.argv.slice(2).map(p=>resolve(p));assert.ok(a&&b&&a!==b,'Two distinct build directories required');
const first=await inventory(a),second=await inventory(b);assert.ok(first['index.html']&&Object.keys(first).length>10,'Complete nonempty build required');assert.deepEqual(first,second,'Build contents differ');
const publicFiles=await inventory(resolve('public'));for(const [p,value] of Object.entries(publicFiles))assert.deepEqual(first[p],value,'Public asset missing or changed: '+p);
const catalog=JSON.parse(await readFile('src/render-assets.json','utf8'));assert.deepEqual(await sourceSnapshot(),catalog.source,'Render catalog stale or incomplete');
const findings=[];for(const p of Object.keys(first)){
 if(/(^|\/)(?:\.cache|tests?|evidence|scripts|node_modules)(\/|$)|\.map$/.test(p))findings.push({category:'unexpected packaged path or sourcemap',path:p});
 if(!['.js','.mjs','.html','.css','.json','.txt'].includes(extname(p)))continue;
 const text=await readFile(resolve(a,p),'utf8');
 for(const [category,pattern] of Object.entries({localUserPath:/C:[\\/]+Users[\\/]+John|C:[\\/]+source[\\/]+Tina/i,credentialMarker:/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgithub_pat_[a-zA-Z0-9_]{20,}|\bgh[pousr]_[a-zA-Z0-9]{20,}/,sourceMapComment:/\/[/#@]\s*sourceMappingURL\s*=/,testFixture:/Synthetic optional quota|Historical-code regression effectiveness/}))if(pattern.test(text))findings.push({category,path:p});
}
assert.deepEqual(findings,[],'Artifact scan findings (category/location only): '+JSON.stringify(findings));
const base=new URL('https://example.invalid/sirmonator/'),html=await readFile(resolve(a,'index.html'),'utf8');let checkedHtmlUrls=0;
for(const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)){const value=match[1];if(/^(?:#|data:|https?:|mailto:)/.test(value))continue;const url=new URL(value,base);assert.ok(url.pathname.startsWith(base.pathname),'Asset escapes Pages base');const path=decodeURIComponent(url.pathname.slice(base.pathname.length));assert.ok(first[path||'index.html'],'Missing HTML asset: '+path);checkedHtmlUrls++;}
let checkedLiteralUrls=0;const unresolvedLiteralUrls=[];
for(const p of Object.keys(first).filter(p=>/\.(?:m?js)$/.test(p))){const text=await readFile(resolve(a,p),'utf8');for(const match of text.matchAll(/new URL\(["'`]([^"'`$]+)["'`],import\.meta\.url\)/g)){if(/^(?:data:|https?:)/.test(match[1]))continue;const url=new URL(match[1],new URL(p,base));assert.ok(url.pathname.startsWith(base.pathname),'Literal URL escapes Pages base: '+p);const target=decodeURIComponent(url.pathname.slice(base.pathname.length));if(!first[target])unresolvedLiteralUrls.push({from:p,target});else checkedLiteralUrls++;}}
for(const p of ['vendor/lamejs.js',...['prime','fenix','prime-v2','fenix-v2'].map(id=>'references/'+id+'.wav')])assert.ok(first[p],'Missing dynamic application asset: '+p);
const report={schema:1,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),sameHostTwoBuildsByteIdentical:true,fileCount:Object.keys(first).length,publicFileCount:Object.keys(publicFiles).length,checkedHtmlUrls,checkedLiteralUrls,unresolvedLiteralUrls,catalogSourceFiles:Object.keys(catalog.source.files).length,findings,files:first,limits:'Offline static audit on this host, not cross-platform reproducibility or a security certification. Browser worker/WASM/model loading, CDN paths, media playback and deployment unrun. Literal URL checking is not exhaustive dynamic execution. Hashes bind build bytes and required catalog source files, not downloaded model contents.'};
await mkdir('evidence',{recursive:true});await writeFile('evidence/release-artifact-audit.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,files:undefined}));
