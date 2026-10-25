# One-operation chapter validation

Baseline `cbb8bd128edf1fcc619add6fbcb80d3aa161e165` performs whole-recording
validation in showRecording, loadChapter, current recordingBlob, and next-chapter
prefetch recordingBlob. That repeats committed-part reads, pronunciation hashes,
selected-take reads and selected audio hashing four times on this path.

The application now creates one validated playback preparation. It clones and
freezes the job and validated resolved-part metadata before publishing the selected
recording. A private capability shares those exact validated inputs only with the
current chapter and its immediately following prefetch. The cache forwards this
capability to recordingBlob; callers cannot supply an arbitrary parts array to skip
validation. Each preparation is consumable once. It drops its metadata references
after the current/prefetch work settles; cached entries retain compressed results,
not a reusable checkpoint authorization. Later navigation validates afresh even
when compressed audio is cached.

Cancellation checks now also cover checkpoint reads, pronunciation hashes and
selected-take resolution. If one consumer cancels a shared pending cache artifact,
its snapshot remains valid only until that artifact settles, so another consumer
does not inherit an expired capability. Stop/selection invalidation still clears
the cache's own encoder signals. Errors and eviction release the operation.

Original parts, source text, settings and takes are unchanged. Cross-tab take
changes produce a new revision/key; an in-flight operation remains bound to its
earlier immutable selection. Growing chapters use their committed-prefix key and
a new validation operation. Existing export/revision publication guards remain.
The archived cbb8bd1 contract preserves resumability across these orchestration
changes without relaxing synthesis/dependency checks.

The operation holds one book's metadata/immutable Blob references until its bounded
pair completes, not a whole-book decoded PCM array. Existing two-entry/24 MiB
compressed-cache and per-encoder 96 MiB compressed-artifact limits remain. These
are not constant-total-memory or measured heap-allocation claims. Blob storage,
runtime memory, active encoders and the player have additional memory costs.

## Measured evidence

`scripts/benchmark-chapter-validation.mjs` loads the baseline job-runner and take
resolver source from Git, then compares it with the new preparation API. The
fixture has 2,000 passages, 15 chapters, 83,998 source characters, a frozen literal
pronunciation rule and 16 selected takes with distinct PCM/durations. Both routes
use actual Node MP3 workers, ordered synthetic PCM and an instrumented in-memory
store returning structured-cloned IDB-shaped metadata. Three alternating before/
after rounds must produce identical current/next MP3 hashes and durations.

The captured run reduced metadata job reads from 2 to 1, bulk-part reads from 4 to
1 (8,000 to 2,000 returned rows), and selected-take reads from 64 to 16. The current
and next artifacts were byte-identical across all rounds, including selected takes.
Raw timings and hashes are in `evidence/chapter-validation-benchmark.json`.
Timings measure this synthetic local path, including encoding and worker startup;
they do not measure browser disk IO, real speech generation, acoustic quality,
phone performance or full-length audio. They are not a universal speed promise.

172 tests and the production build pass. New tests cover immutable pair reuse,
fresh corruption checks despite cached audio, expiration, concurrent consumers,
cross-tab revisions, growing recordings, cancellation and eviction. Existing main
UI/cancellation/selection tests exercise the new API boundary with fixtures.
No additional browser test, model load, merge or deployment was performed.

Separate review corrections on this branch: `d2da90b` fixes the custom-runtime
microtask ownership handoff; `a3da6d1` prevents stale draft status updates and adds
newer-database-version recovery guidance.
