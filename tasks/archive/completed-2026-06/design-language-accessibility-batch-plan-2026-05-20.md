# Design Language Accessibility Batch Plan

Last updated: 2026-05-20

## Goal
Remove the next high-impact accessibility and control-size drift found during protected-route browser smoke.

## Slices
- [x] Slice 18: Add programmatic `name` attributes to the login form fields so protected-route smoke does not surface browser form-field issues.
- [x] Slice 19: Clean up event crew controls so assignment, request, approval, decline, and remove actions use visible, keyboard-friendly 40px targets where they appear in operational rows.
- [x] Slice 20: Align item detail header utility and action controls to the same 40px target baseline.

## Verification
- [x] Run `npx tsc --noEmit`.
- [x] Run `npm run db:migrate:check`.
- [x] Run `git diff --check`.
- [x] Run `npx next build`.
- [x] Browser-smoke `/login`, `/items/test-item-id`, and `/events/test-event-id` for clean redirects/console health.

## Review
- TypeScript, migration-prefix, whitespace, and production build verification passed.
- Browser smoke on the correct Wisconsin Creative dev server (`localhost:3011`) showed `/login` with no console errors, then protected `/items/test-item-id` and `/events/test-event-id` redirected cleanly to login with no console errors.
