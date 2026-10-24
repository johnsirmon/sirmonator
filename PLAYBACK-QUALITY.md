# Playback continuity investigation — 2026-10-24

Production base: 4c7f3108fae67b85848d4808dfaf0d2fe5f741a2. Host: DESKTOP-9BUQ5MF, C:\source\Tina\sermon-reader.

The confirmed encoding issue is repeated encoder priming/padding: independently encoding checkpoint passages and concatenating their MP3 bytes inserts padding at every join. Valid MP3 frames did not prove continuous timing. A synthetic Kokoro speech fixture had near-zero endpoints already; a proposed blanket edge fade was removed. No speech crossfades, silence trimming, loudness normalization, model changes or text changes are applied.

## Implementation

New recordings created in the application explicitly select `pcm-passages-v2-2026-10-24`. Each passage and its exact sample count/rate are atomically saved as mono signed 16-bit little-endian PCM. The conversion uses the same clipping and quantization as the original encoder. Intentional app pauses stay in these samples exactly once. One dedicated worker encodes each selected chapter/full/partial download or podcast artifact with one encoder and one flush. It consumes one passage at a time with a reusable 1152-sample block, rather than allocating whole-book PCM. Model synthesis does no MP3 encoding for these checkpoints. The final compressed artifact is bounded to 96 MiB. Stale chapter preparation stops between passages; the worker always terminates on completion/error.

Legacy `mp3-passages-v1-2026-10-23` identities, checkpoint validation, resume and byte-concatenated downloads remain intact. Legacy recordings are not decoded/reencoded, and format mixing is rejected. The low-level recording API defaults to legacy for existing callers; the application explicitly opts new jobs into PCM. Short single-passage previews retain the original MP3 path.

Storage increases: about 2.88 MB/min at 24 kHz or 5.76 MB/min at 48 kHz, versus 0.48 MB/min for 64 kbps MP3. Preflight discloses this and quota estimates use 48 kHz PCM with headroom. PCM avoids a second lossy encode; it is not a permanent audio backup guarantee.

## Evidence

See `evidence/continuity-comparison.json` for all 12 deterministic tone cases (1/10/100 passages at 22050/24000/44100/48000 Hz) and identical-PCM real speech comparison. FFmpeg decoded every output successfully.

| Fixture | Before padding | After padding |
| --- | ---: | ---: |
| 100 × 125 ms, 22050 Hz | 5786.85 ms | 66.03 ms |
| 100 × 125 ms, 24000 Hz | 6700 ms | 52 ms |
| 100 × 125 ms, 44100 Hz | 3172.34 ms | 37.64 ms |
| 100 × 125 ms, 48000 Hz | 4300 ms | 28 ms |
| 3 Kokoro speech passages, 24000 Hz | 164 ms | 68 ms |

Remaining padding is once at the artifact endpoints, not repeatedly between passages. The speech fixture keeps all 428640 input samples and 960 ms of intentional pauses. Source routing exactly reconstructs the authored text. Original inference took 23.54 s. Split encoding took 624.93 ms; new PCM staging took 10.93 ms and a cold export worker took 726.42 ms. This one run does not establish a speedup: startup is included only for the new worker, and export must now encode instead of simply concatenate. Checkpoints occupy 857280 bytes; the largest transfer is 362640 bytes. Encoding is off the UI thread. No extra blanket float conditioning buffer is allocated.

Browser verification: Edge at http://127.0.0.1:4183, actual production storage/runner/export worker, three generated tone passages. Source exact, 24384-byte MP3, 3.048 s decoded duration, 24000 Hz mono. Export plus decode took 698.1 ms. Native player changed from Play to Pause after pressing Play. This verifies loading/decoding/playback state, not human listening quality.

Tests additionally verify continuous output is byte-identical to a single encode of ordered identical PCM including deliberate silence, rejection of malformed PCM/mixed formats, exact source, restart/resume only missing passages, export cancellation and byte budget. All 65 prior tests retained.

