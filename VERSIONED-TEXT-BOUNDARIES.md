# Versioned whole-word / grapheme text boundaries

Baseline: `d71b20109a74a7e6311ea73ff033f200187134bf`. Feature branch only; no merge/deployment or new model download.

Final checks: 263 tests passed, zero failures/skips; build and diff whitespace checks passed. The actual cached-model report's rendering source fingerprint matches the final catalog.

## Frozen compatibility design

New Studio recordings use `word-grapheme-240-v2`, encoded in `renderManifest.chunker`. The streaming planner retains complete whitespace-delimited spans and complete `Intl.Segmenter('en', {granularity:'grapheme'})` clusters, preferring paragraphs and sentence whitespace when available. It never rewrites, normalizes, trims or drops source text. Passage length remains at most 240 UTF-16 code units. A token/joined cluster that cannot fit is rejected with its source position; no partial new recording is created.

Unicode/ICU segmentation can differ between runtimes. The actual passage end offsets are therefore hashed into `boundaryPlanHash`, included in the NEW recording ID. Checkpoint validation reconstructs from those frozen offsets, checks complete contiguous source coverage and surrogate validity, and recomputes the hash/identity. It does not recut an existing new-policy recording through a newer segmenter. Source/offset/hash tampering rejects, while an existing plan validates even if Segmenter is unavailable. Fresh creation needs Segmenter and fails clearly when unsupported. This is an integrity binding, not authentication against an attacker rewriting all stored fields.

Legacy MP3/PCM/frozen recordings retain `exact-offsets-240-v1`, the original chunker and original ID formula. No plan hash is added to old recordings. Exact-pinned compatibility adapters and the archived pre-change source catalog preserve old resumes; all previous compatibility cases still run. Unknown incompatible render contracts remain exportable where structurally valid but cannot start new inference. No database/schema migration occurs. Reports expose the boundary policy and optional plan hash.

## Preview and activation

Fresh drafts default to New. Older drafts without an explicit policy reopen in Legacy preview only. Choosing New resets the review acknowledgment; Create refuses legacy preview mode and focuses its policy selector. Saved-recording resume always follows that recording's frozen policy, regardless of draft mode. Existing fixed auditions, device quick reading and legacy passage previews keep their earlier behavior.

Draft chapter ranges and spoken previews use the selected policy. Oversized source errors are visible before Create and preserve the draft. The browser check caught and fixed an initially missing preflight error display. The policy selector/help are labeled, creation guidance is associated with Create, and the control is disabled during busy operations.

Custom passage preview also reports the boundary error and focuses the preserved source rather than incorrectly claiming that the draft is empty. The final browser check confirmed this guard without altering its completed saved recording.

## Pronunciation tradeoff

Preserving whole tokens removes the demonstrated artificial suffix match (a long token cut immediately before `John`). New mode rejects that oversized unbroken token instead of accepting a misleading partial match. Legacy previews keep the original result and warning.

Multi-word rules can still straddle a passage boundary. They remain deterministic within each frozen passage and are not rewritten across passages. New previews explicitly warn about this limitation whenever multi-word rules are present. A regression demonstrates whole-source `John John => pair` can be split across two passages and remains unsubstituted. A future rule-aware planner requires separately reviewed/versioned source-to-spoken mapping; it is intentionally not implemented here. Alias matcher v1/v2 behavior is unchanged.

## Evidence

- 96 seeded new-policy corpora verify exact source recovery, whole words, grapheme-safe offsets, valid Unicode and passage limits. Adversarial tests cover combining/ZWJ/flag/Indic clusters, whitespace carrying combining marks, CRLF/paragraphs, exact-limit tokens and oversized clusters/words. A full-length ordinary manuscript is tested separately.
- Frozen plan/identity tests cover altered/missing hashes and changed/missing runtime segmentation. Existing legacy fidelity fixtures now explicitly carry their historical chunker instead of manufacturing old-source fingerprints with the new policy. No legacy expected behavior was removed.
- Existing deployed c2f5cbb, historical PCM/MP3, takes/undo, cancellation/resume, corruption, review and export suites remain enabled.
- `scripts/verify-boundary-model.mjs` used the existing hash-verified Kokoro q8 cache on Node CPU with remote models/fetch disabled. Two source requests reconstruct the exact source, their spoken inputs match frozen aliases, and the 140,352-byte / 17.485-second MP3 decoded with FFmpeg. See `evidence/versioned-boundaries-real-node.json`; this is actual inference, not a tone substitute. No listening/ASR accuracy claim follows from it.
- Native Edge on isolated origin 4206 verified the oversized-input error, legacy creation gate, new Unicode/source/spoken preview, persisted draft policy, and interruption at 2/3 committed passages followed by resume to 3/3 with unchanged ID. Browser TTS was explicitly procedural CC0 tones. See `evidence/versioned-boundaries-browser.json`.

## Adoption limits

This is a conservative whitespace-delimited policy, not universal language-aware word segmentation. Very long URLs, no-space scripts or joined spans over the limit require the user to review/correct the source; they are not silently split. Full-draft chapter planning can be blocked by an oversized span even outside the intended range; legacy preview can inspect that text, but range-local exclusion is a future usability improvement.

240 source code units and the existing 960-character alias-output limit are not a guarantee about every model's tokenization or speech accuracy. Source fidelity does not prove every word was spoken. Phrase-aware cross-passage aliases, browser real-model inference for this policy, acoustic listening, phone limits and full assistive-technology testing remain unverified/unimplemented. Model/DSP processing and intentional pauses were not changed, but new passage locations can change cadence and require listening review before adoption.
