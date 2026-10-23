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

**Prime Preacher** and **Grit & Grace** now use free Pocket TTS voice conditioning from short original Optimus Prime and Marcus Fenix speech references. The initial pitch-masking effects were removed. No pitch lowering, bass boost, saturation, metallic modulation, or reverb is added. Speed adjustment preserves pitch. These are unofficial character impressions; resemblance is not guaranteed.

The optional comparison below the voice selector provides the short reference audio, source links, and actor performance interviews. [VOICE-RESEARCH.md](VOICE-RESEARCH.md) records the research, alternatives considered, exact source provenance, pinned models, implementation and limitations.

Pocket character generation runs on CPU/WASM with roughly 150 MB of model assets. Supertonic's ten stock narrators require about 398 MB; Kokoro's ten stock voices use roughly 90–330 MB depending on the execution provider. All manuscript processing remains local. Pocket code is MIT; its model/export assets are CC-BY-4.0 with Kyutai attribution. Source character recordings retain their original ownership. SoundTouchJS is LGPL-2.1; its license notice is in `src/vendor/`.

`node scripts/generate-character-auditions.mjs` regenerates the two character samples. `node scripts/generate-auditions.mjs` generates missing regular samples and builds the 22-voice manifest. Both use ignored `.cache/` for model files.

## Audition reliability

All 22 studio auditions are checked-in WAV files under `public/auditions/`, generated from the same underlying models and character references as full narration. The fixed sample text is in `manifest.json`. Samples use normal delivery at 1× speed; they never contain a visitor's manuscript. Auditions call native audio playback directly from the click gesture and do not start an ONNX worker, GPU, or model download. If the browser blocks autoplay, the visible native audio player offers a manual Play button.

`node scripts/generate-auditions.mjs` regenerates missing samples using the Node CPU runtime. Its model cache and temporary runtime adaptation stay in ignored `.cache/`; the generated public samples are explicitly included in Git. Regeneration needs network access and a few hundred MB of disk space. CI verifies every WAV's format, duration, audible sample energy, file size, and voice-manifest coverage.

The GPU recovery regression test injects the reported `OrtRun` / `mapAsync` device-loss error during inference and verifies that the **same text and settings** are retried exactly once on CPU, with subsequent passages staying on CPU. Recovery discards failed-attempt audio and never publishes an incomplete recording.