## Reproduce

`npm test`; `npm run build`.

`node scripts/render-continuity-fixture.mjs` (requires already cached Kokoro weights; remote loading disabled), then `node scripts/measure-continuity.mjs`. The measurement runs without models for the tone matrix; it reuses the local speech WAV if present. WAV/MP3 listening files and detailed metrics are in `.cache/continuity/` and are not bundled into the app.

Primary references: [LAME encoder/decoder delay](https://lame.sourceforge.io/preecho.php), [Web Audio decodeAudioData semantics](https://www.w3.org/TR/webaudio-1.1/#dom-baseaudiocontext-decodeaudiodata). These motivate measuring padding and avoiding whole-recording decode/reencode as a quick fix.

## Limits and next review

This fixes a measured encoding discontinuity, not every possible vocal artifact. No acoustic word-accuracy or subjective listening-quality claim. Human A/B listening across the user's selected voices is still needed. Independent TTS calls can vary prosody; Pocket internal pauses, time-stretch state and chapter-to-chapter native-player loading gaps remain separate candidates. Chapter artifacts are continuous within themselves; chapter transitions are not claimed gapless. No automatic legacy repair, deployment or merge. No paid service, model download, reference upload or microphone use.

Voice cloning remains paused separately at local branch `codex/consented-reference-voice`, checkpoint `2d79760`. That WIP UI is not wired and synthesis remains disabled; none of its edits are in the playback branch. No Hermes-specific tool or notes were available in the checked repository, .agents/.codex locations, or tool catalog; the personal-agent-skills link target was absent. Global .codex/AGENTS.md was empty. No concurrent repository editor was started.

Final verification after reconnect: 68/68 tests passed (0 skipped), production build passed. Application Open/resume restored the persisted PCM fixture with a playable chapter. The attempted full MP3 download verification lost browser transport before completion; no matching file or success message was found after reconnect, so download completion remains unverified and was not retried. Earlier approval-manager item scope/status could not be inspected; no approval was inferred. This limits download UI evidence, not the separately verified production worker/storage/decode result.

## Review corrections

Exports now accept AbortSignal through validation, deferred Blob reads, worker passage replies and final flush; Stop, recording selection and page exit abort preparation and terminate the encoder. Audio/share/podcast publication checks cancellation again after awaited work. Stop stays available during export/preparation. Late results cannot become a player source or download. Native sharing already dispatched to the OS remains governed by its own dialog.

The player now prepares the next available chapter immediately after loading the current chapter, before onended. A two-entry LRU cache retains at most 24 MiB of compressed chapter blobs, keyed by recording identity (including voice/pipeline revision), chapter and that chapter's committed passage count. Unrelated later chapter commits preserve completed cache entries; growing chapters replace their prior snapshot. Recording selection/deletion/Stop/page exit clears and aborts pending cache entries. Cache hits still validate checkpoint integrity before playback. Oversized chapters can play but are not retained. Late completions and deferred ended handlers cannot override manual navigation. This removes mandatory full chapter reencoding at each transition/revisit when the preparation fits the cache and completes in time; native media loading still prevents a claim of fully gapless chapter transitions.

The 96 MiB limit is per compressed output artifact, not a constant total-memory bound: PCM blobs, an in-flight passage per worker, compressed worker output, cache and native player buffers also consume memory. No whole-book decoded PCM buffer or lossy legacy migration is introduced.

New regression coverage includes abort during deferred Blob/part/finish, post-flush stale state, audio/podcast publication suppression, shared prefetch, revisit reuse, snapshot keys, out-of-order completion under the cache budget, navigation races, positive legacy MP3 resume/export, empty boundaries, a final impulse and exact pause sample accounting.

Review-correction validation: 82/82 tests passed, zero skipped; production build and git diff --check passed. The final changes were validated by automated lifecycle/cache/publication and real encoder tests; the prior Edge smoke evidence predates these lifecycle corrections. No new browser-download success or subjective listening result is claimed.
