// Every source character belongs to exactly one chunk. No rewriting or normalization.
export function chunkText(text, max = 240) {
  if (!Number.isInteger(max) || max < 2) throw new Error('Invalid chunk size');
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + max, text.length);
    const paragraph=/\n\s*\n+/u.exec(text.slice(start,end));
    if(paragraph&&paragraph.index>0&&start+paragraph.index+paragraph[0].length<text.length){
      end=start+paragraph.index+paragraph[0].length;
    } else if (end < text.length) {
      const part = text.slice(start, end);
      const paragraphs=[...part.matchAll(/\n\s*\n+/gu)];
      const sentences=[...part.matchAll(/[.!?]["'”’)]*\s+/gu)];
      const spaces=[...part.matchAll(/\s+/gu)];
      const useful=list=>list.filter(b=>b.index>max/3).at(-1);
      const boundary=useful(paragraphs)??useful(sentences)??spaces.at(-1);
      if (boundary && boundary.index > max / 3) end = start + boundary.index + boundary[0].length;
      else if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    chunks.push(text.slice(start, end)); start = end;
  }
  if (chunks.join('') !== text) throw new Error('Text integrity check failed');
  return chunks;
}
export function encodeWav(parts, sampleRate = 24000) {
  const size = parts.reduce((n, p) => n + p.length, 0);
  const buffer = new ArrayBuffer(44 + size * 2), view = new DataView(buffer);
  const str = (p, s) => [...s].forEach((c, i) => view.setUint8(p + i, c.charCodeAt(0)));
  str(0,'RIFF'); view.setUint32(4,36+size*2,true); str(8,'WAVE'); str(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,size*2,true);
  let offset = 44;
  for (const part of parts) for (const value of part) { const v = Math.max(-1,Math.min(1,value)); view.setInt16(offset,v<0?v*32768:v*32767,true);offset+=2; }
  return buffer;
}
