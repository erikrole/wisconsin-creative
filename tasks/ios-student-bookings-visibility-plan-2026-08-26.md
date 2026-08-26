# Student Bookings Visibility Plan — 2026-08-26

## Goal

Make the Bookings tab team-visible for internal Students on web and native iOS, matching the accepted broad-read contract and the existing staff/admin list behavior. Students should be able to see every visible user's checkout and reservation rows, open their details, and search/filter the shared list.

## Accepted contracts

- D-011 and D-058 already establish that Students may read all visible reservations and check-outs and that normal internal Student dashboard reads are team-visible.
- Native iOS Home remains personal through `scope=ios-home`; this slice changes the Bookings tab only.
- Student mutations remain own-only. Server-owned `allowedActions`, optimistic locking, reservation ownership, kiosk-only checkout custody, scan status, and collaborator capability/privacy boundaries remain unchanged.
- The Admin-owned native Student role preview is read-only and uses the same server session; when previewing, it should show the same shared booking read surface without granting any mutation.

## Bounded slices

- [x] Inspect the combined, checkout, reservation, detail, change-signal, native Bookings, and action-policy paths plus current role contracts.
- [x] Remove Student-only requester scoping from booking list and detail reads while retaining private collaborator scoping.
- [x] Default native Student Bookings to All while keeping the Mine toggle and own-only row actions.
- [x] Add focused API/native source contracts for shared Student rows, detail access, change refresh, and mutation boundaries.
- [x] Capture a matched native Bookings before/after review and run web/native/docs verification.

## Verification gates

- Focused route tests for combined, checkout, reservation, detail, and booking-change reads.
- Native source contracts for the default scope and ownership-gated actions.
- `npx tsc --noEmit --pretty false`, focused ESLint, `npm run build:app`, `git diff --check`, and `npm run verify:docs`.
- `xcodebuild` for `Wisconsin` on the required iPhone 16 Pro / iOS 26.5 Simulator destination.
- Matched native UI captures with the changed row population measured separately from server/API proof.
- No deployment, production data change, or physical-device acceptance is part of this slice.

## Review boundary

This slice broadens authenticated internal Student booking reads only. It does not broaden collaborators, hidden roster access, audit-log access, scan-status reads, creation, editing, transfer, cancellation, extension, direct checkout, check-in, reservation pickup, or any other custody/mutation path.

## Review

- Implemented locally on 2026-08-26. The web combined, checkout, reservation, detail, and change-signal reads are team-visible for internal Students; native Student Bookings defaults to All and keeps Mine as an explicit filter.
- Focused route/native/source coverage: 76 tests passed. Scoped ESLint, TypeScript, app build, docs verification, iOS project registration, and the required Wisconsin iPhone 16 Pro / iOS 26.5 build passed.
- Matched UI review: `tasks/ios-student-bookings-visibility-review-2026-08-26/review.html`. Captures show Active 1 → 3 using the same fixture and simulator clock; the successful baseline rerun used the committed Student Mine default.
- Deployment, authenticated web acceptance, and physical iPhone installation/acceptance remain open. No database or production data was changed.
