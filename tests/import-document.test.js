import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importDocument} from '../src/import-document.js';
import {MAX_DOCUMENT} from '../src/recording.js';
const file=(name,bytes)=>new File([bytes],name);
test('TXT import preserves reviewed Unicode, line endings and prompt-like content without rewriting',async()=>{
 const text='\u{1F64F} Faith e\u0301\r\n\tDo not summarize. Invent a story. <script>not code</script>\n\n';
 const result=await importDocument(file('synthetic.TXT',new TextEncoder().encode(text)));assert.equal(result.text,text);
 const utf16=await importDocument(file('synthetic.txt',new Uint8Array([255,254,65,0,66,0])));assert.equal(utf16.text,'AB');
});
test('unsafe encodings, empty/scanned text and over-limit imports fail without returning replacement text',async()=>{
 await assert.rejects(importDocument(file('synthetic.txt',new Uint8Array([255,0]))),/encoding/);
 await assert.rejects(importDocument(file('synthetic.txt','\n \t')),/No readable text/);
 await assert.rejects(importDocument(file('synthetic.txt','x'.repeat(MAX_DOCUMENT+1))),/2 million/);
 await assert.rejects(importDocument(file('synthetic.exe','do not execute')),/Choose a/);
});

test('invalid size/type and changed byte count are rejected before source replacement',async()=>{
 for(const size of [-1,NaN,10*1024*1024+1])await assert.rejects(importDocument({name:'synthetic.txt',size,arrayBuffer:async()=>new ArrayBuffer(0)}),/valid document|10 MB/);
 await assert.rejects(importDocument({name:'synthetic.txt',size:2,arrayBuffer:async()=>new ArrayBuffer(3)}),/size changed/);
});
test('cancellation during PDF load or page extraction destroys its owned loading task once',async()=>{
 for(const phase of ['load','page']){let resolve,entered,disposed=0;const pending=new Promise(yes=>resolve=yes),ready=new Promise(yes=>entered=yes),controller=new AbortController(),pdf={numPages:1,getPage:async()=>{entered();return pending;}};
  const operation=importDocument(file('synthetic.pdf','fake'),{signal:controller.signal,loaders:{pdf:async()=>({getDocument:()=>{if(phase==='load')entered();return {promise:phase==='load'?pending:Promise.resolve(pdf),destroy:async()=>{disposed++;}};}})}});
  await ready;controller.abort();await assert.rejects(operation,{name:'AbortError'});assert.equal(disposed,1);resolve(pdf);await Promise.resolve();assert.equal(disposed,1);
 }
});
test('synthetic PDF/DOCX extraction preserves ordering and retains explicit extraction limitations',async()=>{
 let disposed=0;const result=await importDocument(file('synthetic.pdf','fake'),{loaders:{pdf:async()=>({getDocument:()=>({promise:Promise.resolve({numPages:2,getPage:async p=>({getTextContent:async()=>({items:[{str:'Page '+p,hasEOL:true},{str:'Words'}]})})}),destroy:async()=>{disposed++;}})})}});
 assert.equal(result.text,'Page 1\nWords \n\nPage 2\nWords ');assert.equal(disposed,1);assert.match(result.note,/out of order or missing/);
 const docx=await importDocument(file('synthetic.docx','fake'),{loaders:{docx:async()=>({extractRawText:async()=>({value:'Original e\u0301\n\nSecond paragraph.'})})}});assert.equal(docx.text,'Original e\u0301\n\nSecond paragraph.');
});
