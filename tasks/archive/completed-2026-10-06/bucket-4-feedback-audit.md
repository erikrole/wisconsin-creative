# Bucket 4 — Feedback Audit

> **Closed 2026-10-06** in the open-task audit: remaining boxes are stale (work shipped in source or superseded). Evidence is in the audit report; nothing here is open.

**Components:** `alert`, `alert-dialog`, `sonner`, `progress`, `empty`, `item`
**Date:** 2026-05-01

(`alert-dialog` was covered in Bucket 2 — overlay concerns. This bucket is about the inline feedback layer.)

---

## What's Smart

- **Sonner** is the canonical feedback channel — 403 `toast.*` call sites confirm it. Color tokens are CSS-variable-driven, light/dark theming works.
- Sonner's `!border-l-[3px]` colored left-edge per variant is recognizable without being garish.
- Empty has a structured slot system (Empty / EmptyHeader / EmptyTitle / EmptyDescription / EmptyContent / EmptyMedia) — easy to compose consistent empty states.
- Progress uses `transform: translateX` for hardware-accelerated indicator motion (not width animation).

## Doesn't Make Sense

1. **Alert `success`, `warning`, `info` variants have 0 callers.** Only `destructive` is used (23×) plus 2 implicit defaults. The reason is structural: feedback flows through Sonner toasts, not inline alerts. The 3 unused variants are dead.
2. **EmptyMedia `data-variant={variant}` attribute is unread.** Same dead-attribute pattern as Button/Badge/SelectTrigger.
3. **`item.tsx` (193 lines) is used in only 1 file** (`notifications/page.tsx`). Either keep + document the use case or delete. Borderline — flag, don't act.

## Can Be Simplified

- Drop the 3 unused Alert variants — if needed later, re-add intentionally.

## Can Be Rethought (parked)

- **Inline alerts are essentially a destructive-only pattern** today. If we want page-level non-error notices (banners), we should design that pattern explicitly rather than leaving stub variants.
- **Item primitive trajectory**: 1 caller after how long? Either expand its use or delete.

## Dead Code

- Alert `success`, `warning`, `info` variants
- EmptyMedia `data-variant` attribute

## Polish Checklist (this PR)

- [ ] Drop Alert `success`/`warning`/`info` variants
- [ ] Drop EmptyMedia `data-variant` attribute

## Bigger Bets (follow-up)

- Decide Item primitive fate
- If we want inline page banners, design that pattern (icon + dismiss + variant) and reintroduce
