# Account-backed onboarding continuity

Owner: this chat. Target: Monday, October 26, 2026.

## Source and scope

- Isolated branch `codex/onboarding-continuity`, starting at onboarding PR #584 head `69f30b657910d9b52cff6441d9b6c150e8990771`.
- Preserve the original dirty checkout. Reconcile this chat's required-setup, recovery and apparel work into the newer onboarding flow, retaining the accepted refreshed native design and optional graduation behavior.
- New internal users must complete all required steps. Photo remains optional. Only Men’s/Women’s are offered for new apparel answers; saved legacy values remain supported.
- User correction: no sliders in photo cropping. Use native/direct photo gestures on both clients. The official Mobbin MCP is connected and authenticated; the read-only reference review informed the circular guide, dimmed surrounding image, short guidance and quiet Reset action.

## Plan

1. Reconcile existing owned changes, schema and native target membership without unrelated dirty work.
2. Add validated field-group saves with optimistic concurrency against current server values, idempotent retry reconciliation, and a persisted finish decision. Existing complete-step clients remain compatible.
3. Wire web/native autosave, honest save states, pending-save retries, foreground refresh and dirty-field reconciliation. Derive the resume step from server completion.
4. Share Getting started progress across both clients, including retries, account isolation and safe concurrent merges.
5. Test web-to-iOS and iOS-to-web against shared persisted state, plus lost responses, interrupted saves, stale edits, skipped photo, session changes, and network loss. Run web/native/build/schema gates and matched UI evidence.
6. Record actual acceptance and hosted/authenticated boundaries. The user authorized scoped commit, push and a draft PR, both handoffs and the physical photo check. Production merge/deployment and App Store submission remain separate from the prepared release candidate.

## Save contract

- Save valid answers as entered; a partial or invalid field never marks a required step complete.
- Group dependent fields (Wiscard parts, shoe system/size, work-phone applicability) atomically.
- Compare each changed group's expected fingerprint to the current database values; do not use unrelated account activity timestamps as edit versions.
- A retry whose requested values are already present succeeds without another mutation/audit.
- `FINISH` is allowed only after required data is complete; it persists completion even with no photo and prevents Welcome being shown again on another device.
- Keep typed private values out of unencrypted persistent browser/device caches. Offline pending input must be shown as unsaved until acknowledged by the server.

## Acceptance

Implemented locally; authenticated handoff and release remain open. Fixture/source proof, authenticated shared-backend handoff, installed/physical-device behavior and production rollout are distinct gates.

- Web: validated group autosave, preserved unsaved input, explicit conflict recovery, read ordering, optional-photo FINISH and account-scoped checklist retries. Settings, onboarding and roster share photo cropping/upload/removal and account-avatar cache refresh.
- iOS: account save versions, durable FINISH, foreground resume, field-owned selections, shared checklist progress, native Profile photo editing and honest error/retry states.
- Photos: owner-scoped receipt reads, frozen account/photo versions, idempotent upload IDs, decoded-image limits, orientation/metadata normalization, transactional audit/pointer replacement and delayed old-blob deletion. Crop preview/export alignment receives distinctive off-center pixel checks.
- Verification: schema validation and migration-prefix checks; focused service/API/image tests; 8 disposable-PostgreSQL integration cases; 7 Chromium component cases; 780 Swift source-contract tests in 148 files; 10 native model/image XCTest cases and 2 iPhone 18 Pro Max UI scenarios; TypeScript, lint (0 errors; pre-existing warnings), app build and native target build. Exact logs and visual evidence live in [the local proof folder](archive/proofs/onboarding-continuity-2026-10-22/).
- Review: [current UI evidence](archive/proofs/onboarding-continuity-2026-10-22/review.html). After-only fixture evidence; no trustworthy matched pre-change baseline. Earlier slider captures in the folder are superseded and excluded from this review.
- Review rendering boundary: Codex queued the local review file, but browser rendering was blocked by its HTTP/HTTPS-only URL policy. The generated self-contained HTML and every selected source image were inspected directly. No alternate browser or protocol workaround was attempted.

## Mobbin references

