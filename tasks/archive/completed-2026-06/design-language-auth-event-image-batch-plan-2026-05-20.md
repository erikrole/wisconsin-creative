# Design Language Auth, Event, And Image Batch Plan

Last updated: 2026-05-20

## Goal
Continue reducing route-level accessibility drift without changing product workflow shape.

## Peer Patterns Checked
- `/login`: auth form fields use stable `name` attributes with labels, ids, autocomplete, and form-level errors.
- `/events/[id]` crew table: assignment and request controls use visible 40px shadcn buttons.
- `/items/[id]` detail header: secondary actions, refresh, and favorite controls use the 40px target baseline.

## Slices
- [x] Slice 21: Add stable `name` attributes to remaining auth forms: register, forgot-password, reset-password, and forced password change.
- [x] Slice 22: Align event missing-gear Nudge and Create checkout controls with the 40px operational action baseline and clearer row wrapping.
- [x] Slice 23: Make item detail image edit/add affordances keyboard-visible with focus states, not hover-only.

## Verification
- [x] Run `npx tsc --noEmit`.
- [x] Run `npm run db:migrate:check`.
- [x] Run `git diff --check`.
- [x] Run `npx next build`.
- [x] Browser-smoke auth routes and protected item/event redirects for clean console health.

## Review
- TypeScript, migration-prefix, whitespace, and production build verification passed.
- Browser smoke on the correct Wisconsin Creative dev server (`localhost:3012`) showed `/register`, `/forgot-password`, and `/reset-password?token=demo-token` with named inputs and no console errors. Protected `/change-password`, `/items/test-item-id`, and `/events/test-event-id` redirected cleanly to login with no console errors.
