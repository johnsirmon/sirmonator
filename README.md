# The Sirmonator — I'll read it back.

**Try it:** https://johnsirmon.github.io/sirmonator/

Paste a sermon or choose a TXT, DOCX, or text-based PDF. Review the imported text and check the confirmation, then listen. Choose **Studio voices** to create a downloadable WAV, or **Quick listen** for your device's voices. No account, API key, paid voice subscription, or server is needed.

## For Jay / iPhone

1. Open the link in Safari.
2. Paste text or choose a document from Files. Review the displayed text, especially PDF reading order.
3. Choose a voice and click Audition this voice. A small, pre-rendered sample plays immediately, without downloading a model. Confirm your text, then choose Sirmonate my sermon.
4. For car listening, choose Studio voices first and wait for the whole audio file. Keep the page open and awake during creation. Full sermon creation downloads roughly 100–400 MB of model weights plus runtime assets on first use. Supertonic uses CPU/WASM by default to avoid GPU-device-loss failures. Kokoro can use WebGPU, with an automatic CPU retry if either loading or inference fails. A computer is recommended for long sermons.
5. Use Share audio / Save to Files when available, or Save audio for the car. Save to Files and open the WAV there for lock-screen/Bluetooth playback. You can also generate on a computer and AirDrop or send the WAV to your iPhone. No email-ingestion address is configured.

## Text accuracy

There is **no chat model or content-generation step**. The text is partitioned into bounded passages; joining those passages must exactly reconstruct the reviewed input. Every passage must finish before a complete WAV is offered. The downloadable transcript is the input snapshot used for that audio. Nothing interprets instructions embedded in a sermon as commands.

This verifies text routing, **not acoustic accuracy**. Both engines use neural speech synthesis and may mispronounce, omit, repeat, or otherwise render words incorrectly. Device voices also normalize numbers and abbreviations. No zero-hallucination or word-perfect audio guarantee is made. Listen alongside the transcript for important passages. The transcript is not an automatic transcription of the generated recording. Document extraction can reorder or omit content; DOCX text boxes, footnotes, tables and PDF columns need manual review. Image-only/scanned PDFs are rejected when they contain no extractable text; OCR is not included.

## Privacy / free operation

Documents and sermon text are handled in browser memory, with no backend uploads or analytics. Kokoro model/runtime/voice files download from Hugging Face and library asset CDNs, and fonts load from Google Fonts; those hosts receive ordinary network metadata. Device speech services depend on the OS and may use vendor network services. Sermons are not saved across refreshes. The public GitHub repository contains application code only, never uploaded manuscripts or recordings.

22 studio choices are included: ten Supertonic 3 narrators (five male, five female), ten Kokoro voices, and two character-inspired treatments. Supertonic 3 was released in 2026 and is now archived; its models remain downloadable under OpenRAIL-M, and its example code is MIT. The archive revision is pinned in source. Kokoro uses Apache-2.0 model weights. GitHub Pages hosts the app for free, subject to GitHub's service limits. Natural voice creation is limited by your device speed and memory; long audio can take several minutes and large WAVs consume memory. Stop terminates natural synthesis and discards incomplete audio. Device speech cannot reliably play with an iPhone locked; use a downloaded audio file.

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

**Prime Preacher** is an Optimus Prime-inspired low, heroic, lightly metallic treatment of Supertonic M1. **Grit & Grace** is a Marcus Fenix-inspired low, rough treatment of M3. These are approximate audio effects, not official character voices, actor impersonations, or trained voice clones. Pitch/formant lowering, bass shaping, subtle saturation, and optional ring modulation change the rendered waveform. Synthesis speed compensates for pitch resampling. No extra text, instructions, filler, laughs, or breaths are inserted.

**Natural** delivery favors complete sentences, respects paragraph breaks, and adds silence after sentence and paragraph boundaries. **Reflective** adds longer pauses; **Continuous** leaves pauses to the engine. The source transcript is identical across delivery modes. The vendor Supertonic text normalizer still applies its built-in pronunciation and symbol normalization, like Kokoro's phonemizer; these are not guarantees of literal spoken rendering of every symbol.

Supertonic first use downloads approximately 398 MB of model weights plus runtime files. Model files are cached when the browser permits it. For lengthy manuscripts, use a computer and share the resulting WAV to your iPhone. Voice names such as The Storyteller are application display names for the underlying model presets; preview them to choose the sound you prefer.

Attributions: [Supertonic 3 archive](https://github.com/supertone-oss-archive/supertonic), code snapshot `1e9799e964ea4c0dad7cde993b65c3c813a7b373`, model snapshot `aafc6e32416a594460b32413efc49d7fe4ce6d46`. The vendored helper and license notices are in `src/vendor/`. Local adaptations are documented at the top of the helper.

## Audition reliability

All 22 studio auditions are checked-in WAV files under `public/auditions/`, generated from the same underlying models and character effects as full narration. The fixed sample text is in `manifest.json`. Samples use normal delivery at 1× speed; they never contain a visitor's manuscript. Auditions call native audio playback directly from the click gesture and do not start an ONNX worker, GPU, or model download. If the browser blocks autoplay, the visible native audio player offers a manual Play button.

`node scripts/generate-auditions.mjs` regenerates missing samples using the Node CPU runtime. Its model cache and temporary runtime adaptation stay in ignored `.cache/`; the generated public samples are explicitly included in Git. Regeneration needs network access and a few hundred MB of disk space. CI verifies every WAV's format, duration, audible sample energy, file size, and voice-manifest coverage.

The GPU recovery regression test injects the reported `OrtRun` / `mapAsync` device-loss error during inference and verifies that the **same text and settings** are retried exactly once on CPU, with subsequent passages staying on CPU. Recovery discards failed-attempt audio and never publishes an incomplete recording.
