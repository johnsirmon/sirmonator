# Local reference preparation (not personal voice generation)

This milestone is stacked from speech-review `0bd2d4a`. The earlier prototype
`2d7976006a41ca5713e06947cda3637d4d36d250` remains untouched. The separate
`e0c327f` correction restores the anchored passage selector when review navigation
is cancelled, preserving unsaved notes.

## Available now

The reference panel requires an explicit authority, intended-use and AI-labeling
attestation before reading a file. It validates a 3–10 second, mono, 24 kHz PCM16
WAV, bounded to 512 KiB, without resampling or trimming. Strict RIFF validation,
signal checks and file/PCM hashes reject malformed, silent, DC-only and excessively
full-scale inputs. These checks do not establish speech, identity or permission.

Users can save, reload, revoke or forget one local metadata receipt. Audio and
embeddings are not retained. A separate versioned IndexedDB store prevents stale
tab writes and reuse of an old version after forgetting. Cancellation prevents
late validation from publishing. Revocation concerns this preparation receipt;
it does not remove existing recordings or exported files.

No personal narrator is added. Enrollment and personal synthesis explicitly fail.
The recording and worker boundaries reject reference-bearing requests before
model loading, rather than silently producing a preset. Archived renderer
contracts preserve existing pronunciation v1/v2 recordings and resumable jobs.

## Actual cached-model experiment

`evidence/reference-model-inventory.json` records streamed hashes of all eight
existing files at revision `c469236dbc5f68287fa2fbf175b66de3b80123af`:
146,243,630 bytes, verified against public pinned repository metadata. Only small
metadata JSON was fetched; no model weights or reference audio were downloaded.
The metadata declares CC BY 4.0 for these model files. The installed
`pocket-tts-js` 0.1.0 code is MIT; the community export repository describes its
export code as Apache 2.0. These licenses do not supply permission to use a
person's voice. The official upstream model's consent gate was not accepted.

`scripts/verify-reference-encoder.mjs` runs offline using existing Node ONNX
runtime and those verified files. It generates a CC0 procedural 220 Hz tone,
validates its exact WAV, decodes that WAV and calls the actual Mimi encoder and
voice-conditioned-state construction. The captured run completed conditioning
in about 340 ms. No person's voice was used. This proves an encoder path, not
speaker likeness or speech quality.

Generation with that custom reference returns **Unknown character voice**: the
current character wrapper only recognizes its bundled character identifiers.
`evidence/reference-encoder-smoke.json` records this expected blocker and disabled
personal-synthesis capability. It must not be presented as a functioning clone.

## Concrete next implementation gate

1. Add a separately versioned custom-reference sampling/provider route in the
   worker, rather than borrowing a bundled character identifier or its settings.
   Carry a validated reference identity through conditioning and output provenance.
2. Verify that route with the existing synthetic fixture and cached April models;
   no new model installation is needed for that bounded experiment. Establish
   cancellation, immutable settings, cache isolation and PCM/export integrity.
3. Validate offline browser asset integrity and runtime compatibility. The Node
   cache is not browser CacheStorage evidence; the existing Pocket worker's ORT
   runtime differs from the installed web runtime. Newer upstream models have not
   been selected or assumed compatible.
4. Before personal enrollment, obtain an owner-supplied authorized reference and
   explicit intended-use permission, then perform human listening/likeness review.
   Consent checks, revocation semantics and reference hashes must remain in the
   immutable render provenance. No automatic accuracy claim is justified.

Primary references: [Pocket TTS upstream](https://github.com/kyutai-labs/pocket-tts),
[official model card](https://huggingface.co/kyutai/pocket-tts),
[community ONNX export](https://huggingface.co/vlapky/pocket-tts-onnx).

## Verification

143 tests pass; production build passes. Added coverage includes malformed WAVs,
duration/signal bounds, consent-before-read, digest tampering, deferred-read
cancellation, storage reload/revoke/forget and stale versions, actual UI bindings,
input invalidation, engine rejection and legacy renderer compatibility. The
offline encoder experiment uses real cached model inference on synthetic input.
UI tests use DOM stubs; this milestone has not had a new browser integration or
personal speech/subjective acoustic test. Existing browser transport problems
were not retried. No merge or deployment is included.
