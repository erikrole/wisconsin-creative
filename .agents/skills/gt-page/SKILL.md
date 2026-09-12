---
name: gt-page
description: "Implement or improve a Wisconsin Creative web route, workflow, or focused UI detail using its existing product patterns."
---

# GT Page

Own the requested web outcome. Use `AGENTS.md` for shared rules and verification. Inspect the route and direct consumers, its owner area/brief, and relevant design-language sections; read files fully before editing.

## Choose scope

- **Focused fix/polish:** preserve the route's purpose and behavior. Reuse its current components/tokens; compare a relevant peer only when the pattern is unclear. Do not turn spacing/copy work into a full page audit.
- **Workflow/page pass:** map the role-specific action, data owner, lifecycle, failure recovery, and directly affected siblings. Use a bounded plan and existing owner ledger when substantial.

## Implement

Prioritize trustworthy status/actions, useful hierarchy, recovery, accessibility, then visual finish. Reuse installed shadcn primitives and operational components (`PageHeader`, toolbar, status rail, feedback, `EmptyState`) when they own the behavior. Preserve semantic status colors, visible focus, product hit-target standards, and restrained functional motion.

Check loading, empty versus filtered-empty, failure, stale data, pending actions, success, and expired-session paths relevant to the change. Preserve form state and reconcile uncertain mutation responses. Trace API envelopes, permissions, and concurrency when the behavior depends on them; use `gt-api-hardening` only for a distinct hardening requirement.

For polish details read [references/polish.md](references/polish.md). Shared changes require an explicit consumer/propagation scope. Fix only evidenced problems within the request.

## Verify and close

Run the affected `AGENTS.md` gates. Capture a trustworthy baseline before editing when possible and use `gt-ui-review` for the required local review page. Authenticated browser checks cover the changed action, console/network, keyboard/focus, and relevant desktop/tablet width; phone-width web is smoke coverage when the actual phone workflow is native.

Inspect the guard in `scripts/guard-next-build.mjs` before a build; coordinate stopping the relevant dev server rather than killing shared processes. Use the existing authenticated preview path when needed; do not print credentials.

Report the outcome, changed scope, actual proof and blockers. Reconcile owner documentation with `area-doc-sync` only when affected. Do not call local source work shipped to production.
