# Schedule list scrolling — September 7, 2026

Scope: preserve compact event rows and avatar groupings; harden the web List's existing Today, history/reload and filter-transition scrolling. No native, API, assignment or schema changes in this slice.

Verified source contracts: reader input owns scrolling; an untouched fresh visit anchors to Today; asynchronous history restores wait for list height; filter/view transitions use surviving event/day anchors. Existing unrelated changes are retained.

- [x] Reproduce late Today jump after wheel input while event data is delayed in authenticated isolated local preview.
- [x] Reader input cancels pending pixel restoration and the initial Today anchor.
- [x] Cancel queued scroll writes on unmount; modified/new-tab links do not freeze persistence.
- [x] Preserve date-group identity when records prepend; tolerate unavailable storage; respect reduced motion on explicit Today navigation.
- [x] Focused timeline tests, TypeScript and scoped lint.
- [x] Authenticated isolated replay passes: delayed load, interrupted restore, reduced motion, modified click, reload, Back, crew expansion/collapse and tablet overflow.
- [x] `npm run build:app`, docs verification and final diff check pass. Local after-only review is `tasks/archive/proofs/schedule-scroll-2026-09-07/review.html`.

Baseline and after captures use the same local account, viewport and delayed-response scenario, but are not a frozen data/clock image comparison. Review uses after-only evidence and measured interaction logs. No live assignment mutations, notifications, deployment, commit or push.
