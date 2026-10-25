import {decodeText,MAX_DOCUMENT} from './recording.js';
import {abortable,assertActive} from './continuity.js';
const loadDocx=async()=>(await import('mammoth/mammoth.browser')).default;
const loadPdf=async()=>{const pdfjs=await import('pdfjs-dist'),{default:url}=await import('pdfjs-dist/build/pdf.worker.min.mjs?url');pdfjs.GlobalWorkerOptions.workerSrc=url;return pdfjs;};
export async function importDocument(file,{signal,loaders={}}={}){
  const options={signal};assertActive(options);
  if(typeof file?.name!=='string'||!file.name.isWellFormed()||!Number.isSafeInteger(file.size)||file.size<0||typeof file.arrayBuffer!=='function')throw Error('Choose a valid document.');
  if(file.size>10*1024*1024)throw Error('Choose a document under 10 MB.');
  const ext=file.name.split('.').pop().toLowerCase();if(!['txt','docx','pdf'].includes(ext))throw Error('Choose a .txt, .docx, or text-based .pdf document.');
  const bytes=await abortable(file.arrayBuffer(),signal);assertActive(options);
  if(!(bytes instanceof ArrayBuffer)||bytes.byteLength!==file.size)throw Error('Document size changed while reading. Choose the file again.');
  let text;
  if(ext==='txt')text=decodeText(bytes);
  else if(ext==='docx'){const mammoth=await abortable((loaders.docx??loadDocx)(),signal);text=(await abortable(mammoth.extractRawText({arrayBuffer:bytes}),signal)).value;}
  else{
    const pdfjs=await abortable((loaders.pdf??loadPdf)(),signal);assertActive(options);
    const task=pdfjs.getDocument({data:bytes,isEvalSupported:false});let destruction;
    const dispose=()=>destruction??=Promise.resolve().then(()=>task.destroy());const abort=()=>{dispose().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
    try{const pdf=await abortable(task.promise,signal);if(pdf.numPages>100)throw Error('Use a PDF with 100 pages or fewer, or export its text as TXT.');const pages=[];let units=0;
      for(let p=1;p<=pdf.numPages;p++){assertActive(options);const page=await abortable(pdf.getPage(p),signal),content=await abortable(page.getTextContent(),signal);let pageText='';
        for(const item of content.items){assertActive(options);if(item.str===undefined)continue;if(typeof item.str!=='string')throw Error('Invalid PDF text. Export its text as TXT.');const piece=item.str+(item.hasEOL?'\n':' ');units+=piece.length;if(units>MAX_DOCUMENT)throw Error('Use a document under 2 million characters. Your previous draft has been kept.');pageText+=piece;}
        pages.push(pageText);if(p<pdf.numPages)units+=2;
      }text=pages.join('\n\n');
    }finally{signal?.removeEventListener('abort',abort);await dispose();}
  }
  assertActive(options);if(typeof text!=='string'||!text.isWellFormed())throw Error('Document contains invalid Unicode text. Export it as UTF-8 TXT and retry.');
  if(!text.trim())throw Error('No readable text found. Scanned PDFs need text copied from another source.');
  if(text.length>MAX_DOCUMENT)throw Error('Use a document under 2 million characters. Your previous draft has been kept.');
  return {text,note:ext==='txt'?'TXT decoded strictly. The editor uses LF line breaks; an encoding BOM is not manuscript text. Review the text and chapter range before creating audio.':'Check the imported text against your original. Columns, tables, notes, and text boxes may be out of order or missing.'};
}
