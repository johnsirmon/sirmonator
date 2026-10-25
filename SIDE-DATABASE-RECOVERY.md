# Reference/review connection recovery

The separate reference-metadata and manual-review databases now use the same
managed opener as recordings: blocked/open timeout errors are visible, abandoned
late opens close safely, versionchange closes the connection, and subsequent
transactions fail with recovery guidance. Existing database names/version 1 schemas
are unchanged. No resets, migrations, deletion or reference audio persistence.

Editors acquire repositories through a small reconnect adapter. A rejected open
does not permanently poison Reload. A default/injected factory can reopen an
inactive connection; explicit repository objects cannot be recreated and report
that a page reload is required. Versionchange invalidates active editor work:
reference inspection/file selection is cleared; manual review input is retained
but findings/selection are marked stale until explicitly loaded again. A newer
database schema reports backup/compatible-build guidance; Retry never downgrades.

Tests cover both blocked open paths and late connections, real fake-indexeddb
version changes with retained records, incompatible reopen, factory retry, and
reference Reload retaining unsaved consent fields. Combined browser integration
also verifies actual review save/reload on the isolated origin. Native browser
version changes for these two separate databases remain unrun; the recording
database had its own real two-tab smoke in STORAGE-LIFECYCLE.md.