- [WHOOP iOS photo sheet](https://mobbin.com/screens/614c5819-58b6-43b6-9ea8-c8b369c9edbb): circular preview, brief move/zoom guidance, Cancel/Upload, no visible sliders.
- [Me+ profile-picture flow](https://mobbin.com/flows/1c3a4690-2263-4ba4-8d90-d37724e561b4) and [Tripadvisor iOS crop](https://mobbin.com/screens/43884732-6fd2-438e-a5eb-a609674daa09): photo remains visible around a circular guide with dimming, Save/Done, no visible sliders.
- [hilos web crop](https://mobbin.com/screens/f07f7049-7109-4493-ac42-f850cf620ca9) explicitly describes drag, scroll and pinch. Its visible slider was not adopted. These stills establish layout/copy, not live gesture behavior; the local tests exercise our gestures.

## Remaining acceptance and rollout

- [x] Commit and push the scoped work and open [draft PR #606](https://github.com/erikrole/wisconsin-creative/pull/606).
- [ ] Obtain this branch’s hosted Managed preview. Required CI passed at `c1176ab530414ca3a01a070ae8b99de17f283320`; its preview workflow is queued. D-063 prohibits borrowing another branch’s environment or production credentials.
- [ ] Seed one student in that sanitized preview, authenticate web and native to that same backend, verify web→iOS and iOS→web continuation, concurrent edits, relaunch, lost-response recovery, and photo-free completion. Local fixture/API tests do not substitute for these handoffs.
- [ ] Verify real PhotosPicker/photo-library behavior on the user-selected physical iPhone 18 Pro Max, including permission/selection recovery and the chosen photo appearing on both clients. The separate Creative Preview app is signed and installed. Gesture/retry proof and successful shared-backend upload are recorded separately below.
- [ ] Apply migration `0200` and ship/distribute the verified server/native slice only with explicit release authorization. Existing accounts remain outside the new required gate.

No production mutation, merge, deployment, external email or App Store distribution has occurred in this task.

## Authorized shipping follow-up

2026-10-22: The user authorized scoped commit, push and a draft PR, authenticated handoff tests both ways, and a physical iPhone photo upload check, with the intent to release an app update today. They selected and connected the physical iPhone 18 Pro Max (`00008160-000A7C610C100036`) and allowed the device automation prompt. No merge or production release has occurred.

Draft PR: [#606](https://github.com/erikrole/wisconsin-creative/pull/606). Source commit `b706b774`; first main integration `978d1f63`. Full suite after obsolete source-check reconciliation: 6,326 passing tests, one existing skip. Replaced slider/call-shape checks with the actual browser gesture cases, QueryClient avatar-consumer behavior and retained route audit-failure/old-blob coverage. Native managed-preview origin and exact-origin token checks pass in XCTest. The user explicitly selected the physical iPhone 18 Pro Max (`00008160-000A7C610C100036`), now paired and available; actual photo upload is pending the branch preview.

Current integration `c1176ab5` passes required CI and 6,390 local tests (one existing skip). A signed Release archive and local IPA for 1.4/build 35 were prepared and the App Store publish plan was dry-run only. That candidate is superseded by the physical crop fix below and must be rebuilt before upload.

Physical testing found a real crop feedback problem: pinching to 150%, then dragging and retrying an unconfirmed save, left 116% zoom. UIKit gesture updates were being echoed through stale SwiftUI bindings. Explicit Reset/VoiceOver command revisions now drive UIKit while gestures remain authoritative, with deferred-layout/clamp guards and a frozen export adjustment that stops motion during Save. The strengthened test isolates drag from Save and compares the exact crop preview pixels before/after failure. The revision fix passed on the physical phone; the final export-freeze/Reset refinement passed on the required iPhone 18 Pro Max simulator and the physical iPhone. Real PhotosPicker sample selection, decoded color verification and crop cancellation also pass; the private driver uses add-only permission and added a marked technical sample to the library. All 781 native source-contract tests pass. This is fixture-based physical gesture/recovery proof, not a successful server upload.

Fixture-free live web/native drivers are prepared privately in `.tmp/` and the isolated native project. They use this branch’s attested managed origin, short-lived exact-origin OIDC access and synthetic invited students, never production credentials. Successful authenticated handoffs and the 512px normalized photo read-back remain open until the hosted preview is Ready.
