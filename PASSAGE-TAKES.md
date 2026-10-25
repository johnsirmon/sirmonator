# Selective passage takes and undo

This milestone starts from production `c2f5cbbe980a8af6587bee3d4d95e7aa21fc5296` on `codex/passage-takes`. It implements the first design milestone in RENDER-FOUNDATIONS.md. Independent review is required before any release; no merge or deployment is part of this task.

## Behavior and storage

Complete manifest-backed PCM v3 recordings expose an exact-text passage selector, regenerate, retained-take selector and undo. Regeneration uses the recording's saved voice/edition/speed/delivery/manifest and original final-passage flag, never the current draft's voice controls. It uses the existing synthesis client and worker. The production path is real inference; only the explicitly labeled local smoke harness substitutes synthetic tones. No model installation, reference voice, paid endpoint or pronunciation rewrite is added.

IndexedDB upgrades from version 1 to 2 by adding a `takes` store. Existing jobs, source, draft, original parts and recording identity remain intact. Original parts are never overwritten. Each alternative records source offsets and SHA-256, PCM SHA-256, frozen manifest hash, actual execution-build source hash, timestamp and render metrics. Audio/text hashes and PCM metadata are checked before selecting/exporting an alternative. A newly generated take and its selection commit atomically under the generation lease and expected selection revision. Cancellation/failure before commit leaves the previous selection intact; a transaction already committed remains durable even if the page closes afterwards.

Selection changes increment a persistent revision. Undo changes selection rather than copying PCM; the last eight changes are retained. Original and existing alternatives remain explicitly selectable. Limits are two alternatives per passage, 256 alternatives per recording, and 32 MiB of additional retained PCM per recording. The transaction enforces the byte budget even when generation began below the limit. These are storage limits, not a total browser/model memory bound. Takes have no separate delete operation in this slice; deleting a recording removes its originals and alternatives together.

Playback cache keys include selection revision. A successful UI change clears pending preparations and the old audio URL, then prepares the selected chapter. Exports freeze the acknowledged immutable selection and encode selected PCM in original passage order with one MP3 encoder. A concurrent later selection change cannot mix takes into that snapshot. A stale tab must reload the latest audio before starting export. MP3 filenames include the take revision; render reports include selected take IDs, hashes and execution source hashes, and preparation records include selection revision. Original job timing/duration/bytes remain the original creation totals; report passage metrics describe selected audio.

Legacy v1 MP3 and v2 PCM playback/export paths are preserved and remain read-only for passage repair. Incomplete jobs must finish first. Unsupported historical v3 render contracts retain playback/export and existing-take selection, but cannot synthesize new takes. No implicit lossy migration is performed. The schema upgrade is additive, but older application builds that explicitly open database version 1 cannot reopen a version 2 database; a release rollback must retain the version-2 reader rather than delete user data.

## Explicit foundation compatibility

`src/render-contract-944aa8e.json` preserves the reviewed production foundation catalog. The compatibility bridge accepts that exact source contract only when all synthesis, model, tokenizer, voice, DSP, encoder and package-lock hashes still match and all non-source manifest fields exactly match the current contract. Only the explicitly listed storage/orchestration/provenance files may differ. Unknown historical contracts remain unsupported. Every new alternative additionally records the current execution source hash; the original frozen identity is not rewritten. This bridge must be reviewed again if any audio-rendering code changes. Neighboring audio/context conditioning and reproducible stochastic seeds are not implemented or advertised.

## Verification

Execution host: DESKTOP-9BUQ5MF. Checkout: `C:\source\Tina\sermon-reader`.

- Full local suite: 105 passed, zero failed/skipped before reconnection; repeated final checks are recorded in the milestone response. Existing 93 tests remain included.
- Synthetic PCM tests cover middle-only replacement and exact source/settings/final flag, original-byte retention, database v1 upgrade, close/reopen, undo and reselection, stale revision/lease failures, inference cancellation, deferred Blob-validation cancellation, corruption rejection, frozen export racing undo, legacy exports, compatibility rejection, cache keys, storage budget and bounded history.
- Actual take-editor control tests cover deferred cancellation, stale inventory navigation, legacy disabled controls, and enabling repair after original creation finishes.
- `npm run build` and `git diff --check` pass. No new dependencies or model weights.
- `node scripts/prepare-takes-smoke.mjs` writes ignored local fixtures. Serve with Vite on a dedicated loopback origin; open `/.cache/takes-seed.html`. The harness retains real app/storage/export code and substitutes only a delayed synthetic-tone worker. Do not run it on the production origin.
- Local Edge on `http://127.0.0.1:4185` visibly verified fixture import preserving prior test recordings, Stop enabled during delayed regeneration with selection still original at revision 0, a selected middle-passage alternative at revision 1, native audio readyState 4/duration 3.048 s, and selection retained after reload. This is synthetic tone evidence, not speech inference or acoustic QA.
- The last browser undo/export inspection stalled and eventually returned Transport closed. After reconnection, binding the existing tab returned Debugger unattached; no matching synthetic-takes MP3 was found in the standard Downloads folder. Undo/download completion for that last browser attempt remains unknown, and the download was not retried. Automated undo and MP3 export restoration passed independently.

Saved logs: `.cache/takes-tests-final.log` and `.cache/takes-build-final.log`. No subjective listening judgment, real-model regeneration, phone behavior, long-form soak or production smoke is claimed for this milestone. Production draft/recordings were not opened or modified in these checks. Browser QA should resume by inspecting the uncertain existing attempt before another download.

Next gate: independent review of the pushed feature head, especially additive storage migration, manifest compatibility and selection/cancellation races. Later pronunciation/review/cloning work stays queued.

## Independent review corrections and bounded QA follow-up

The initial review head was `1aa0d486212bf528a5ea268a25d8dea44f75435d`. Two confirmed issues were corrected before release:

- Podcast preparation now receives the encoded artifact's frozen selection revision and selected PCM duration, rather than comparing against immutable original `job.seconds`. Missing/mismatched selected-artifact metadata is rejected. Longer/shorter alternatives, undo, ZIP audio byte identity and a concurrent later undo are tested; original duration is unchanged. A handler-level test verifies the UI forwards the artifact fields.
- The audio ended handler refuses a different take revision read from another tab. It keeps the acknowledged selection and asks the user to load latest audio; reaching the end cannot silently acknowledge unheard audio and defeat the export guard. A final-chapter two-tab regression test checks that subsequent export is blocked before encoding/publication.

Final correction suite: 108 passed, zero failed/skipped; build and diff checks pass. Logs: `.cache/takes-review-tests.log`, `.cache/takes-review-build.log`.

Supported browser recovery used a fresh Edge tab after the old ephemeral tab disappeared and restarted the same loopback test server. Reading the existing test recording showed **Original selected, revision 2**, confirming the earlier undo committed and survived reopening. The prior download result remains unknown. The browser policy denied `edge://downloads/all` (only HTTP/HTTPS permitted); no alternate download-history access or repeated download was attempted. The policy denial is an outstanding QA limitation, not an application test failure.

A cache-only real-inference harness was prepared using the existing hash-verified q8 model/config/tokenizer/style files; no new weights were obtained. Navigation to that harness timed out at the explicit 10-second tool limit and reset the browser kernel. No regeneration command was sent in that attempt, so real-model passage regeneration remains unrun for this milestone. Synthetic-tone UI evidence and automated MP3/ZIP validation are not represented as real speech or listening QA.
