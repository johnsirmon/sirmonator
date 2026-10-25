# Experimental custom-reference Node route

Baseline: `40459e27a655e5fb9f297095e5ea47e2a4484d23`. This branch includes the
separate `20bb502` reference-panel startup correction and its bootstrap regression.

The existing cached April Pocket runtime can synthesize from a custom conditioned
state. `scripts/pocket-node.mjs` now has an explicit `custom-reference-v1` route
using the installed MIT `pocket-tts-js@0.1.0` upstream worker, separately from the
production character wrapper. Production worker code, narrator choices and saved
recording contracts are unchanged. No character ID is substituted for a reference.

This is a **Node-only synthetic-fixture research API**, not personal cloning in
the application. `scripts/custom-reference-session.mjs` accepts only a validated,
unrevoked synthetic attestation and the exact corresponding WAV bytes. Personal
authority receipts are rejected. One session holds one immutable reference in
worker memory. Input PCM is cleared after conditioning; no raw audio, embedding
or conditioned state is persisted. Revocation/disposal terminates the dedicated
worker. Deferred reads, late runtimes, conditioning, streamed output and external
abort signals cannot publish a cancelled result. Changing a saved preparation
receipt does not remotely revoke this separate experimental process; its session
must be revoked/disposed explicitly. It is not connected to the browser panel.

The actual cancellation experiment exposed a native-runtime hazard: forcibly
terminating a Node worker during an ONNX call can exit the process. The Node
bridge now rejects publication immediately, suppresses late messages, requests
cooperative stop, and waits for active requests to settle before terminating the
native worker. Disposal is asynchronous; it does not promise immediate resource
release. A focused test exercises this ordering in the actual bridge source.
Disposal also tracks a pending runtime factory, including cleanup of a runtime
created after revocation. Its completion promise waits for that late runtime's
termination rather than snapshotting an initially empty termination list.
Runtime ownership transfers atomically inside that tracked factory promise;
revocation in its microtask handoff cannot start conditioning or leak a runtime.

The explicit contract pins upstream worker hash, existing model inventory hash,
model revision, Node ONNX runtime 1.21.0, language, sample rate and upstream
sampling settings. Offline initialization rehashes all eight cached model files
before inference and rejects changed assets or unsupported contracts. No network
fallback is permitted. Artifacts use `experimental-reference-pcm-v1`, are not
resumable and are not accepted by the saved-recording/take path. A fresh session
and original file are required after disposal. No personal reference is enrolled
or restored on reload.

Text is limited to 960 characters and passed unchanged to the upstream tokenizer.
Finite mono output is bounded to 60 seconds (5.76 MB PCM). Accumulation and final
concatenation can temporarily hold about twice that PCM, in addition to model,
inference, native-runtime and other process memory. This is not a constant-total-
memory claim. Output provenance includes the contract, exact test text, attestation,
file/PCM digests, selected reference ID and output sample count. The smoke report
also hashes generated PCM. No test audio file is retained.

## Verification and remaining gates

`scripts/verify-custom-reference.mjs` conditions on a locally generated CC0
220 Hz sine wave and runs actual cached-model CPU synthesis. It saves metrics and
provenance to `evidence/custom-reference-runtime.json`, clears the resulting PCM,
then interrupts a second actual generation and checks that no result publishes.
There are no people's voices, uploads, new weights, installations or paid calls.
The cached model inventory declares CC BY 4.0; see REFERENCE-PREPARATION.md for
licensing and provenance sources. The original character-route encoder experiment
and its historical `Unknown character voice` result remain intact.

Unit tests cover exact-file binding, synthetic-only authority, immutable identity,
contract mismatch, concurrent operations, changed files, deferred reads/runtimes,
conditioning cancellation, late chunks and malformed/excessive output. These are
API/lifecycle checks, not acoustic verification. The actual tone-conditioned
generation demonstrates inference and cancellation only. It does not establish
intelligibility, likeness or suitability for personal cloning.

Final checkpoint: 152 tests pass and the production build passes. The captured
run loaded/conditioned in about 1.92 s and generated 3.04 s of PCM in 2.25 s;
peak magnitude was 0.374. A second active inference rejected with AbortError in
about 63 ms after cancellation was scheduled, published no result, and completed
worker disposal. Sampling is stochastic; these metrics are not performance or
bit-identical-output guarantees across runs or devices.

Browser runtime/asset integrity, browser worker lifecycle, owner-authorized speech
input, listening review, long-form behavior and integration with immutable takes
remain unvalidated. Keep personal-cloning UI disabled. A future browser adapter
must explicitly validate those gates and define storage/revocation behavior before
accepting any real person's reference. No merge or deployment is included.
