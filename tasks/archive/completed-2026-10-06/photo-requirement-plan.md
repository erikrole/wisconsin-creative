# Photo Requirement for Checkout/Checkin

> **Closed 2026-10-06** in the open-task audit: remaining boxes are stale (work shipped in source or superseded). Evidence is in the audit report; nothing here is open.

## Context
Gear checkout/checkin currently has no accountability mechanism to document equipment condition. Staff can check items in/out without evidence, and items can be returned via manual checkbox selection without scanning — bypassing verification.

## Requirements (confirmed with user)
1. **One photo per booking** at checkout and checkin (gear laid out together)
2. **Camera-only capture** (no gallery/file upload — ensures accountability)
3. **Scan-only checkin** — remove manual checkbox return flow entirely
4. Photo stored in Vercel Blob, linked to booking + phase

## Slices
- [x] Slice 1: Schema + Migration (BookingPhoto model)
- [x] Slice 2: Blob helper + API route for photo upload
- [x] Slice 3: Photo capture component (camera-only)
- [x] Slice 4: Wire photo into scan completion flow
- [x] Slice 5: Remove manual checkin flow
- [x] Slice 6: Display photos in booking detail
- [ ] Slice 7: Docs + build verification
