# Booking Apple-Like Visual Refresh Plan - 2026-06-08

## Goal
- Refresh `/checkouts/new` and `/reservations/new` by making booking creation simpler, lighter, and much less text-heavy while preserving the existing three-step wizard, booking rules, EquipmentPicker contracts, kiosk custody boundary, draft recovery, and multi-event behavior.

## Status
- Implemented through Slice 6, including a 2026-06-10 audit/polish pass (escape-literal copy fixes, COLOR_SYSTEM kind-color alignment, review-panel width alignment, hit-target baseline, event-list skeletons) and the iOS sibling review step in CreateBookingSheet. Authenticated browser smoke remains blocked by login in the in-app browser session.

## Source Checks
- User reference: Apple Support-style appointment review screenshot with centered modal, dimmed prior step, large date/time focus, narrow facts table, and one primary action.
- Apple Genius Bar: reservations are positioned as a simple guided flow, with explicit prep expectations before the appointment and appointment editing/canceling as part of support recovery. Source: https://www.apple.com/retail/geniusbar/
- Apple Delivery and Pickup: pickup promises guided steps via email/notifications and pairs pickup with related setup/help options. Source: https://www.apple.com/shop/shipping-pickup
- Apple Shipping & Pickup help: pickup waits for a ready notification, includes QR/Wallet pass behavior, order number, valid ID, pickup contact, selected time windows, and pickup status tracking. Source: https://www.apple.com/shop/help/shipping_delivery
- Apple order help: status language progresses through order placed, processing, shipping to store, check in today, ready for pickup, and picked up. Source: https://www.apple.com/shop/help/viewing_changing_orders
- Apple store/product pages: shopping pages frame choice through cards, guided shopping, delivery/pickup modules, and one-on-one help, not dense instruction blocks. Sources: https://www.apple.com/shop/buy-iphone and https://images.apple.com/retail/twentyninthstreet/
- `docs/AREA_CHECKOUTS.md`: checkout creation is a shared wizard; Step 1 context/details, Step 2 EquipmentPicker, Step 3 confirmation; checkout creates `PENDING_PICKUP` and kiosk scan starts custody.
- `docs/AREA_RESERVATIONS.md`: reservation creation shares the wizard and holds gear for a later window.
- `docs/BRIEF_MULTI_EVENT_BOOKING_V1.md`: multi-event selection and chronological primary event behavior must stay intact.
- `docs/DECISIONS.md`: D-001 derived status, D-002 unified Booking model, D-003 event-centric checkout, D-006 integrity, D-028 kiosk-only pickup/return, D-031 multi-event junction all constrain this pass.
- `docs/GAPS_AND_RISKS.md`: no new schema or lifecycle gap is needed for this visual refresh.
- `prisma/schema.prisma`: no schema change required.
- `src/app/(app)/checkouts/new/page.tsx` and `src/app/(app)/reservations/new/page.tsx`: both route into the same `BookingWizard`.
- `src/components/booking-wizard/BookingWizard.tsx`: owns the shared step shell, validation, draft banner, submit, footer actions, and checkout/reservation config copy.
- `src/components/booking-wizard/WizardStep1.tsx`: owns event/ad hoc context, event selection, requester/location/kit/window fields, and recovery states.
- `src/components/booking-wizard/WizardStep2.tsx`: owns the flow-level equipment summary before `EquipmentPicker`.
- `src/components/booking-wizard/WizardStep3.tsx`: owns final review and already contains the strongest opportunity to borrow the Apple appointment confirmation modal pattern.
- `src/components/booking-wizard/flow-summary.ts`: already centralizes warning summary copy and should remain the single helper for warning totals.
- `src/components/EquipmentPicker.tsx`: shared picker should not be redesigned deeply in this slice; tune category chips, loading rows, and low-value controls without changing picker selection/search/scan contracts.
- `src/components/ui/`: shadcn primitives already available for `Button`, `Dialog`, `Card`, `Tabs`, `Progress`, `Separator`, `Badge`, `Alert`, `ScrollArea`, `Tooltip`, `Switch`, `Select`, and form controls.
- Prior plans: `tasks/archive/completed-2026-06/booking-create-ux-goal-plan-2026-05-30.md`, `tasks/archive/completed-2026-06/booking-creation-ownership-pass-2026-05-07.md`, and `tasks/archive/completed-2026-06/booking-create-hardening-plan-2026-05-30.md` show the current UX is intentional and recently hardened. This pass should not reopen server or lifecycle scope.

