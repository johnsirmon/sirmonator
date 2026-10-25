// No models and no full-recording PCM allocation in this dedicated export worker.
let encoder,parts=[],size=0,maxBytes,started,initializationMs=0,encodingMs=0,inputSamples=0,passages=0,sampleRate;
function keep(bytes){if(!bytes.length)return;size+=bytes.length;if(size>maxBytes)throw Error('This download is large. Choose an individual chapter instead.');parts.push(new Uint8Array(bytes));}
self.onmessage=async({data})=>{
  try{
    if(data.type==='start'){
      if(encoder)throw Error('Encoder already started.');
      if(![22050,24000,44100,48000].includes(data.sampleRate))throw Error('Unsupported recording sample rate.');
      maxBytes=data.maxBytes;
      started=performance.now();sampleRate=data.sampleRate;
      const path='../vendor/lamejs.js';
      const {Mp3Encoder}=await import(/* @vite-ignore */ new URL(path,import.meta.url).href);
      encoder=new Mp3Encoder(1,data.sampleRate,64);
      initializationMs=performance.now()-started;
    }else if(data.type==='part'){
      if(!encoder||data.bytes.byteLength%2)throw Error('Invalid PCM export block.');
      const view=new DataView(data.bytes),block=new Int16Array(1152);
      const encodingStarted=performance.now();inputSamples+=view.byteLength/2;passages++;
      for(let offset=0;offset<view.byteLength/2;offset+=1152){
        const count=Math.min(1152,view.byteLength/2-offset);
        for(let i=0;i<count;i++)block[i]=view.getInt16((offset+i)*2,true);
        keep(encoder.encodeBuffer(block.subarray(0,count)));
      }
      encodingMs+=performance.now()-encodingStarted;
    }else if(data.type==='finish'){
      if(!encoder)throw Error('Encoder not started.');const flushed=performance.now();keep(encoder.flush());encodingMs+=performance.now()-flushed;encoder=null;
      const metrics={schema:1,encodingMs,initializationMs,workerElapsedMs:performance.now()-started,inputSamples,sampleRate,passages,bytes:size,phase:'single-artifact-mp3'};
      self.postMessage({parts,metrics},parts.map(p=>p.buffer));parts=[];return;
    }else throw Error('Unknown export request.');
    self.postMessage({ok:true});
  }catch(error){self.postMessage({error:error.message});}
};
