# Local cloning short-reading MVP

Branch base: verified remote main `0a71bd47b7527ff9a9eb3114257ad6fb7bdc6c59`.
No autosave, ASR, saved-sermon contracts, reference assets or character sampling
changes. No merge or deployment is included.

The new panel accepts an explicitly selected mono PCM16 24 kHz WAV, 3–10 seconds,
at most 512 KiB. The uploader confirms ownership or permission and AI labeling.
That is an attestation, not identity verification or a grant of third-party rights.
Validation measures format, hashes and signal levels; it does not verify speech.
The separate existing metadata-only panel remains available.

Create validates the exact selected bytes, then starts one disposable worker using
the upstream MIT pocket-tts-js 0.1.0 sampling implementation, separately from the
character worker. Model revision c469236dbc5f68287fa2fbf175b66de3b80123af uses
the existing eight-file, 146,243,630-byte inventory (CC BY 4.0). Cached and fetched
files are SHA-256 checked before inference. The browser reuses the existing
`sirmonator-pocket-april-v1` cache key where assets are already present. Otherwise
Create downloads public model assets and pinned ONNX Runtime Web 1.21.0 from
jsDelivr. There is no reference-audio upload or network inference API.

Reference PCM, conditioning and output accumulation are session memory only.
Input PCM is cleared after conditioning. Completed worker state is disposed after
each reading. Cancel, input edits, revoke, forget and pagehide dispose the worker
and invalidate late results. Revoke/forget actions in the metadata panel also
invalidate the active cloning panel through an event. No audio or embeddings are
saved in IndexedDB. WAV/JSON Blob URLs persist only for the current preview and
are revoked on replacement or invalidation. Downloaded files and source files
are not deleted by these actions.

This is a separate short-reading flow: 960 characters, 60 seconds of output,
five-minute runtime watchdog, English, WAV export, no resume or saved-sermon/take
integration. Desktop browser recommended. No likeness, intelligibility, acoustic
quality, phone performance or long-form guarantee is made. Existing character
asset rights remain deferred; assets have not been changed or redistributed.

## Shared integration touchpoints

- `index.html`: additive `local-cloning` section and a second module script for
  `src/cloning/bootstrap.js`; metadata-panel copy points to the new panel.
- `src/reference-editor.js`: revoke/forget dispatch
  `sirmonator-reference-revoked`; status copy clarifies the separate flow.
- `main.js`: no changes. Cloning-specific ownership is `src/cloning/` and its tests.

## Validation

Node lifecycle tests use only procedural synthetic PCM and fake runtimes. They
cover byte binding, immutable identity, abort while reading/conditioning/generating,
late runtimes, concurrent calls, malformed/excessive output, retry, Blob URL cleanup,
revoke and errors. They are not inference or acoustic tests.

Native Edge on Windows, localhost:5176, produced a 3.04-second WAV Blob from the
bundled generated Kokoro af_sarah audition (4.4 seconds, PCM16 24 kHz). Target text:
"The small lantern glows beside the open window." No human/character reference
recording was used. Preview was muted through the local QA harness; no acoustic
listening claim. The actual browser route used the pinned 1.21.0 WASM runtime and
verified model assets. This demonstrates compatible synthesis, not likeness.

The Edge extension file chooser refused automation because Allow access to file
URLs is off. No permission change was made. An ignored `.cache/clone-qa.html`
harness selected the generated fixture into the same file input via an explicit
QA button. Thus automated OS file-picker validation remains incomplete. Blob
downloadMedia is unsupported; a receipt-click download wait timed out. Actual
download completion remains unverified by browser automation. Generated WAV
encoding and Blob URL retrieval/cleanup are separately tested in Node.

The native cancel/retry sequence cleared the prior preview and reported Cancelled
with output hidden. A replacement Create was started; later browser reads timed
out before CDP command dispatch, so that retry's synthesis result and native
revoke/forget remain unverified. Do not infer a completed retry from the passing
Node lifecycle tests. The retained tab may contain that uncertain operation.

Final verification: 399/399 full serial tests passed (60.8 s), production build
passed (2.67 s), then 14/14 focused cloning tests passed after adding revoked,
changed-byte, authority-path, contract-mismatch and stopped-partial-output cases.
No real device acoustic or identity validation was performed. The browser file
permission restriction and later command-dispatch timeouts are QA limitations;
no permission, credential or security setting was changed.

## Independent review corrections

The initial draft omitted the metadata editor's revoke/forget event dispatch.
Both actions now synchronously invalidate the cloning session before attempting
the metadata mutation, including if that mutation fails. The event has no
reference payload. Tests instantiate both actual editors, hold a generation
across metadata revoke, and verify that metadata forget revokes both completed
preview/receipt Blob URLs. These are same-page session controls, not remote or
cross-tab revocation.

The upstream worker previously reported `stopped:false` when its 500-frame loop
exhausted without EOS completion. It now rejects that chunk with a frame-limit
error, so partially streamed samples cannot become a completed session preview.
An interrupted loop reports `stopped:true`, which the session rejects. Regression
tests exercise the actual worker loop and message dispatch with fake ONNX calls:
no EOS, EOS too late to complete its tail, normal completion and interruption.
These tests do not constitute a new acoustic or native-browser validation.

No browser actions were performed for these review fixes. Earlier file-picker,
download and repeated native-flow acceptance limits remain open.

Review-fix verification completed: 407/407 full serial tests passed (175.85 s),
20/20 focused cloning tests passed (5.59 s), production build passed (12.92 s),
and `git diff --check` passed. The full-suite summary was recovered from the
retained log after the execution connection interrupted its final read.

## Combined staged-reader integration

On the isolated MVP integration branch, the existing cloning card is placed in Voice by its stable `local-cloning` ID. Create remains a sibling of Voice. Leaving Voice invokes the existing Cancel handler only while a clone operation is active, so hidden work does not continue. Completed session previews remain available on returning to Voice. Manual review and optional ASR stay separate in Listen. This routing is tested with the actual cloning panel/session and deferred synthetic runtime; it is not new native file-picker, download, likeness or real-inference evidence. Same-page revocation and the documented native acceptance limits still apply.
