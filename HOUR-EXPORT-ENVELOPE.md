# Synthetic export/checksum envelope

Baseline: `6e41e12bb904167a124d49ae5c56bce71251a75b`. This milestone profiles existing production validation/MP3 encoding. It does not change production code or claim a speedup.

Final checks: `npm test` passed 223 tests with zero failures/skips; `npm run build` passed. No merge/deployment, model downloads or production data changes.

Reproduce sequentially (not concurrently):

```powershell
node --expose-gc --max-old-space-size=192 scripts/measure-hour-export.mjs 5
node --expose-gc --max-old-space-size=192 scripts/measure-hour-export.mjs 15
node --expose-gc --max-old-space-size=192 scripts/measure-hour-export.mjs 60
```

The fixture retains metadata only. A Blob subclass generates one deterministic procedural CC0 two-second PCM passage for each read; there is no whole-recording PCM allocation, database filling, model inference, speech or temporary audio file. Each normal read materializes 96,000 bytes. This is synthetic CPU/hash/codec work, not actual IndexedDB disk throughput. The earlier native-browser/storage experiment remains documented in `LONGFORM-RESILIENCE.md`.

The initial hour attempt used longer text per passage and correctly hit the existing 150,000-character manuscript guard before encoding. That attempt is retained as `evidence/hour-export-60m-source-limit.json`. The final fixture uses shorter distinct source paragraphs within the same production limit; no limit or validation rule was bypassed. All final durations use this consistent revised fixture.

The PCM template intentionally repeats across normal passages to make lazy generation inexpensive. Distinct manuscript slices/part indices still pass production validation, but this profile is not an acoustic ordering oracle; the earlier seeded scenarios use varying PCM and independent ordered encoding for that purpose.

Every run has a 40 MiB final compressed-artifact limit, 150-second deadline and sampled 640 MiB process RSS stop condition. Node receives a 192 MiB V8 heap limit; RSS includes its worker(s), with a 25 ms sample interval. These are conservative experiment guards, not hard operating-system resource limits. A transient peak can occur between samples. Children are run separately so earlier worker heaps do not accumulate across durations.

For each duration, checksum rejection is tested at first/middle/last original parts. Full export freshly validates all original checksums once, then reads every part again for encoding. A middle chapter is separately exported original/selected/undo, checking the expected 0.1-second take duration change and byte-identical restored MP3. Chapter operations intentionally validate the full recording afresh; the resulting read counts make that cost visible. No long-lived trust cache is introduced. `tests/lazy-hour-fixture.test.js` protects lazy generation, bounded read size, fresh immutable reads and corruption/take behavior.

Raw results are `evidence/hour-export-{5,15,60}m.json`; each includes the build source hash, exact input/output bytes, checksum read counts/position, frame-parsed duration, output hashes, take/undo hashes, phase memory samples and elapsed times. Audio hash-check counts equal original passages reached during corruption validation; full validation checks every original once. MP3 artifact SHA-256 is a separate additional hash. Text/manifests also undergo existing production digests; they are not counted as PCM checksum reads.

## Results on DESKTOP-9BUQ5MF

| Logical duration | Parts / original checksum checks | Full export | MP3 bytes | Full PCM reads / bytes | Sampled peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5 minutes | 150 | 7.49 s | 2,400,384 | 300 / 28,800,000 | 336.7 MiB |
| 15 minutes | 450 | 23.26 s | 7,200,384 | 900 / 86,400,000 | 344.9 MiB |
| 60 minutes | 1,800 | 88.51 s | 28,800,384 | 3,600 / 345,600,000 | 439.7 MiB |

All runs passed. The hour run represented 172,800,000 logical PCM bytes without retaining that PCM or writing it to storage; metadata and compressed artifacts still consume memory. All normal PCM reads were 96,000 bytes. Selected-take reads were 100,800 bytes. The complete hour experiment, including corruption checks and three chapter exports, took 126.27 seconds within its 150-second budget.

First/middle/last corruption checks rejected after 1/901/1,800 original PCM reads for the hour fixture. Last-part rejection took 4.87 seconds (5-minute fixture: 0.44 s; 15-minute: 1.28 s). This is a corruption-validation measurement, not an isolated complete-validation timer. A selected 2.1-second middle take replaced the 2-second original, increasing its chapter duration by exactly 0.1 seconds; undo restored the original chapter SHA-256 at every tested duration.

The full path performs one original checksum read and one encoding read per part, rather than an avoidable second validation pass. Separate chapter operations intentionally revalidate fresh metadata/audio. The profile does not justify a longer-lived unchecked cache or changing integrity boundaries, so production code is unchanged and no speedup is claimed. Memory is materially larger than retained PCM/read-block sizes; codec/runtime/worker and compressed-output lifetimes require device-specific investigation before mobile assurances.

These results do not establish speech accuracy, acoustic quality, browser/native disk speed, mobile suitability or constant total memory. The compressed cache/artifact limits do not bound codec/V8/worker process RSS. No optimization is justified solely by extrapolation.
