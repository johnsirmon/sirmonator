import {inspectMp3} from './mp3.js';
import {safeFilename} from './recording.js';
export const DISCLOSURE='This episode uses AI-generated narration from supplied text. Speech synthesis may mispronounce, omit, or repeat words.';
const xml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function publicUrl(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||!u.hostname.includes('.')||u.hostname.endsWith('.')||u.hostname.includes(':'))return false;
 const host=u.hostname.toLowerCase();if(host==='localhost'||/\.(localhost|local|internal|test|example|invalid)$/.test(host)||/^\d+\.\d+\.\d+\.\d+$/.test(host))return false;
 return true;}catch{return false;}
}
export function appleValidationUrl(feedUrl){if(!publicUrl(feedUrl))throw Error('Enter a public HTTPS RSS URL without credentials.');return 'https://podcastsconnect.apple.com/my-podcasts/new-feed?submitfeed='+encodeURIComponent(feedUrl);}
export function podcastReadiness(fields){
 const warnings=[];
 for(const key of ['showTitle','showDescription','author','episodeTitle','episodeDescription','language','category'])if(!fields[key]?.trim())warnings.push('Add '+key.replace(/[A-Z]/g,c=>' '+c.toLowerCase())+'.');
 if(!['yes','no'].includes(fields.explicit))warnings.push('Choose an explicit-content setting.');
 for(const key of ['audioUrl','artworkUrl','feedUrl','websiteUrl'])if(!publicUrl(fields[key]))warnings.push('Add a public HTTPS '+key.replace('Url',' URL')+'.');
 if(!fields.rightsConfirmed)warnings.push('Confirm rights to manuscript, voice, artwork and music before publication.');
 if(!fields.spokenDisclosureConfirmed)warnings.push('Add an audible AI narration disclosure separately and confirm it; this export does not alter your manuscript.');
 if(!fields.artworkConfirmed)warnings.push('Verify square JPG/PNG artwork, 1400–3000 px, preferably 3000 px with solid background.');
 warnings.push('Remote hosting, feed fetchability, byte-range support and artwork dimensions have not been verified by this app.');
 warnings.push('Loudness and true peak are not measured or normalized here. Review against Apple audio guidance (about -16 LKFS ±1; true peak at most -1 dBFS).');
 return warnings;
}
export async function episodePackage(job,audio,fields,artifact=null){
 fields={...fields};
 for(const key of ['audioUrl','artworkUrl','feedUrl','websiteUrl']){
  let url;try{url=new URL(fields[key]);}catch{}
  if(url?.username||url?.password)throw Error('Remove embedded credentials from hosting URLs before exporting.');
  if(!publicUrl(fields[key]))fields[key]='';
 }
 for(const value of Object.values(fields))if(typeof value==='string'&&/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value))throw Error('Remove unsupported control characters from episode metadata.');
 if(job.next!==job.passages.length||!job.next)throw Error('Finish this recording before preparing a podcast episode. Partial recordings cannot be exported as episodes.');
 if(!job.episodeGuid)throw Error('Save this episode identity before exporting.');
 if(audio.type!=='audio/mpeg')throw Error('Podcast export requires actual MP3 audio.');
 const bytes=new Uint8Array(await audio.arrayBuffer()),audioInfo=inspectMp3(bytes),seconds=audioInfo.seconds;if(!bytes.length||!seconds)throw Error('No valid MP3 audio.');
 const revision=job.takeSelection?.revision??0;
 if((revision>0&&!artifact)||(artifact&&(!Number.isFinite(artifact.seconds)||artifact.seconds<0||artifact.takeRevision!==revision)))throw Error('Podcast preparation requires the matching frozen audio selection and duration.');
 if(Math.abs(seconds-(artifact?.seconds??job.seconds))>.2)throw Error('Saved audio duration does not match the complete checkpoint.');
 const name=safeFilename(fields.episodeTitle||job.title),date=new Date(job.createdAt);if(!Number.isFinite(date.getTime()))throw Error('Invalid episode date.');
 const warnings=podcastReadiness(fields);if(audioInfo.sampleRates.some(rate=>![44100,48000].includes(rate)))warnings.push('This MP3 retains the model sample rate ('+audioInfo.sampleRates.join(', ')+' Hz). Check platform recommendations; no 44.1/48 kHz resampling was performed.');
 const description=(fields.episodeDescription||'')+'\n\n'+DISCLOSURE;
 const metadata={schemaVersion:1,guid:job.episodeGuid,proposedPublicationDate:date.toISOString(),show:{title:fields.showTitle||'',description:(fields.showDescription||'')+'\n\n'+DISCLOSURE,author:fields.author||'',language:fields.language||'en',category:fields.category||'',explicit:fields.explicit||'',type:'episodic',artworkUrl:fields.artworkUrl||''},episode:{title:fields.episodeTitle||job.title,description,type:'full',explicit:fields.explicit||'',audio:{filename:name+'.mp3',mime:'audio/mpeg',bytes:bytes.length,durationSeconds:seconds,sampleRates:audioInfo.sampleRates,channels:audioInfo.channels,url:fields.audioUrl||''}},rightsConfirmed:fields.rightsConfirmed===true,spokenDisclosureConfirmed:fields.spokenDisclosureConfirmed===true,warnings,status:'local preparation only; not published or platform validated'};
 const files=[{name:name+'.mp3',data:bytes},{name:'metadata.json',data:JSON.stringify(metadata,null,2)+'\n'},{name:'show-notes.txt',data:metadata.episode.title+'\n\n'+description+'\n\nSuggested separate spoken disclosure: This episode is narrated using an AI-generated voice.\n'},{name:'publishing-checklist.txt',data:'LOCAL PREPARATION ONLY — NOTHING HAS BEEN UPLOADED\n\n'+warnings.map(w=>'- '+w).join('\n')+'\n\nSpotify: upload the MP3 in Spotify for Creators. After the first episode, enable RSS in Settings > Availability. Spotify hosting publishes on Spotify; submit the RSS feed separately to other directories.\nApple: host your audio/artwork/RSS at public HTTPS URLs, then validate and review the feed in Apple Podcasts Connect.\nThe app does not add account credentials or private email. Review your own metadata before sharing. Do not publish character impressions without appropriate rights.\nSources:\nhttps://support.spotify.com/us/creators/article/publishing-audio-episodes/\nhttps://support.spotify.com/us/creators/article/your-rss-feed/\nhttps://podcasters.apple.com/support/823-podcast-requirements\nhttps://podcasters.apple.com/support/891-content-and-subscription-guidelines\nhttps://podcasters.apple.com/support/893-audio-requirements\n'}];
 const configured=['audioUrl','artworkUrl','feedUrl','websiteUrl'].every(key=>publicUrl(fields[key]))&&['showTitle','showDescription','author','episodeTitle','episodeDescription','language','category'].every(key=>fields[key]?.trim())&&['yes','no'].includes(fields.explicit);
 if(configured){const show=metadata.show,episode=metadata.episode;files.push({name:'feed-draft.xml',data:'<?xml version="1.0" encoding="UTF-8"?>\n<!-- Local draft: hosting and platform validation still required. -->\n<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>'+xml(show.title)+'</title><description>'+xml(show.description)+'</description><link>'+xml(fields.websiteUrl)+'</link><language>'+xml(show.language)+'</language><atom:link href="'+xml(fields.feedUrl)+'" rel="self" type="application/rss+xml"/><itunes:author>'+xml(show.author)+'</itunes:author><itunes:explicit>'+show.explicit+'</itunes:explicit><itunes:type>episodic</itunes:type><itunes:category text="'+xml(show.category)+'"/><itunes:image href="'+xml(fields.artworkUrl)+'"/><item><title>'+xml(episode.title)+'</title><description>'+xml(description)+'</description><guid isPermaLink="false">'+xml(job.episodeGuid)+'</guid><pubDate>'+date.toUTCString()+'</pubDate><itunes:episodeType>full</itunes:episodeType><itunes:explicit>'+show.explicit+'</itunes:explicit><itunes:duration>'+Math.round(seconds)+'</itunes:duration><enclosure url="'+xml(fields.audioUrl)+'" length="'+bytes.length+'" type="audio/mpeg"/></item></channel></rss>\n'});}
 return {files,metadata};
}
// Stored ZIP entries avoid another full copy of the compressed audio in memory.
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function packageZip(files){
 const encode=new TextEncoder(),local=[],central=[];let offset=0,centralSize=0;
 for(const file of files){const name=encode.encode(file.name),data=typeof file.data==='string'?encode.encode(file.data):file.data,crc=crc32(data);
 const header=new Uint8Array(30+name.length),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);header.set(name,30);local.push(header,data);
 const entry=new Uint8Array(46+name.length),e=new DataView(entry.buffer);e.setUint32(0,0x02014b50,true);e.setUint16(4,20,true);e.setUint16(6,20,true);e.setUint16(8,0x800,true);e.setUint32(16,crc,true);e.setUint32(20,data.length,true);e.setUint32(24,data.length,true);e.setUint16(28,name.length,true);e.setUint32(42,offset,true);entry.set(name,46);central.push(entry);centralSize+=entry.length;offset+=header.length+data.length;
 }
 const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);return new Blob([...local,...central,end],{type:'application/zip'});
}
