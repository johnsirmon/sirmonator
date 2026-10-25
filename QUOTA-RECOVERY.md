# Quota-safe commits and optional preparation timing

Fault injection against the previous head confirmed a synchronous QuotaExceededError
from jobs.put could leave an already queued parts.add committed while job.next
remained unchanged. In the reproduction, one completed passage became two stored
parts with next still 1. This was an injected failure, not observed corruption of
any user database. The commit now aborts and settles its transaction on every
exception before rethrowing the original error. Audio and progress remain atomic.

Tests verify an earlier committed prefix stays byte-identically exportable, a
retry adds the missing passage once, and duplicate commits do not add another part.
Take selection already had abort protection; a quota regression confirms failed
alternative/revision writes roll back and retry adds one take, retaining originals.
The existing UI QuotaExceededError guidance still describes downloading saved audio
and freeing space manually. No automatic database clearing or deletion is added.

Artifact preparation timing is optional. Timing observers and their error handlers
can no longer prevent an otherwise valid MP3 from being returned. Persisting that
timing has a separate **2,000 ms** default budget, using an abortable transaction.
This is a conservative UI policy for a small metadata write, not a measured phone
storage limit. Slow/unresponsive metadata must not indefinitely hold prepared audio.
Timeout/quota leaves metricsPersisted=false and the UI says the save was not
confirmed. If an injected writer ignores cancellation it may complete later;
that cannot change the audio, source or take selection. Normal storage writes
honor the abort signal. Explicit user cancellation still rejects the entire export.

Only artifact timing observers/writes are optional. Required frozen per-passage
render provenance, performance validation, PCM integrity and take limits remain.
The prior combined render contract is archived; exact transport adapter hashes
continue to gate compatibility with all earlier supported recordings.

Deterministic tests inject synchronous quota, timing observer failures, failed and
unresponsive timing writes, cancellation and pre-aborted writes. They do not fill
a user's disk, reset a database or simulate acoustic quality. Native browser quota
exhaustion and large-device memory remain unrun. The full code path is independent
of how many earlier passages have already committed.
