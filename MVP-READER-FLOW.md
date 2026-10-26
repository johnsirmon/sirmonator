# Staged reader MVP

The existing reader now presents Add text, Voice, Create and Listen & save as separate panels. Back/Next and hash history keep the same editor, recording, audio and worker nodes. The library stays available, with draft and saved-audio shortcuts. Creation, preparation, storage retry and cancel controls remain available across panels. Text compatibility and podcast preparation remain accessible as disclosures. The poster, warm palette and original narration/export implementations remain in place.

## Integration touchpoints

The UX implementation is commit `249188f`. `src/main.js` only imports and invokes `installReaderFlow`; its autosave implementation was not edited by that commit. New `src/reader-flow.js` reparents the existing Create panel out of Voice, wraps podcast preparation, and moves existing progress/recovery controls into a common activity panel. `src/style.css` appends scoped layout rules. Reference/clone and ASR owners should continue using existing element IDs; new controls placed inside Voice or Listen follow their respective stage. A panel must not assume Create remains a descendant of Voice.

Base was verified main `0a71bd4`, including PR6. The parent-cleared prerequisite `5f52da7` is reproduced as `861cf45` for independent testing. The parent integration branch already has that prerequisite: cherry-pick the UX and evidence/tooling commits, not the duplicate prerequisite. No merge or deployment performed here.

## Validation, 26 October 2026

- `node --test --test-concurrency=1`: **393 passed, 0 failed**, 90.55 seconds, after the cleared prerequisite. Earlier baseline runs remain 386 passed / 1 fixture lease-expiry failure; they were not suppressed.
- `npm run build`: passed, 4.34 seconds.
- Supported native Chrome on a dedicated loopback origin, with muted HTML audio and synthetic procedural tones. Actual IndexedDB, recording checkpoints, MP3 encoder, playback and production file-save function ran. No TTS models downloaded.
- Keyboard example activation, review gate, Next/Back, browser Back and saved-draft preservation checked. Storage blocked-open injection then Retry preserved edited text and review. Returning-user entry restored saved recordings.
- In a 375px-wide desktop iframe (360px content area after scrollbar), Listen measured 360px document width and 360px scroll width. Controls and native audio fit; screenshot inspected. The browser viewport override did not take effect and is not counted as evidence.
- Muted playback reached `ended=true`, readyState 4, at 1.68 seconds. An in-memory MP3 was frame-parsed and hashed.
- Cancel before recording creation preserved old work. Cancel during an active synthetic passage reported `Current passage cancelled. Saved passages were kept.` Resume retained an incomplete recording. A saved prefix of 1/3 passages survived reload; resume completed 3/3. Navigation back to Add text retained the edited source.
- Production save function created `Example-sermon.mp3` in the native Downloads directory. Independent parsing found 13,248 bytes, 1.656 seconds, SHA-256 `f6d708522a45e75fa20a65071eab9cbd18624ce58ef07b53b8ed92a1c493b704`. The browser download-event wait timed out; disk inspection confirmed the outcome without repeating the save.

## Reproduce bounded browser checks

Run `node scripts/prepare-reader-flow-harness.mjs --port=4395`, then serve this checkout with Vite on that same dedicated loopback port. Open `/.cache/integration-app.html?storage-blocked` for storage recovery, or `/.cache/narrow-flow.html` for the desktop narrow frame. The default sink captures MP3s in memory. Add `--browser-download` to use the production file-save function. All audio elements start muted. For cancellation, increase the generated tone worker's delay temporarily, then restore its ordinary delay before completing resume. Generated files stay under ignored `.cache/`.

Limits: desktop browser widths are not iPhone/Android testing. Synthetic tones validate flow and bytes, not speech quality, acoustic accuracy, clone likeness or real-model runtime behavior. No offline-cache guarantee or mobile lock-screen claim was tested. Share-sheet behavior remains platform dependent. The optional pause request preserved a saved prefix, but a fresh stable pause-status receipt was not captured, so no additional pause-specific claim is made.
