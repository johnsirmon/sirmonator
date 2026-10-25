# Actual browser inference and quota recovery checkpoint

This milestone starts at `4b0944178b398dafeca1de31514721b4f20cb64b`. No deployment.

The cache-only browser harness uses the current production TTS worker with import
locations rewritten, existing verified Kokoro files served over loopback, and
existing installed browser runtime files. No TTS simulation is used. Provider
selection/fallback is unchanged. Only model transport and the final download sink
are redirected. All five existing model/tokenizer/style files are hashed before
launch; runtime copies are hashed too. The production browser voice reader also
verifies its style bytes. Route logs are not full-model per-response browser hashes.

Run `node scripts/prepare-cached-wasm-harness.mjs`, serve Vite at 127.0.0.1:4198,
and open `/.cache/integration-app.html`. Every HTML entry uses the centralized
origin guard: wrong-origin bootstrap/controls fail before controls can import
their implementation or open a database. Wrong protocol, host and port regressions
prove no DB open/write or installed action. Existing drafts/recordings are never
reset. The generated files remain ignored under .cache and are not production UI.

## Actual Edge result

| Flow | Result |
|---|---|
| Reviewed source and frozen aliases | Paul remains manuscript text; pawl is spoken input |
| Actual Kokoro generation | Three passages completed; persisted UI metrics report wasm |
| Exact passage regeneration | Passage 2 completed; selected alternative revision 1 |
| Undo | Original selected, revision 2; alternative retained |
| Manual supplied-transcript review | Candidate listened omission flagged from supplied pawl; review saved |
| MP3 export | 54,720-byte MP3 captured in memory, parsed duration 6.84 s; SHA-256 recorded |
| External model fetch | None; missing fp32 was rejected locally and q8 WASM fallback succeeded |

The three original passages measured 49.95 s render, 6.37 s loading and 43.18 s
engine calls as rounded by the UI. This short cached WASM run was slower than real
time on this host; it is not a phone or long-form performance prediction. The
generated text was authored for the test; no personal voice/reference was used.
No browser download completion, acoustic accuracy or subjective improvement is
claimed. Full facts and hashes are in `evidence/cached-wasm-browser-integration.json`
and `evidence/cached-wasm-local-inventory.json`.

## Independent quota fault work

Deterministic failure injection confirmed and fixed a synchronous quota error
that could leave an orphan part, and optional timing failures that could block an
intact export. Passage commits now abort on every exception. Retry adds one missing
part/take and preserves prior committed audio. Optional artifact timing observers
cannot block audio; a metadata write gets a separate 2 s abortable budget. User
cancellation still blocks publication. Required render provenance remains mandatory.
Details and limitations are in QUOTA-RECOVERY.md.

The browser inference sequence preceded these quota fixes. Subsequent deterministic
tests cover the fixes without filling a disk or touching user databases. All 212
tests and the production build pass. Native browser quota exhaustion, phone
suspension, long-form memory and subjective listening remain unrun. No model/package
installation, paid service, personal-voice upload, merge or deployment occurred.
