# Read-only storage visibility

Baseline: `ede13ba3735392128b8d9849b6c30324ca86dab8`. The separate engine-review correction is commit `a9571adc4077e52c5b1caed1a5bc9d2d024cb44f`: both Device/Studio switches clear the source acknowledgment before chapter planning changes (the reported 5,996/5,784-character case is covered). Feature branch only; no merge/deployment.

## What the UI measures

A small “Local storage · selected recording” details panel measures on demand. It separates original audio Blob payload, all alternative-take Blob payload, and approximate serialized main-recording/part/take JSON. Payload sum is displayed only for a complete measurement and explicitly is not actual disk allocation. Metadata excludes binary values; unsupported representations or exhausted budgets make its total unknown. Counts do not establish audio integrity or exportability of every stored row.

The shared-origin browser estimate now reports approximate used/quota values, not a promise of available disk space. Individual model-cache costs are unknown. Other databases, drafts, review/reference metadata, browser caches and allocation overhead are not attributed to a recording. Browser estimates may include other origin data where supported and may be rounded. No successful-generation guarantee is inferred.

Quota guidance preserves committed passages and directs the user to export available audio/source, choose fewer chapters or use another device before retrying. No new deletion/reset, persistent-storage permission request, cache enumeration or upload action exists. Existing audio/source export controls remain available during a measurement.

## Bounded and snapshot-safe

`store.usage` uses one readonly transaction over jobs/parts/takes, with batches of at most 128 rows, a 10,000-row cap and five-second deadline. No Blob arrayBuffer/stream/slice/decode is used. It retains only the current batch and bounded metadata traversal; this is not a constant total process-memory guarantee. A metadata budget of one million string code units / 200,000 visited nodes / depth 64 avoids unbounded serialization. A row cap produces a partial/lower-bound result; timeout/cancel rejects without publishing a partial result.

The UI adds one freshness job read and checks recording identity, creation marker, committed count/bytes and take revision against both its current selection and the atomic snapshot. Navigation/cancel suppresses late results. Another connection changing audio/takes causes an explicit refresh request without silently adopting its selection. Metadata and browser estimates are snapshots, not continuously monitored totals; later playback/optional-metric changes may not be included. Nothing is persisted by measurement.

Browser estimates are optional, capped at two seconds and cancellation-aware. Rejecting/stalled/unsupported estimate APIs return “unavailable” rather than making restored recordings look broken. New-creation Stop/Pause remains effective while awaiting the estimate and prevents synthesis acquisition. The underlying platform estimate API itself cannot be cancelled; late responses are ignored.

## Compatibility

No database version/schema change. The new method does not modify existing rows. A source-catalog archive preserves the reviewed Word-boundary build across these storage-only changes. Its compatibility bridge requires every non-orchestration source hash to match exactly; changed boundary/matcher/renderer code cannot inherit the legacy adapter exceptions. The cached real-model Word report retains its ID/plan hash and is tested as supported. All earlier legacy/deployed upgrade checks remain enabled.

## Evidence

Final verification: 278 tests passed with zero failures/skips; build and diff whitespace checks passed. Targeted tests cover exact JSON/payload accounting, zero application audio reads, caps, queued-batch cancellation, timeout/late completion, cancellation/navigation, cross-connection revision mismatch, optional estimate failures and startup restoration, quota guidance, and the engine-review correction. One early full-suite attempt was stopped because an extracted-handler test lacked the newly introduced estimate dependency; its context was updated, bounded test timeouts added, and subsequent targeted/full runs passed.

`scripts/measure-storage-usage.mjs` seeds 2,000 procedural PCM parts plus 16 alternatives through isolated fake-indexeddb data. Three sequential measurements fetched 2,016 rows using one readonly transaction and 18 requests each, with zero application audio-byte reads. Timings were 189.39 / 399.83 / 166.30 ms on this Node host. Original payload was 192,000 bytes; alternatives 2,304 bytes. Metadata exceeded its budget, so its total was correctly unknown; the recorded byte count is only the measured prefix. See `evidence/storage-usage-measurement.json`. UI freshness adds one metadata request; its optional browser estimate is separate. These are not native-browser disk-speed or phone guarantees.

Native Edge on isolated origin 4207 displayed the shared-origin estimate and a three-part synthetic recording summary: 75.9 KiB original payload, zero alternatives initially, approximately 10.7 KiB JSON, explicitly not disk allocation. Refresh retained keyboard focus and audio/source export controls remained enabled. Browser TTS uses procedural CC0 tones; no model, personal voice, upload or download completion is claimed. Final browser evidence is separate from Node timing evidence.

After one synthetic regeneration, the old summary cleared automatically. Refresh showed the same 75.9 KiB original payload plus a separate 32.3 KiB alternative at revision 1, with exports still enabled. See `evidence/storage-visibility-browser.json`.

Reproduce with `node --test tests/storage-usage.test.js tests/storage-usage-editor.test.js tests/storage-estimate-startup.test.js` and `node scripts/measure-storage-usage.mjs`. Unknown cache/disk overhead, large native-browser scans, actual device quota pressure and phone/assistive-technology testing remain limits. No spending, credentials or deployment changed.
