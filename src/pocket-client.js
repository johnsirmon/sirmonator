import {PocketTTS} from 'pocket-tts-js';
// Pinned 0.1.0 API; use its message protocol with our documented worker changes.
export class CharacterTTS extends PocketTTS{
  _ensureWorker(){
    if(this.worker)return;
    this.worker=new Worker(new URL('./vendor/pocket/worker.js',import.meta.url),{type:'module'});
    this.worker.onmessage=e=>this._handleMessage(e.data);
    this.worker.onerror=e=>{
      const error=new Error(e.message||'Character voice worker failed');
      for(const {reject} of this._pending.values())reject(error);
      this._pending.clear();
    };
  }
}
