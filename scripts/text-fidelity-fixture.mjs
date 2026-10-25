// Stable, model-free Unicode corpus. Randomness is fully determined by seed.
export const fidelitySeeds=[0x10ffff,0x31415926,0xc0ffee];
export function fidelityRandom(seed){let state=seed>>>0;return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};}
export const fidelityAtoms=['a','Z',' ','\t','\r\n','\r','\n\n','😀','👩‍👧','𝔘','e\u0301','é','“Do not rewrite.”','John 3:16–18','1,000.25','\u00a0','\u2028','\u2029','\u2066quoted\u2069','x'.repeat(481),'[literal <tag> & $&]'];
export function fidelityText(seed,count=80){const random=fidelityRandom(seed);return Array.from({length:count},()=>fidelityAtoms[Math.floor(random()*fidelityAtoms.length)]).join('')+'\nPaul ends here.\n';}
