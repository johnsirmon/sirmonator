import {decodeText,MAX_DOCUMENT} from './recording.js';
export async function importDocument(file){
  if(file.size>10*1024*1024)throw Error('Choose a document under 10 MB.');
  const ext=file.name.split('.').pop().toLowerCase();let text;
  if(ext==='txt')text=decodeText(await file.arrayBuffer());
  else if(ext==='docx'){const {default:mammoth}=await import('mammoth/mammoth.browser');text=(await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;}
  else if(ext==='pdf'){
    const pdfjs=await import('pdfjs-dist');const {default:url}=await import('pdfjs-dist/build/pdf.worker.min.mjs?url');pdfjs.GlobalWorkerOptions.workerSrc=url;
    const pdf=await pdfjs.getDocument({data:await file.arrayBuffer(),isEvalSupported:false}).promise;
    try{if(pdf.numPages>100)throw Error('Use a PDF with 100 pages or fewer, or export its text as TXT.');const pages=[];
      for(let p=1;p<=pdf.numPages;p++){const page=await pdf.getPage(p);const content=await page.getTextContent();pages.push(content.items.map(item=>item.str===undefined?'':item.str+(item.hasEOL?'\n':' ')).join(''));}text=pages.join('\n\n');
    }finally{await pdf.destroy();}
  }else throw Error('Choose a .txt, .docx, or text-based .pdf document.');
  if(!text.trim())throw Error('No readable text found. Scanned PDFs need text copied from another source.');
  if(text.length>MAX_DOCUMENT)throw Error('Use a document under 2 million characters. Your previous draft has been kept.');
  return {text,note:ext==='txt'?'Text loaded. Review the chapter range before creating audio.':'Check the imported text against your original. Columns, tables, notes, and text boxes may be out of order or missing.'};
}
