# Long-form resilience checkpoint

Baseline: `23d62a8e229a8fdbee6406c14b4330529f8fa9e2`. No merge or deployment.

## Reproduced defect and compatibility

A same-length bit flip in original PCM passed checkpoint validation before this change (the new regression failed with “Missing expected rejection”). New recordings freeze `original-pcm-sha256-v1` in their manifest. Commit snapshots submitted bytes before asynchronous hashing and stores their SHA-256; validation requires and checks the hash one Blob at a time. Missing hashes or removal of the declared policy fail validation. Reports and recording provenance expose the policy. This detects accidental corruption; it is not authentication against an attacker rewriting all stored data.

Historical manifests remain supported through the archived render contract. Recordings without recorded original checksums remain readable, with `legacy-original-checksums-unrecorded` reported explicitly. No historical checksum is invented and no database migration/reset occurs. Codec and synthesis inputs are unchanged.

## Reproducible checks

`npm test`: 221 passed, zero failed/skipped. `npm run build`: passed. Three fixed seeds (105220, 12648430, 3735928559), 48 actions each, produce 144 actions and 15 successful export publications. See `evidence/seeded-resilience.json` for full traces. Run `node scripts/run-seeded-resilience.mjs` to reproduce.

Scenarios use production storage/take/review/export APIs with fake-indexeddb and actual Node codec workers. They cover interrupted generation and resume, append order, immutable source/original PCM, take selection/undo, review invalidation, stale exports during concurrent selection, reopen/open failure, duplicate commits, corruption rejection and aborted takes. Independent ordered PCM encoding supplies export hash/duration/sample-count checks. Existing alternative/history and chapter-cache bounds are asserted. These finite scenarios are not exhaustive concurrency proof.

Quota fault tests now inject a real asynchronous duplicate-request failure after writes are queued and cancel an actual preparation transaction after its put is queued. Rollback preserves previous metadata/selection and committed exportability; retry does not leave orphan parts. Mid-flight cancellation now consistently reports AbortError. Optional telemetry failures retain the earlier export-preserving coverage.

## Bounded resource measurement

Run `node --expose-gc scripts/measure-longform-resilience.mjs`. The procedural CC0 fixture has 120 passages, three chapters, 13,318 source characters, 240 seconds and 11,520,000 PCM bytes. It uses production APIs and fake-indexeddb, not model synthesis. See `evidence/longform-resilience-measurement.json`.

The measured full artifact took 5,041 ms and produced 1,920,384 bytes, exactly matching the independent encoder SHA-256 `45ea23917eaa3b5394d33181214165971b368cd0668867e749c5ab07615df9d7`. FFmpeg decoded it successfully; MP3 frame duration was 240.048 seconds. Full export read 120 metadata rows once and 240 Blobs / 23,040,000 bytes (checksum plus encoding). Chapter requests 0,2,0 caused encodes 0,1,2,0,1, confirming eviction: three metadata reads / 360 rows and 588 Blob reads / 56,448,000 bytes.

Sampled peak RSS was 518,324,224 bytes (about 494 MiB), across this Node experiment including its oracle and workers; FFmpeg is excluded. It is not a constant-memory guarantee or phone estimate. Compressed chapter cache remains capped at two entries / 24 MiB, final compressed artifact at 96 MiB. Original checksum verification adds real read/hash work, including all original parts for a validated snapshot. No unsupported speed improvement is claimed.

Native Edge also committed the full fixture in an isolated namespace, exported the same MP3 hash in memory, reloaded and verified all 120 original checksums. See `evidence/longform-browser.json` and `scripts/longform-browser-fixture.html` (requires exact loopback origin 4201 and a unique run query). This uses native IndexedDB and production browser encoding, not fake-indexeddb or synthesis. No download completion or screenshot is claimed; screenshot transport had previously failed and was not retried.

## Remaining risks

Historical original audio without stored hashes cannot establish historical byte integrity. Hour-scale checksum IO and mobile memory need measurement on target devices. Native-browser fixture results are recorded separately; no tone decode/hash result establishes pronunciation, speech accuracy, perceptual continuity or voice likeness. Long-form real-model synthesis, phone testing and subjective acoustic review remain outside this milestone.
