# Word for Word — Sermon Reader

**Try it:** https://johnsirmon.github.io/word-for-word-sermon-reader/

Paste a sermon or choose a TXT, DOCX, or text-based PDF. Review the imported text and check the confirmation, then listen. Choose **Natural voices** to create a downloadable WAV, or **Quick listen** for your device's voices. No account, API key, paid voice subscription, or server is needed.

## For Jay / iPhone

1. Open the link in Safari.
2. Paste text or choose a document from Files. Review the displayed text, especially PDF reading order.
3. Choose a voice and try Preview voice. Confirm your text, then choose Read my sermon.
4. For car listening, choose Natural voices first and wait for the whole audio file. Keep the page open and awake during creation. First use downloads roughly 100 MB of model weights plus runtime assets. A computer is recommended for long sermons.
5. Use Share audio / Save to Files when available, or Save audio for the car. Save to Files and open the WAV there for lock-screen/Bluetooth playback. You can also generate on a computer and AirDrop or send the WAV to your iPhone. No email-ingestion address is configured.

## Text accuracy

There is **no chat model or content-generation step**. The text is partitioned into bounded passages; joining those passages must exactly reconstruct the reviewed input. Every passage must finish before a complete WAV is offered. The downloadable transcript is the input snapshot used for that audio. Nothing interprets instructions embedded in a sermon as commands.

This verifies text routing, **not acoustic accuracy**. Kokoro is neural speech synthesis and may mispronounce, omit, repeat, or otherwise render words incorrectly. Device voices also normalize numbers and abbreviations. No zero-hallucination or word-perfect audio guarantee is made. Listen alongside the transcript for important passages. The transcript is not an automatic transcription of the generated recording. Document extraction can reorder or omit content; DOCX text boxes, footnotes, tables and PDF columns need manual review. Image-only/scanned PDFs are rejected when they contain no extractable text; OCR is not included.

## Privacy / free operation

Documents and sermon text are handled in browser memory, with no backend uploads or analytics. Kokoro model/runtime/voice files download from Hugging Face and library asset CDNs, and fonts load from Google Fonts; those hosts receive ordinary network metadata. Device speech services depend on the OS and may use vendor network services. Sermons are not saved across refreshes. The public GitHub repository contains application code only, never uploaded manuscripts or recordings.

Kokoro-82M-v1.0 is a free Apache-2.0 open-weight model. Nine curated US/UK voice choices are included. This uses the current published `kokoro-js` package verified at build time, without claiming Kokoro is the newest model overall. GitHub Pages hosts the app for free, subject to GitHub's service limits. Natural voice creation is limited by your device speed and memory; long audio can take several minutes and large WAVs consume memory. Stop terminates natural synthesis and discards incomplete audio. Device speech cannot reliably play with an iPhone locked; use a downloaded audio file.

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
