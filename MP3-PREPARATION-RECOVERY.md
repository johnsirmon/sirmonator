# MP3 preparation progress and recovery

Baseline `6dd60494d487ce24d79cfcc273e5d750415eff3d`. The codec, ordered PCM,
sampling, deliberate pauses and single-encoder assembly are unchanged. Worker
responses now echo request ID and type. The client accepts only the expected
acknowledgement, handles messageerror/workererror and synchronous sends, and
discards failed/cancelled work before any artifact can be published.

## Progress

Progress counts nonempty audio passages only after the worker acknowledges their
completed encoding. Empty boundaries contribute no audio request. Sample totals
are also supplied to observers. Starting, encoding, finalizing and complete are
distinct phases: encoding all passages does not claim that final flush/download
has finished. Encoding updates are throttled to at most four per second, plus
phase/terminal transitions. There are no predicted times or invented percentages.
New foreground exports hide any prior meter while their checkpoint is validated;
encoding progress begins only after the actual encoder starts acknowledging work.

The UI has a native progress element labeled "MP3 audio passages encoded" and a
polite live status. Foreground MP3/ZIP export updates its own status; chapter
preparation updates the separate chapter status. Selection/render guards prevent
late background work from overwriting another selection or active export. Stop
hides the old meter; terminal failure/cancellation also hides it. Observer errors
do not change encoded audio.

## Timeout and resource lifecycle

The default watchdog is **180,000 ms per outstanding request**, including encoder
startup, each saved Blob read, each part acknowledgement and final flush. It
resets for every request; this is not a three-minute whole-recording limit.
Stored passages are normally short. Three minutes gives a deliberately generous
window for slower devices and cold encoder-module loading, while preventing an
indefinite unresolved UI. It is a recovery policy, not a measured universal upper
bound. Very slow devices, suspended pages or faulty storage can still trigger it;
retry with the page foregrounded, a smaller chapter or a faster device.

Timeout, bad response, worker failure or abort reject the pending operation,
clear its watchdog, terminate the worker once and ignore late responses. A worker
failure during Blob reading settles that read as well. A late abandoned read
cannot resume encoding. The client checks read byte lengths and final compressed
output bounds. Asynchronous termination is awaited where the worker API provides
a promise (Node); browser terminate has no completion promise. No new retry runs
automatically. User retry reads the existing immutable checkpoint/take selection
again; no saved audio, selection or source is deleted or rewritten.

## Evidence

Fake-clock tests cover stalled start/read/part/finish, send exceptions,
messageerror, workererror, bad IDs/acknowledgements, abort, malformed output, late
responses, timer cleanup and awaited worker shutdown. Main export tests confirm
no download on failure and unchanged selected revision. Source hash regressions
prove PCM helpers unchanged and worker codec source unchanged after removing only
the new response-envelope fields. Exact current adapter hashes are registered in
the conservative archived-render compatibility bridge; future edits do not inherit
that permission automatically.

`scripts/verify-mp3-recovery.mjs` compares the baseline and new clients using actual
Node MP3 workers and procedural CC0 PCM with pronunciation and selected takes.
It injects a messageerror, retries, and requires identical MP3 bytes, frame-parsed
MP3 durations, input duration accounting and untouched job state. Results are in
`evidence/mp3-preparation-recovery.json`. Synthetic output identity does not prove
spoken accuracy or acoustic quality. Watchdog expiration uses fake time, not a
real three-minute wait. No new browser/phone integration test or download was
performed, and no model, codec or dependency was installed. No merge/deployment.
Final checkpoint: 191 tests and the production build pass.
