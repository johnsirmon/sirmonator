# Recording database lifecycle recovery

Stacked from `7afa00eebf771d67df3983763e4613ca4986fc98`. The separate runtime
correction `ac71f16` tracks late factory cleanup and unwinds failed native sends.

The recordings database keeps its existing name and version 2 schema. There is
no reset, deletion or new schema migration. An opening blocked by another tab
now rejects immediately with actionable guidance. Any other stalled open rejects
after 10 seconds. A request cannot be cancelled through IndexedDB itself: abandoned
requests abort a later upgrade transaction, close a later successful connection,
and cannot publish a ready state. Explicit Retry local storage starts a new open.

The application displays connection state independently of transient render status.
Recovery preserves the current unsaved draft instead of replacing it with an older
saved copy. Text backup and device Quick listen remain available; saved-recording
actions are disabled while the connection is unavailable. An already queued draft
save remains bound to its original connection, preventing a late retry from
redirecting an old snapshot into a newly opened connection.

On version change or unexpected close, the connection immediately refuses new
transactions and closes gracefully. The app invalidates selection/export/cache
work, cancels synthesis and take work, pauses saved playback, warns about unsaved
draft edits and offers recovery. Existing transactions may finish atomically;
committed passages are retained. It does not claim that an unsaved passage or draft
was saved. Lease renewal/release stays bound to the original connection, and a
closed-connection release does not mask the interruption result.

If another build upgraded the database beyond this build's supported version,
Retry cannot downgrade it. Close outdated tabs and reload a compatible build after
backing up current text. No automatic downgrade, deletion or destructive recovery
is offered. Connection behavior for the separate reference-metadata and manual-
review databases remains a future follow-up; this milestone covers the recordings
database that gates audio creation and library restore.

The renderer source catalog includes the lifecycle module and an explicit archive
of the preceding reference-preparation contract. The compatibility bridge permits
only orchestration changes while retaining exact synthesis, pronunciation and
dependency checks. Original and frozen pronunciation v1/v2 jobs remain supported.

## Verification

Deterministic tests cover blocked upgrade with preserved data and explicit retry,
abandoned late upgrade/success, timeout/abort, unexpected close, version change
during deferred generation, committed passage integrity, main interruption hooks,
unsaved-draft preservation on retry and archived render compatibility. Existing
UI fixtures declare their connected-storage state explicitly.
Final checkpoint: 161 tests pass and the production build passes.

Actual Edge two-tab smoke on isolated loopback port 4192 used only a uniquely named
synthetic database. It displayed StorageBlockedError, preserved the synthetic
draft after holder closure and retry, then returned StorageClosedError when a
version change invalidated the old connection. The normal app booted with
"Local recordings connected" and enabled creation on the same isolated origin.
Production-origin drafts and recordings were not touched. A screenshot request
timed out at five seconds and was not retried; accessibility-state observations
are recorded in `evidence/storage-browser-smoke.json`. No real-model generation
or phone test was performed for this storage milestone. No merge/deployment.
