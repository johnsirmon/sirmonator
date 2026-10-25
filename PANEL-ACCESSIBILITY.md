# Panel keyboard and narrow-layout checkpoint

Baseline: `25a58941ae6b8819674ee4a18c983270caa7e7c9`. No redesign, dependencies, audio/storage changes, merge or deployment.

## Demonstrated failures and fixes

In native Edge, pressing Enter on manual review's “Open passage takes” left focus on BODY. The action tried to focus the take selector while the review operation still disabled it. Focus now transfers after the busy lifecycle settles and current selection checks pass. Other asynchronous panel actions restore lost focus to their initiating control (or an enabled panel fallback), including refresh and reference cancellation. A user who moved to another live control is not pulled back.

The six original/spoken preview areas were unnamed and had tabIndex -1. Preview/report regions now have distinct accessible names, keyboard focus and visible focus outlines. The original passage uses the same wrapping preview style as spoken input. Non-form preview captions no longer use unassociated label elements. Pronunciation error text is associated with its aria-invalid field, status messages are atomic, and disabled take/reference actions have visible associated explanations. Personal voice cloning remains explicitly disabled.

## Checks

`npm test`: 227 passed, zero failures/skips. `npm run build`: passed. `git diff --check`: passed. Regression files: `tests/panel-accessibility.test.js`, `tests/panel-review-focus.test.js`, `tests/panel-reference-focus.test.js`.

Automated tests cover markup associations, focus restoration without stealing live focus, the actual review editor's disabled-selector handoff and validation/refresh lifecycle, and reference Cancel with a deferred late metadata read. Existing editor/storage/audio regressions remain in the full suite. These tests use lightweight DOM doubles; they are supplemented by the real browser checks below, not represented as an assistive-technology test.

Native Edge used the current production modules on isolated origin `http://127.0.0.1:4202/.cache/integration-app.html`, with the existing procedural CC0 tone TTS fixture. Original production draft/recordings were untouched. Verified:

- Saved synthetic recording reopened; Enter activates details and panel actions.
- Refresh retains focus on `review-refresh`; repair ends on enabled `take-passage`.
- Tab from the passage selector reaches named original preview `take-source`.
- Invalid pronunciation rule sets aria-invalid and its associated status error.
- Reference Reload retains focus; Save stays disabled with an explanation and personal cloning remains unavailable.
- Long synthetic pronunciation preview has 5,531 px scroll content in a 254 px box; keyboard End/PageDown reached scrollTop 5,276.7 with preview focus retained.
- All four panels open at actual CSS viewport widths 320, 390 and 767. No controls exceeded viewport bounds at narrow sizes; action button rectangles did not overlap at 767. Document widths were 303, 373 and 751 respectively. The browser's existing zoom meant requested viewport dimensions differed from measured CSS widths; reported values are the observed ones. Temporary viewport override was reset.

No screenshot retry was attempted after prior transport timeouts. Screen reader speech output, touch hardware, contrast analysis, every zoom level and full WCAG compliance were not tested or claimed. No browser download completion, model synthesis or acoustic improvement is claimed.
