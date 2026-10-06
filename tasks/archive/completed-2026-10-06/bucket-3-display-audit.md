# Bucket 3 — Data Display Audit

> **Closed 2026-10-06** in the open-task audit: remaining boxes are stale (work shipped in source or superseded). Evidence is in the audit report; nothing here is open.

**Components:** `table`, `card`, `badge`, `separator`, `skeleton`, `scroll-area`
**Date:** 2026-05-01

---

## What's Smart

- Badge color tokens (`red/green/orange/blue/purple/gray`) are CSS-variable-driven — light/dark theming works for free.
- Card has a real `elevation` system that maps to project shadow tokens (`var(--shadow-sm)`, etc.) instead of Tailwind defaults.
- TableRow includes zebra striping (`even:bg-muted/20`) and selected state (`data-[state=selected]:bg-muted`) by default.
- Skeleton uses a real shimmer animation — better than the static-pulse default.
- TableHeader is sticky + backdrop-blurred — long tables stay readable while scrolling.

## Doesn't Make Sense

1. **Badge `sport` variant has 0 callers.** Dead variant.
2. **Card `prominent` elevation has 0 callers.** Dead variant.
3. **Badge `data-variant={variant}` attribute is not read by any CSS or JS.** Dead attribute (same pattern we removed from Button and SelectTrigger).
4. **Badge size: 72 `size="sm"` vs ~50 default callers.** The "small" variant is the dominant case. Likely the default should be `sm` and a `lg` variant should exist for the headers/big chips. Worth questioning, not fixing in this PR.
5. **TableRow zebra striping is baked in** — not all tables want striped rows (small tables, tables inside cards). Today only override is `className="even:bg-transparent"` which is awkward.

## Can Be Simplified

- Drop dead `sport` Badge variant + dead `prominent` Card elevation + dead `data-variant` attribute.
- Skeleton's `after:` shimmer mask is well-tuned — no simplification needed.
- Separator is already minimal.

## Can Be Rethought (parked)

- **Reconsider Badge default size**: 72 small vs ~50 default suggests the design language has shifted small. Audit + flip default to `sm`, add `lg` for the rare bigger badges.
- **TableRow zebra striping**: make opt-in via `striped` prop, not baked in.
- **TableHeader sticky**: similarly opinionated — make a `sticky` prop default-true so callers can opt out.
- **ScrollArea is used in only 2 files** — confirm it's worth keeping or migrate to native scroll.

## Dead Code

- Badge `sport` variant (line 25)
- Card `prominent` elevation (line 14)
- Badge `data-variant` attribute (line 52)

## Polish Checklist (this PR)

- [ ] Drop Badge `sport` variant
- [ ] Drop Card `prominent` elevation
- [ ] Drop Badge `data-variant` attribute

## Bigger Bets (follow-up)

- Flip Badge default size to `sm`, add `lg`
- TableRow `striped` opt-in prop
- TableHeader `sticky` opt-in prop
- ScrollArea: keep + document or remove
