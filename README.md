# The Sirmonator — I'll read it back.

**Try it:** https://johnsirmon.github.io/sirmonator/

The hosted demo may lag this feature branch. Run locally to test the MP3, resume and podcast preparation changes.

Paste a sermon or choose a TXT, DOCX, or text-based PDF. Review the imported text and check the confirmation, then listen. Choose **Studio voices** to create a downloadable MP3, or **Quick listen** for your device's voices. No account, API key, paid voice subscription, or server is needed.

## For Jay / iPhone

1. Open the link in Safari.
2. Paste text or choose a document from Files. Review the displayed text, especially PDF reading order.
3. Choose a voice and click Audition this voice. A small, pre-rendered sample plays immediately, without downloading a model. Confirm your text, then choose Create audio.
4. For car listening, choose Studio voices first and wait for the whole audio file. Keep the page open and awake during creation. Full sermon creation downloads roughly 100–400 MB of model weights plus runtime assets on first use. Supertonic uses CPU/WASM by default to avoid GPU-device-loss failures. Kokoro can use WebGPU, with an automatic CPU retry if either loading or inference fails. A computer is recommended for long sermons.
5. Use Share audio / Save to Files when available, or Save available audio as MP3. Save to Files and open the MP3 there for lock-screen/Bluetooth playback. You can also generate on a computer and AirDrop or send the MP3 to your iPhone. No email-ingestion address is configured.

## Text accuracy

There is **no chat model or content-generation step**. The text is partitioned into bounded passages; joining those passages must exactly reconstruct the reviewed input. Every passage must finish before a complete MP3 is offered. The downloadable transcript is the input snapshot used for that audio. Nothing interprets instructions embedded in a sermon as commands.

This verifies text routing, **not acoustic accuracy**. The neural speech engines and may mispronounce, omit, repeat, or otherwise render words incorrectly. Device voices also normalize numbers and abbreviations. No zero-hallucination or word-perfect audio guarantee is made. Listen alongside the transcript for important passages. The transcript is not an automatic transcription of the generated recording. Document extraction can reorder or omit content; DOCX text boxes, footnotes, tables and PDF columns need manual review. Image-only/scanned PDFs are rejected when they contain no extractable text; OCR is not included.

## Privacy / free operation

Documents and sermon text are handled locally in this browser, with saved drafts and MP3 checkpoints on this device and no backend uploads or analytics. Kokoro model/runtime/voice files download from Hugging Face and library asset CDNs, and fonts load from Google Fonts; those hosts receive ordinary network metadata. Device speech services depend on the OS and may use vendor network services. Drafts and recordings can survive refreshes in this browser; download backups because browser storage can be cleared. The public GitHub repository contains application code and approved public assets, never visitor manuscripts or recordings.

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

The in-progress reader saves drafts and individual MP3 passages in this browser. A recording contains up to 150,000 characters; the full draft can hold 2 million characters with chapter selection. Browser storage is not a backup. Download important recordings and reviewed source text. Local storage can be removed by private browsing, browser cleanup or quota pressure.

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

The reader keeps one synthesis worker/model family warm for up to 30 idle seconds after successful passages, previews and passage-safe pauses. A rapid Resume or another reading can reuse that model; Stop, errors, starting a request in another engine family, leaving the page and idle expiry dispose of the worker. No full-document PCM cache or parallel inference queue is added. Request IDs and cancelled-worker checks discard late responses. Source text, voice settings, delivery pauses and encoded output are unchanged.

Worker replies include local per-passage render time (including any model load), MP3 encoding/frame-validation time, model-load count and the actual selected Kokoro provider. These measurements are not uploaded. The progress message starts before model initialization. Existing CPU fallback after GPU failure remains in place; physical WebGPU performance has not been established by CPU verification.

A single before/after run on Intel i7-1065G7, Node 24.21.0, cached Kokoro CPU q8/Sarah at 1x used three distinct synthetic paragraphs (265 characters, 20.136 seconds of output audio), treating each as a separate creation/resume flow. Recreating the worker took 30.560 seconds; warm reuse took 27.492 seconds (10.0% lower elapsed time), with worker creation reduced from three to one. Every MP3 passage was byte-identical and both combined files decoded with ffmpeg. This measures real synthesis and restart overhead, separately from the earlier synthetic export benchmark. It does not claim faster inference during one uninterrupted long reading or constitute a long-book soak. Timing varies; this is one comparison, not a statistical speed guarantee.

The tradeoff was higher peak Node RSS: about 460 MB before versus 634 MB after. Browser memory is not inferred from Node RSS. The short idle timeout and one-family limit bound retention, but do not impose a hard per-worker heap limit. Actual pending CPU inference cancellation rejected the request in about 65 ms and a fresh-worker retry produced identical audio bytes; that measures client rejection latency, not native CPU thread cleanup or spoken-word accuracy.

```sh
node scripts/benchmark-worker-sessions.mjs before
node scripts/benchmark-worker-sessions.mjs after
node scripts/verify-worker-recovery.mjs
```

These scripts reuse existing model caches and dependencies. The production worker is adapted only for Node transport, CPU selection and local encoder URL resolution. Results go to ignored `.cache/`. No private text, paid API or alternative model is needed.