## Apple Flow Takeaways To Translate
- Lead with the chosen outcome, not the form mechanics. Apple review screens make the appointment or pickup moment the star, then place supporting facts underneath.
- Use fewer, higher-confidence surfaces. Apple support review is mostly white space, one icon, one dominant time/place claim, a thin facts table, and one primary button.
- Keep the previous step visible during final review. The dimmed background in the appointment screenshot reinforces "you are reviewing what you just chose" instead of feeling like a new page.
- Treat pickup as a state machine. Apple pickup copy distinguishes order placed, ready notification, QR/pass, ID/order number, reminders, and picked-up state. Wisconsin Creative should mirror that with `pending pickup`, `kiosk scan required`, `custody starts after scan`, and `due back`.
- Make help feel adjacent, not instructional. Apple offers guided shopping/setup/help modules near flows, but does not flood the primary task with explanation.
- Default to plain, centered language. Apple copy avoids operational jargon where a short noun phrase works: "Ready for Pickup", "Check in Today", "Reserve now".

## Content Triage
- Important:
  - What kind of booking this is: checkout now, or reservation for later.
  - Who it is for.
  - Where pickup or hold location is.
  - Start and return window.
  - Event link when it changes the title, window, location, or reporting context.
  - Selected equipment count and any blocking or advisory availability state.
  - Final submit consequence: checkout becomes pending kiosk pickup; reservation holds gear.
  - Recovery controls for real failures: event load failed, kit load failed, form options failed, unavailable selected item, submit conflict.
- Fluff to remove or compress:
  - Paragraphs that explain the same thing as the selected control.
  - Section headings plus helper text plus badges that all repeat the same state.
  - Long instructional warnings before the user has made a risky choice.
  - Decorative status panels that contain no new decision-making information.
  - Repeated "kiosk scan" copy on every step. Say it once in checkout review and use a short pending-pickup label elsewhere.
  - Multiple labels for the same object, such as booking, checkout, pickup, and hold in one small area.
  - General Apple-inspired "guided help" modules. They are nice, but not needed for this problem.
- Defer:
  - True modal final review if an in-page panel can achieve the text reduction faster.
  - QR/Wallet-pass metaphors or pickup-contact concepts. Current product does not support them.
  - Deep EquipmentPicker redesign, while allowing shallow chrome cleanup.
  - New guided-help or setup cards.
  - Dark-mode re-theming beyond keeping the existing theme readable.
  - Animation, illustration, or decorative Apple-like visuals.

## Visual Direction
- Content-first, then styling. The first implementation pass should reduce visible words and repeated states before changing ornamentation.
- Lighter creation surface with fewer bordered containers. Use spacing and separators before adding cards.
- Replace the heavy full-width wizard chrome with a centered product-flow frame:
  - top: compact title and booking-kind selector/status chip
  - middle: the active step surface with quiet spacing
  - bottom: persistent action bar with back/save/next
