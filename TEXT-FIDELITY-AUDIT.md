# Text fidelity and input-boundary audit

Baseline: `196b68dcd76427d472550c2a59b0ed4a576e69cf`. No chunker, matcher, identity, frozen manifest, synthesis or audio storage behavior changed. Production changes are a bounded preview warning and more accurate TXT import guidance. No merge/deployment or model download.

## Deterministic evidence

`npm test`: 240 passed, zero failures/skips. `npm run build` and `git diff --check`: passed.

`scripts/text-fidelity-fixture.mjs` defines seeds 1114111, 826366246 and 12648430. Corpus atoms include CR/LF/CRLF, blank paragraphs, tabs, NBSP, Unicode paragraph separators, combining marks, supplementary letters, emoji/ZWJ sequences, directional isolates, smart quotes, scripture references, decimal numbers, literal markup/dollar syntax and 481-character tokens. No speech/model is involved.

- 192 source cases at seven chunk sizes (2/3/7/79/239/240/241): 1,344 chunking checks reconstruct every original UTF-16 code unit, stay within chunk limits and do not split surrogate pairs. Chapter spans and selected chapter ranges remain contiguous and recover the requested exact source.
- Accepted 150,000-code-unit input remains complete; an extra unit is rejected, as are malformed surrogates. Canonically equivalent precomposed/decomposed source forms retain different identities; no NFC/NFKC normalization is introduced.
- Strict UTF-8 and BOM-marked UTF-16LE/BE decoding preserves decoded text/newlines; malformed encodings and NUL-containing TXT input fail explicitly. The 10 MiB file and two-million-character draft limits reject without returning a truncated replacement.
- Pronunciation mappings retain original offsets, nonoverlap and all unmatched text. Alias output is literal, including dollar syntax and markup; inserted output is not rescanned. Reconstructing source requires the original source/mappings: aliases alone are not generally reversible.
- Three real-storage API scenarios (fake-indexeddb) pause, close/reopen, fail an uncommitted attempt, reopen/resume, regenerate an exact selected passage, export selected PCM and undo. Successful original generation requests concatenate to the exact source once; the failed request is retried without a duplicate committed passage. Source/settings/last-passage routing and original PCM hashes remain unchanged. Selected exports match independent ordered PCM encoding hashes.
- The actual main transcript-export handler is exercised with a captured Blob sink. Its bytes equal TextEncoder(original source), including CRLF, a leading U+FEFF, combining marks and supplementary characters; spoken aliases are not substituted into source export. Browser download completion is not inferred.

Run the focused tests with:

```powershell
node --test tests/text-fidelity-properties.test.js tests/text-fidelity-lifecycle.test.js tests/text-fidelity-warnings.test.js
```

No silent character drop or reordering was found in these finite cases. They do not prove arbitrary inputs or model output accuracy.

## Reproduced ambiguity and safe clarification

For source `"x".repeat(240) + "John ends here."`, whole-source matching correctly finds no standalone John, but the saved passage boundary puts John at the start of a passage. Both frozen v1/v2 matchers then accept `John => jon` there. This is existing per-passage behavior, not source mutation. Changing it would alter frozen speech inputs. The preview now warns when a Unicode word token crosses a passage boundary in its bounded preview, with guidance to inspect spoken input or remove ambiguous rules. This warning does not fix or reject the historical matching behavior, and it does not scan beyond the displayed preview.

TXT guidance now explains existing semantics: decoding is strict, an encoding BOM is consumed, and HTML textarea values use LF line breaks. Decoded TXT content retains its line endings until assigned to the editor. Source preservation guarantees apply to the reviewed editor/recording source, not original document-file byte identity. DOCX/PDF extraction can still reorder or omit layout content and retains its existing review warning.

Native Edge on isolated origin `http://127.0.0.1:4203` confirmed CRLF/CR input appears as LF in the editor, exact original-versus-spoken preview text, and the split-token warning. Initial tab creation timed out; inventory showed it had completed and supported attachment recovered it, without creating a duplicate tab. No generation, download or production recording/draft was touched. Screenshot retries were not attempted.

## Remaining fidelity limits

Chunking preserves code points/source units, not complete grapheme clusters or linguistic tokens. Combining sequences and ZWJ clusters can span passages. Pronunciation boundaries remain passage-local; phrases spanning passages do not match, and split token fragments can match as above. A future context/grapheme-aware policy requires explicit versioning and compatibility tests rather than rewriting old identities.

Numbers, scripture references, abbreviations and quotes are passed as written; the model decides their pronunciation. Character reconstruction, tone exports and transcript comparison do not establish that synthesized speech says every word correctly. No ASR, pronunciation accuracy, PDF/DOCX fidelity, subjective speech or multilingual model claim is made here.
