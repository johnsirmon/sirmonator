import {safeFilename} from './recording.js';

// Filename policy belongs to export, not frozen text/render inputs.
const reserved=/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
export function portableFilename(title){const stem=safeFilename(title);return reserved.test(stem)?'sirmonator-'+stem:stem;}
export function assertArchiveName(name){
 if(typeof name!=='string'||!name||!name.isWellFormed()||name==='.'||name==='..'||/[<>:"/\\|?*\u0000-\u001f\u007f]/u.test(name)||/[ .]$/.test(name)||reserved.test(name.normalize('NFKC'))||new TextEncoder().encode(name).length>255)throw Error('Archive entries require portable single-file names without paths.');
}