- Use a slim step indicator closer to Apple checkout/support progress: small dots or segmented labels, not large dark tab buttons.
- Step 1 should make the user choose context quickly, then fill only required details. Event-linked and ad hoc should use short labels and compact consequence previews.
- Step 1 should not use the dense admin/settings row model. Use local stacked labels and grouped fields so the flow reads like guided creation.
- Step 2 should keep the EquipmentPicker powerful but reduce surrounding noise: one selected-count line, warning chips only when warnings exist, and no duplicated explanation.
- Step 2 category tabs should stay as category labels only. Counts belong in the step header and selected shelf, not in the tab rail.
- Step 2 loading should preserve row geometry with skeleton rows, not show a large centered empty-state message.
- Step 3 should become a review confirmation dialog or dialog-like centered review panel inspired by the screenshot:
  - icon at top: calendar for reservation, package/smartphone/checklist for checkout
  - primary claim: date/time or pickup window
  - secondary claim: requester and location
  - narrow fact table: status, event(s), equipment count, notes if present
  - equipment preview below as a concise list, not the visual center
  - one primary CTA: `Create pickup` or `Reserve now`
  - secondary: `Back to equipment`

## Scope
- In scope:
  - Shared visual shell in `BookingWizard`.
  - Route-scoped quieter breadcrumb treatment for booking creation pages.
  - Step indicator and footer rhythm.
  - Step 1 layout, spacing, copy hierarchy, and event/ad hoc choice presentation.
  - Step 2 summary chrome around `EquipmentPicker`.
  - Step 3 Apple-style review presentation.
  - Route-level loading skeletons for checkout/reservation creation.
  - Responsive mobile/desktop behavior.
  - Focus states, keyboard paths, and text overflow checks.
  - Docs sync for checkout/reservation visual behavior after implementation.
- Out of scope:
  - Schema changes.
  - Booking API/service changes.
  - Availability rule changes.
  - Kiosk pickup/return behavior changes.
  - Deep `EquipmentPicker` internals beyond props-compatible visual containment.
  - New notification, QR pass, or Wallet features.

## Proposed Slices
- [x] Slice 1: Text reduction audit and copy map
  - Inventory visible copy in Step 1, Step 2, Step 3, draft banner, error banners, and footer.
  - Mark each string as keep, compress, remove, or show only on error/warning.
  - Keep route wrappers untouched.
- [x] Slice 2: Visual shell and progress rhythm
  - Convert the shared wizard frame to a lighter centered flow surface only after copy has been reduced.
  - Replace large step tab styling with a compact progress treatment.
- [x] Slice 3: Step 1 simplified context and details
  - Reframe event-linked/ad hoc as short selectable options.
  - Keep sport/event multi-select behavior intact.
  - Preserve no-event and event-load-error recovery.
- [x] Slice 4: Step 2 selected-equipment and warning hierarchy
  - Make the selection summary a single quiet status strip.
  - Keep all warning counts from `flow-summary.ts`.
  - Avoid changing picker search, scan, selection, and hydration behavior.
- [x] Slice 4a: EquipmentPicker chrome cleanup
  - Remove category tab counts.
  - Remove select-visible action.
  - Hide Clear section when no selected item exists in the current section.
  - Replace centered loading empty state with row skeletons.
  - Keep search, scan, selection, conflict, selected shelf, and hydration behavior intact.
- [x] Slice 4b: EquipmentPicker flow pass
  - Replace the repeated full-row selected shelf with a compact removal tray.
  - Keep selected rows visually clear without changing the existing checkbox selection contract.
  - Clarify bulk quantity rows without adding another instructional panel.
  - Keep search, available-only, scan, warning, bulk quantity, and hydration contracts intact.
- [x] Slice 5: Step 3 lighter review panel
  - Build a centered review panel first. Use a true modal only if it makes the page simpler.
  - Preserve submit, conflict return-to-Step-2 behavior, draft deletion, and success navigation.
  - Tune checkout vs reservation language without weakening pending-pickup semantics.
- [x] Slice 6: Responsive polish and verification (audit pass 2026-06-10; authenticated browser smoke still blocked — see Verification)
  - Desktop and mobile browser smoke for `/checkouts/new` and `/reservations/new`.
  - Text overflow, focus order, contrast, and no-overlap pass.
  - Update `docs/AREA_CHECKOUTS.md`, `docs/AREA_RESERVATIONS.md`, and this plan review.

