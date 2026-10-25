import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// Emit canonical repository bytes rather than maintaining duplicate licenses.
// These notices address the named components, not a complete license audit.
export const noticeAssets=[
 ['src/vendor/SOUNDTOUCH-LICENSE','vendor/SOUNDTOUCH-LICENSE.txt'],
 ['src/vendor/SUPERTONIC-LICENSE','vendor/SUPERTONIC-LICENSE.txt'],
 ['src/vendor/SUPERTONIC-MODEL-LICENSE','vendor/SUPERTONIC-MODEL-LICENSE.txt'],
 ['src/vendor/pocket/LICENSE','vendor/POCKET-LICENSE.txt'],
 ['src/vendor/pocket/README.md','vendor/POCKET-SOURCE-NOTICE.txt'],
];
const canonical=source=>readFile(fileURLToPath(new URL('../'+source,import.meta.url)));
export function thirdPartyNotices(){return {name:'sirmonator-third-party-notices',configureServer(server){
 server.middlewares.use(async(req,res,next)=>{
  const entry=noticeAssets.find(([,target])=>req.url?.split('?')[0]==='/'+target);if(!entry)return next();
  try{const bytes=await canonical(entry[0]);res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(bytes);}catch(error){next(error);}
 });
},async generateBundle(){
 for(const [source,fileName] of noticeAssets)this.emitFile({type:'asset',fileName,source:await canonical(source)});
}};}
