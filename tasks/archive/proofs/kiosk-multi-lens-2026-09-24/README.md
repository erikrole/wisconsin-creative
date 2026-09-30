# Kiosk multi-lens review proofs (2026-09-24)

- `review.html` — paired before/after review page (open locally; images in `shots/`).
- Before: DEBUG build of `8a09d0ca`. After: DEBUG build of the working tree that became `a327447e` (native) on top of `ae51e219` (server).
- Capture: `scripts/kiosk-capture-scenarios.sh`, iPad Air 11-inch (M4) simulator, iOS 26.5, dark appearance, 8s settle (14s for checkout-details, checkout-details-linked, availability-conflicts before-frames, which loaded slowly), both sets captured back to back on one simulator boot on 2026-09-24 ~21:40 CDT. Landscape band cropped from the portrait letterbox (1640×1140 px = 1180×820 pt), then JPEG q82.
- That boot reported a hardware keyboard, so the kiosk saw a connected scanner in both columns. `*-disconnected-conflicts.jpg` is an earlier pair from the same session with no scanner, same simulator.
- Fixture captures prove presentation only, not server behavior, custody, or hardware.
