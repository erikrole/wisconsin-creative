# Bucket 5 — Navigation Audit

> **Closed 2026-10-06** in the open-task audit: remaining boxes are stale (work shipped in source or superseded). Evidence is in the audit report; nothing here is open.

**Components:** `tabs`, `breadcrumb`, `pagination`, `command`
**Date:** 2026-05-01

---

## What's Smart

- TabsList uses an underline style (`border-b` + `border-b-2 -mb-px` on active triggers) instead of pill-buttons — consistent with the design language.
- Pagination reuses `buttonVariants` for links — no parallel button styles.
- CommandDialog composes Dialog rather than reimplementing the modal — reuse done right.
- BreadcrumbPage uses `aria-current="page"` + `role="link"` correctly for the disabled current-page state.
- BreadcrumbSeparator defaults to ChevronRight via `children ?? <ChevronRight />` — simple, overridable.

## Doesn't Make Sense

1. **TabsTrigger uses the old focus pattern.**
   - Tabs: `focus-visible:outline-2 focus-visible:outline-ring/70`
   - Everything else: `focus-visible:ring-[3px] focus-visible:ring-ring/50`

   Tab focus rings look noticeably different (CSS `outline` not `ring`, and the color is `/70` not `/50`).

## Can Be Simplified

- (none significant)

## Can Be Rethought (parked)

- **Breadcrumb has 1 caller** (global app-shell breadcrumb). Fine — it's a singleton in the layout.
- **Pagination has 2 callers**. Fine — limited to paginated list views.
- **Command has 6 callers** — global cmd palette + a few inline searchable lists. Healthy.
- **Pagination's `data-active` attribute** is technically unread by CSS/JS but pairs with `aria-current="page"` which carries the semantic. Keep — provides a useful targetable hook.

## Dead Code

- None outright dead in this bucket.

## Polish Checklist (this PR)

- [ ] TabsTrigger focus pattern → `focus-visible:ring-[3px] focus-visible:ring-ring/50` (match the rest)

## Bigger Bets (follow-up)

- (none from this bucket)
