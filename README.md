# The Sirmonator — I'll read it back.

**Try it:** https://johnsirmon.github.io/sirmonator/

## Release status — 25 October 2026 (UTC)

The previous live baseline was the render-foundations checkpoint [`c2f5cbb`](https://github.com/johnsirmon/sirmonator/commit/c2f5cbbe980a8af6587bee3d4d95e7aa21fc5296), including continuous PCM playback shipped earlier in PR #2. This revision integrates the tested feature stack through [`39cd24a`](https://github.com/johnsirmon/sirmonator/commit/39cd24a79d9cacf092bc82619680d62d0560e216) and the recovery guide. A commit being on a feature branch does not mean it is live: verify the successful [Publish reader workflow](https://github.com/johnsirmon/sirmonator/actions/workflows/pages.yml) and its deployed commit for the hosted site.

Included work adds [selective passage regeneration, take selection and Undo](PASSAGE-TAKES.md), pronunciation rules, manual speech review, [reference preparation](REFERENCE-PREPARATION.md), [MP3 preparation recovery](MP3-PREPARATION-RECOVERY.md), [recording storage recovery](STORAGE-LIFECYCLE.md), [side-database recovery](SIDE-DATABASE-RECOVERY.md), [quota recovery](QUOTA-RECOVERY.md), [storage visibility](STORAGE-VISIBILITY.md), report-only PCM diagnostics and player/worker/import lifecycle fixes. A regenerated take is a separately saved alternative; it may be byte-identical to its original and is not guaranteed to improve the speech.

The separate [local voice-cloning short-reading MVP](LOCAL-CLONING-MVP.md) accepts an explicitly selected authorized WAV and generates a session-only WAV reading in the browser. It is limited to 960 characters / 60 seconds, uses no reference-audio upload, and does not integrate with saved sermons. Native synthetic inference succeeded; file-picker/download automation and complete repeated native-flow QA have limitations documented there. The older [custom-reference experiment](CUSTOM-REFERENCE-RUNTIME.md) remains a Node-only synthetic research route. Reference preparation checks and permission attestations do not verify a speaker's identity or rights. Optional local English ASR comparison is available for selected saved PCM passages up to 30 seconds, after a separate model-download opt-in. Its uncertain, transient findings remain separate from manual supplied-transcript review and do not certify acoustic accuracy or completeness. See [local ASR scope and limits](LOCAL-ASR.md). Podcast support prepares a local ZIP/RSS draft only; it does not upload or publish.

The pronunciation feature adds optional literal `spelling => spoken form` rules for new Studio recordings, with original-versus-spoken previews and frozen per-recording rules. Existing recordings/takes keep their own inputs. See [PRONUNCIATION-RULES.md](PRONUNCIATION-RULES.md) for matching limits, provenance and verified versus unrun checks. Alias spelling does not guarantee pronunciation accuracy.

The [manual speech-review feature](SPEECH-REVIEW.md) compares a user-supplied passage transcript with frozen source/pronunciation forms and saves notes tied to the exact take/revision/audio hash. Findings are listening candidates; this manual route does not transcribe audio or verify acoustic accuracy. The separate opt-in ASR route produces uncertain candidates and can hallucinate words even on silence. It never edits source/audio or regenerates a take automatically.

Paste a sermon or choose a TXT, DOCX, or text-based PDF. Review the imported text and check the confirmation, then listen. Choose **Studio voices** to create a downloadable MP3, or **Quick listen** for your device's voices. No account, API key, paid voice subscription, or server is needed.

## For Jay / iPhone

1. Open the link in Safari.
2. Paste text or choose a document from Files. Review the displayed text, especially PDF reading order.
3. Choose a voice and click Audition this voice. A small, pre-rendered sample plays immediately, without downloading a model. Confirm your text, then choose Create audio.
4. For car listening, choose Studio voices first and wait for the whole audio file. Keep the page open and awake during creation. Full sermon creation downloads roughly 100–400 MB of model weights plus runtime assets on first use. Supertonic uses CPU/WASM by default to avoid GPU-device-loss failures. Kokoro can use WebGPU, with an automatic CPU retry if either loading or inference fails. A computer is recommended for long sermons.
5. Use Share audio / Save to Files when available, or Save available audio as MP3. Save to Files and open the MP3 there for lock-screen/Bluetooth playback. You can also generate on a computer and AirDrop or send the MP3 to your iPhone. No email-ingestion address is configured.

## Text accuracy

There is **no chat model or content-generation step**. The text is partitioned into bounded passages; joining those passages must exactly reconstruct the reviewed input. Every passage must finish before a complete MP3 is offered. The source-text download contains the original reviewed manuscript snapshot, not pronunciation-alias-expanded text and not a transcript of the rendered audio. Optional pronunciation rules change the spoken input while preserving that original source. Nothing interprets instructions embedded in a sermon as commands.

This verifies text routing, **not acoustic accuracy**. The neural speech engines may mispronounce, omit, repeat, or otherwise render words incorrectly. Device voices also normalize numbers and abbreviations. No zero-hallucination or word-perfect audio guarantee is made. Listen alongside the reviewed source for important passages. Document extraction can reorder or omit content; DOCX text boxes, footnotes, tables and PDF columns need manual review. Image-only/scanned PDFs are rejected when they contain no extractable text; OCR is not included.

## Privacy / free operation

Documents and sermon text are handled locally in this browser, with saved drafts and uncompressed PCM16 passage checkpoints on this device and no backend uploads or analytics. Legacy MP3 checkpoints remain supported. Kokoro model/runtime/voice files download from Hugging Face and library asset CDNs, and fonts load from Google Fonts; those hosts receive ordinary network metadata. Device speech services depend on the OS and may use vendor network services. Drafts and recordings can survive refreshes in this browser; download backups because browser storage can be cleared. The public GitHub repository contains application code and bundled assets, never visitor manuscripts or recordings. Redistribution permission for the bundled Prime/Fenix source recordings remains unresolved; code/model licenses do not establish those recording rights.

26 studio choices are included: ten Supertonic 3 narrators (five male, five female), fourteen Kokoro voices, and two character-inspired treatments. Supertonic 3 was released in 2026 and is now archived; its models remain downloadable under OpenRAIL-M, and its example code is MIT. The archive revision is pinned in source. Kokoro uses Apache-2.0 model weights. GitHub Pages hosts the app for free, subject to GitHub's service limits. Natural voice creation is limited by your device speed and memory; long audio can take several minutes and large exports consume memory. Cancel terminates the current passage and retains previously saved passages. Device speech cannot reliably play with an iPhone locked; use a downloaded audio file.

## Development

Node 24 recommended.

```sh
npm ci
npm test
npm run dev
npm run build
```

Pushes to main run tests, build and deploy to GitHub Pages. No secrets required. Enable Pages with GitHub Actions as the source.

Sources: [Kokoro.js API and voice list](https://github.com/hexgrad/kokoro/tree/main/kokoro.js), [ONNX model](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX), [model license](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/LICENSE).

Application code: MIT. Third-party packages and model assets retain their own licenses.


## The cinematic cast

**Prime Preacher** and **Grit & Grace** now use free Pocket TTS voice conditioning from short original Optimus Prime and Marcus Fenix speech references. The initial pitch-masking effects were removed. No pitch lowering, bass boost, saturation, metallic modulation, or reverb is added. Speed adjustment preserves pitch. These are unofficial character impressions; resemblance is not guaranteed.

The optional comparison below the voice selector provides the short reference audio, source links, and actor performance interviews. [VOICE-RESEARCH.md](VOICE-RESEARCH.md) records the research, alternatives considered, exact source provenance, pinned models, implementation and limitations.

Pocket character generation runs on CPU/WASM with roughly 150 MB of model assets. Supertonic's ten stock narrators require about 398 MB; Kokoro's fourteen stock voices use roughly 90–330 MB depending on the execution provider. All manuscript processing remains local. Pocket code is MIT; its model/export assets are CC-BY-4.0 with Kyutai attribution. Source character recordings retain their original ownership. SoundTouchJS is LGPL-2.1; its license notice is in `src/vendor/`.

`node scripts/generate-character-auditions.mjs` regenerates the two character samples. `node scripts/generate-auditions.mjs` generates missing regular samples and builds the 26-voice manifest. Both use ignored `.cache/` for model files.

## Audition reliability

All 26 studio auditions are checked-in WAV files under `public/auditions/`, generated from the same underlying models and character references as full narration. The fixed sample text is in `manifest.json`. Samples use normal delivery at 1× speed; they never contain a visitor's manuscript. Auditions call native audio playback directly from the click gesture and do not start an ONNX worker, GPU, or model download. If the browser blocks autoplay, the visible native audio player offers a manual Play button.

`node scripts/generate-auditions.mjs` regenerates missing samples using the Node CPU runtime. Its model cache and temporary runtime adaptation stay in ignored `.cache/`; the generated public samples are explicitly included in Git. Regeneration needs network access and a few hundred MB of disk space. CI verifies every WAV's format, duration, audible sample energy, file size, and voice-manifest coverage.

The GPU recovery regression test injects the reported `OrtRun` / `mapAsync` device-loss error during inference and verifies that the **same text and settings** are retried exactly once on CPU, with subsequent passages staying on CPU. Recovery discards failed-attempt audio and never publishes an incomplete recording.

Character voices offer **Refined** and **Previous (v2)** editions for direct comparison. The edition applies to both the instant audition and full sermon. See [the iteration plan](VOICE-ITERATION-PLAN.md) and [voice research](VOICE-RESEARCH.md) for sources, tuning, and limitations.

The artwork in `public/art/sirmonator-sermon-to-audio.webp` is a web-optimized copy of the Sirmonator poster supplied by John Sirmon. Its gold, cream, burgundy, and sky colors define the app theme. The complete artwork remains visible on desktop and narrow screens, with an Open reader shortcut to the tools.

## Long text performance and podcast preparation

New Studio recordings save drafts and individual uncompressed mono PCM16 passages in this browser; playback/download preparation encodes ordered PCM through one MP3 encoder per artifact. Checkpoints require roughly 3–6 MB per minute before metadata, alternative takes and prepared artifacts. Historical MP3-passage recordings remain readable, resumable and exportable through their legacy path. A recording contains up to 150,000 characters; the full draft can hold 2 million characters with chapter selection. Browser storage is not a backup. Download important recordings and reviewed source text. Local storage can be removed by private browsing, browser cleanup or quota pressure.

## Recovery without deleting saved work

1. **Back up first.** Export current text, reviewed source and any accessible saved audio before reloading, changing builds or freeing storage. Partial MP3 exports contain committed passages only. If storage is unavailable, preserve unsaved text through the text-backup control; audio export may need a compatible connection first.
2. For blocked, timed-out or closed local storage, close competing Sirmonator tabs and use **Retry local storage**. Retry keeps the current draft; it does not establish that unsaved text or an interrupted passage was committed. Do not clear site data or delete databases as a recovery step.
3. A `VersionError` means a newer build upgraded the database beyond the older build's supported version. Back up unsaved text, close outdated tabs and reload/update to a compatible build. Retry cannot downgrade the database. See [storage lifecycle](STORAGE-LIFECYCLE.md) and [side-database recovery](SIDE-DATABASE-RECOVERY.md).
4. For failed or stalled MP3 preparation, cancel and retry from the saved passages, keeping the page foregrounded; try an individual chapter or a faster device if necessary. The default watchdog is **180 seconds per outstanding preparation request**, including each Blob read and worker startup/part/final-flush response. It resets between requests; it is not a three-minute recording-length limit. Failed preparation does not publish a partial download or rewrite saved audio/take selection. See [preparation recovery](MP3-PREPARATION-RECOVERY.md).
5. For quota pressure, export accessible text/audio first and review the [storage measurements](STORAGE-VISIBILITY.md). Measurements are estimates, not backups or a device-memory reading. Follow the [quota guide](QUOTA-RECOVERY.md); deletion is a separate explicit choice, not an automatic retry action.

There are 26 studio voices, including four additional installed Kokoro English presets: Sarah, Kore, Alice and Lewis. Their checked-in auditions were generated locally with Kokoro 1.2.1, CPU q8. Kokoro model weights are Apache-2.0. Upstream Supertonic is archived and unsupported; choose Kokoro if that engine fails. Quick listen uses device voices without an MP3 export; OS voices can use remote services. No offline guarantee is made without disconnected testing. Character impressions retain separate source-rights considerations and are not cleared for public distribution by this app.

The podcast preparation panel exports a ZIP containing the exact complete MP3, `metadata.json`, `show-notes.txt`, `publishing-checklist.txt`, and (when metadata and public hosting URLs are supplied) `feed-draft.xml`. The episode GUID and metadata persist with the local recording. Partial recordings cannot become episode exports. Enclosure size, duration, sample rates and channels come from the actual MP3 bytes. The model sample rate is retained; no relabeling or 44.1/48 kHz resampling is performed. Loudness/true peak, artwork dimensions and remote feed hosting are not measured or verified. An RSS draft is not a published or Apple-validated show.

AI narration disclosure is included in episode and show descriptions. The tool provides a suggested separate spoken disclosure but never inserts it into the manuscript or audio. The user must add an audible disclosure separately and confirm rights and artwork requirements before continuing to Apple feed validation. No private email is requested or exported. Spotify for Creators provides a manual upload/hosting path; enable RSS after the first episode and submit separately to other directories. No upload, account signup or publication happens in this app.

Official references: [Kokoro JS](https://github.com/hexgrad/kokoro/blob/main/kokoro.js/README.md), [Kokoro voices and caveats](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md), [Apple requirements](https://podcasters.apple.com/support/823-podcast-requirements), [Apple AI disclosure](https://podcasters.apple.com/support/891-content-and-subscription-guidelines), [Apple audio guidance](https://podcasters.apple.com/support/893-audio-requirements), [Spotify upload](https://support.spotify.com/us/creators/article/publishing-audio-episodes/), [Spotify RSS distribution](https://support.spotify.com/us/creators/article/your-rss-feed/).

Reproducible local checks:

```sh
node scripts/benchmark-checkpoints.mjs checkpoint-report
node scripts/benchmark-synthesis.mjs
npm test
npm run build
```

Checkpoint benchmarking uses synthetic PCM and fake-indexeddb in Node, not browser storage or TTS. On the 144,000-character/2,000-passage fixture, an ordered storage snapshot reduced export reads from 4,000 to 1 and measured first/warm export from 219/189 ms to 42/36 ms. Output remained 33,024,000 bytes and 4,128 seconds of synthetic tones; Node RSS was about 226 MB before and 237 MB after. Results vary and do not establish faster speech inference. The synthesis benchmark separately measures actual CPU model initialization, first and warm identical-text inference, RTF and RSS using an existing local model cache; it does not measure an uncached download or browser WebGPU.

## Warm synthesis sessions

The measurements below describe the earlier warm-session change and its historical MP3-passage fixtures. They do not replace the current PCM checkpoint/export workflow described above or establish which revision is deployed.

The reader keeps one synthesis worker/model family warm for up to 30 idle seconds after successful passages, previews and passage-safe pauses. A rapid Resume or another reading can reuse that model; Stop, errors, starting a request in another engine family, leaving the page and idle expiry dispose of the worker. No full-document PCM cache or parallel inference queue is added. Request IDs and cancelled-worker checks discard late responses. Source text, voice settings, delivery pauses and encoded output are unchanged.

Worker replies include local per-passage render time (including any model load), MP3 encoding/frame-validation time, model-load count and the actual selected Kokoro provider. These measurements are not uploaded. The progress message starts before model initialization. Existing CPU fallback after GPU failure remains in place; physical WebGPU performance has not been established by CPU verification.

A single before/after run on Intel i7-1065G7, Node 24.21.0, cached Kokoro CPU q8/Sarah at 1x used three distinct synthetic paragraphs (265 characters, 20.136 seconds of output audio), treating each as a separate creation/resume flow. The original run summed request latency to 30.378 seconds before and 27.489 seconds after (9.5% lower). Its 30.560/27.492-second wall totals used asymmetric teardown and are not a comparable cleanup-inclusive measure, with worker creation reduced from three to one. Every MP3 passage was byte-identical and both combined files decoded with ffmpeg. This measures real synthesis and restart overhead, separately from the earlier synthetic export benchmark. It does not claim faster inference during one uninterrupted long reading or constitute a long-book soak. Timing varies; this is one comparison, not a statistical speed guarantee.

The tradeoff was higher maximum sampled after-passage Node RSS: about 460 MB before versus 634 MB after in that original run. These samples do not measure true peak or retained memory after worker exit. The benchmark now awaits native worker termination in both modes and records request totals and after-exit RSS separately. Browser memory is not inferred from Node RSS. The short idle timeout and one-family limit bound retention, but do not impose a hard per-worker heap limit. Actual pending CPU inference cancellation rejected the request in about 65 ms and a fresh-worker retry produced identical audio bytes; that measures client rejection latency, not native CPU thread cleanup or spoken-word accuracy.

```sh
node scripts/benchmark-worker-sessions.mjs before
node scripts/benchmark-worker-sessions.mjs after
node scripts/verify-worker-recovery.mjs
node --expose-gc scripts/profile-worker-memory.mjs
```

These scripts reuse existing model caches and dependencies. The production worker is adapted only for Node transport, CPU selection and local encoder URL resolution. Results go to ignored `.cache/`. No private text, paid API or alternative model is needed.

A separate six-flow CPU soak on the same fixture repeated the three passages twice in 57.039 seconds, with one worker and one model load. After-passage RSS samples were 452, 491, 627, 688, 699 and 562 MB. After a diagnostic one-second idle expiry and awaited native worker exit, RSS was 111.94 MB versus 52.49 MB baseline; explicit diagnostic GC reduced it to 111.47 MB. This shows release of much of the worker memory, not return to baseline or a proven long-run bound. The app uses a 30-second timeout. Browser JS heap is not whole-browser/WASM/GPU memory.

A subsequent isolated rerun with native termination awaited in both modes measured request totals 32.107/28.848 seconds before/after and cleanup-inclusive wall totals 32.325/28.944 seconds. Maximum sampled after-passage RSS was 463.66/646.48 MB; after-worker-exit RSS was 119.86/185.23 MB (no explicit GC). All three MP3 hashes matched, with 20.136 seconds of audio in each mode. These are separate runs from the original figures, not pooled results. One initial rerun overlapped browser synthesis and was excluded from this comparison.

A local Edge harness using the production worker and lifecycle client also completed short Sarah synthesis with provider=webgpu, warm reuse without a second model load, Stop during initialization and warm inference, a successful fresh-worker retry, and idle termination 30.008 seconds after completion. The generated 3.648-second MP3 played to its end through native controls. This is short-flow lifecycle evidence, not a WebGPU speed comparison, listening/transcription check or phone/long-book validation. Whole-browser memory measurement was unavailable (cross-origin isolation false).
