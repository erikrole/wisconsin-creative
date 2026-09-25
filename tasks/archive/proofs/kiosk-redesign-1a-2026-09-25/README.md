# Kiosk redesign 1a: design tokens (2026-09-25)

- `review.html`: self-contained before/after page with six pairs. Every image carries a hash-bound capture receipt.
- Before is a DEBUG build of `1c628143` (the branch base). After is a DEBUG build of `c7a30a92`.
- Captures were taken with `scripts/kiosk-capture-scenarios.sh` on a dedicated capture simulator: iPad Air 11-inch (M4), iOS 26.5, dark appearance. Both sets come from the same session and the same fixture scenarios, cropped to the 1180×820 pt landscape band.
- All 24 scenarios were captured and inspected on both sides; the page keeps six to limit repository size.
- Fixture captures prove presentation only. They do not prove server behavior, custody, or hardware.