## Implementation Notes
- Prefer shadcn/ui primitives already in `src/components/ui/`.
- Do not add new custom primitives for buttons, dialogs, selects, tabs, progress, alerts, or cards.
- Keep `flow-summary.ts` as the warning summary source.
- Keep `BookingWizard` as the state owner; visual subcomponents can be extracted only if they reduce size and keep behavior readable.
- Keep status color semantics from `docs/DESIGN_LANGUAGE.md`: pending pickup and waiting states are orange, not green.
- Keep Step 3 submit copy aligned with current behavior:
  - Checkout: `Create pickup`
  - Reservation: `Reserve now` or keep `Reserve for later` if we want exact continuity.

## Open Questions
- Should this refresh apply in light mode only at first, or should dark mode receive the same Apple-like lightened treatment in this slice?
- Do you want the final review to be a true modal over the dimmed Step 3 background, matching the screenshot, or a centered in-page panel that behaves like a modal visually but keeps the wizard page structure?
- Should `/checkouts/new` and `/reservations/new` stay visually identical except for copy/status, or should checkout lean more pickup/order-like while reservation leans more appointment-like?

## Verification
- [x] Focused tests if helper/component behavior changes: `npx vitest run tests/booking-create-ux.test.ts tests/create-booking.test.ts tests/booking-create-validation.test.ts`
- [x] `npx tsc --noEmit`
- [x] `npm run db:migrate:check`
- [x] `git diff --check`
- [x] `npx next build`
- [ ] `npm run build`
  - Blocked in sandbox by Neon DNS; escalation was rejected because the script runs remote Prisma migration deploy before `next build`.
- [ ] Authenticated browser smoke on `/checkouts/new` desktop and mobile.
  - Blocked in the in-app browser by the login screen. Latest attempt on `http://127.0.0.1:3001/checkouts/new` redirected to `http://127.0.0.1:3001/login`. User-provided screenshots were used for visual iteration, but authenticated browser automation did not complete.
- [ ] Authenticated browser smoke on `/reservations/new` desktop and mobile.
  - Blocked in the in-app browser by the login screen.
- [x] Screenshot review against the Apple reference qualities: spacing, hierarchy, final review focus, no text overlap.

## Stop Conditions
- If a visual change requires new lifecycle semantics, stop and re-plan.
- If authenticated browser smoke is blocked, record the blocker and do not call implementation done.
- If the refresh requires deep `EquipmentPicker` rewrites, split that into a separate picker-specific plan.
- If user direction chooses a broader design-system refresh, split booking creation from the global system pass.

## Review
- Shipped:
  - Shared booking wizard header now uses the selected event/booking title and keeps checkout/reservation in the badge.
  - Step 1 now uses local stacked field groups, softer event selection, and lighter context/details containers instead of the dense admin form-row layout.
  - Step 2, draft banner, footer, and review copy were compressed.
  - EquipmentPicker category tabs are label-only chips, select-visible was removed, empty Clear section is hidden, and loading uses row skeletons.
  - EquipmentPicker selected equipment now collapses into compact removable chips instead of repeating full rows below the picker, with bulk quantities shown inline.
  - Step 3 uses a softer centered Apple-like review panel with primary window, requester/location, status, event, equipment count, concise equipment list, and checkout kiosk notice.
  - Creation-page breadcrumbs now use a route-scoped quiet text treatment instead of the heavier framed breadcrumb chip.
  - Checkout/reservation creation route skeletons now match the refreshed wizard shell.
  - Checkout and reservation area docs plus `tasks/lessons.md` were updated.
- Verified:
  - `npx tsc --noEmit`
  - `npx vitest run tests/booking-create-ux.test.ts tests/create-booking.test.ts tests/booking-create-validation.test.ts`
  - `npm run db:migrate:check`
  - `git diff --check`
  - `npx next build`
- Deferred:
  - True modal final review.
  - QR/Wallet pickup metaphors.
  - Deep picker architecture redesign.
  - New guided-help modules and animation.
  - Authenticated browser smoke until a signed-in in-app browser session is available.
