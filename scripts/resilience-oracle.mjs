// Independent raw-int16 feed to the existing codec (not the export worker).
import {Mp3Encoder} from '@breezystack/lamejs';
export async function oracleEncode(parts){
 const encoder=new Mp3Encoder(1,24000,64),output=[];
 for(const part of parts){const view=new DataView(await part.blob.arrayBuffer());for(let offset=0;offset<view.byteLength;offset+=2304){const count=Math.min(1152,(view.byteLength-offset)/2),block=new Int16Array(count);for(let i=0;i<count;i++)block[i]=view.getInt16(offset+i*2,true);const bytes=encoder.encodeBuffer(block);if(bytes.length)output.push(new Uint8Array(bytes));}}
 const flush=encoder.flush();if(flush.length)output.push(new Uint8Array(flush));const all=new Uint8Array(output.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of output){all.set(part,offset);offset+=part.length;}return all;
}
