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

Implemented and verified through authenticated shared-backend handoff, physical-device photo upload and the final hosted Continue regression at `09561456e`. Production rollout remains open. Fixture/source proof, authenticated handoff, physical-device behavior and production rollout are distinct gates.

- Web: validated group autosave, preserved unsaved input, explicit conflict recovery, read ordering, optional-photo FINISH and account-scoped checklist retries. Settings, onboarding and roster share photo cropping/upload/removal and account-avatar cache refresh.
- iOS: account save versions, durable FINISH, foreground resume, field-owned selections, shared checklist progress, native Profile photo editing and honest error/retry states.
- Photos: owner-scoped receipt reads, frozen account/photo versions, idempotent upload IDs, decoded-image limits, orientation/metadata normalization, transactional audit/pointer replacement and delayed old-blob deletion. Crop preview/export alignment receives distinctive off-center pixel checks.
- Verification: 6,571 source/service tests (one existing skip), 7 Chromium component cases, 273 native unit cases and 5 combined simulator UI cases pass. Schema/migration prefixes, project parity, docs, TypeScript, lint (zero errors, 55 existing warnings), app build and both native target builds pass. Actual web↔physical-iPhone handoff, photo-free completion/relaunch, conflict/lost-response/offline recovery and physical photo upload with web read-back pass. Exact source revisions and boundaries are recorded below.
- Review: [current UI evidence](archive/proofs/onboarding-continuity-2026-10-22/review.html). After-only authenticated and fixture evidence are labeled separately; no trustworthy matched pre-change baseline. Earlier slider captures in the folder are superseded and excluded from this review.
- Review rendering boundary: Codex queued the local review file, but browser rendering was blocked by its HTTP/HTTPS-only URL policy. The generated self-contained HTML and every selected source image were inspected directly. No alternate browser or protocol workaround was attempted.

## Mobbin references

- [WHOOP iOS photo sheet](https://mobbin.com/screens/614c5819-58b6-43b6-9ea8-c8b369c9edbb): circular preview, brief move/zoom guidance, Cancel/Upload, no visible sliders.
- [Me+ profile-picture flow](https://mobbin.com/flows/1c3a4690-2263-4ba4-8d90-d37724e561b4) and [Tripadvisor iOS crop](https://mobbin.com/screens/43884732-6fd2-438e-a5eb-a609674daa09): photo remains visible around a circular guide with dimming, Save/Done, no visible sliders.
- [hilos web crop](https://mobbin.com/screens/f07f7049-7109-4493-ac42-f850cf620ca9) explicitly describes drag, scroll and pinch. Its visible slider was not adopted. These stills establish layout/copy, not live gesture behavior; the local tests exercise our gestures.

## Remaining acceptance and rollout

- [x] Commit and push the scoped work and open [draft PR #606](https://github.com/erikrole/wisconsin-creative/pull/606).
- [x] Obtain this branch’s hosted Managed preview after required CI passes. Final source `09561456e` passes CI 39843245683 and Managed previews 39844352154; deployment `dpl_CgYFMPPg8zzPhQszCdqwcGxucTfW` is Ready on `br-icy-rain-au18ehyu`. D-063 ownership is preserved.
- [x] Seed synthetic invited students in the owned sanitized preview, authenticate web and physical native to the same backend, and verify both handoffs, concurrent edits, relaunch, lost-response recovery and photo-free completion.
- [x] Verify real PhotosPicker/photo-library behavior on the user-selected physical iPhone 18 Pro Max, including selection/cancellation, crop recovery, actual Save and the chosen technical image appearing on both clients. The separate Creative Preview app preserves the installed production app.
- [ ] Apply migration `0200` and ship/distribute the verified server/native slice only with explicit release authorization. Existing accounts remain outside the new required gate.

No production mutation, merge, deployment, external email or App Store distribution has occurred in this task.

## Authorized shipping follow-up

2026-10-22: The user authorized scoped commit, push and a draft PR, authenticated handoff tests both ways, and a physical iPhone photo upload check, with the intent to release an app update today. They selected and connected the physical iPhone 18 Pro Max (`00008160-000A7C610C100036`) and allowed the device automation prompt. No merge or production release has occurred.

Draft PR: [#606](https://github.com/erikrole/wisconsin-creative/pull/606). Source commit `b706b774`; first main integration `978d1f63`. Full suite after obsolete source-check reconciliation: 6,326 passing tests, one existing skip. Replaced slider/call-shape checks with the actual browser gesture cases, QueryClient avatar-consumer behavior and retained route audit-failure/old-blob coverage. Native managed-preview origin and exact-origin token checks pass in XCTest. The user explicitly selected the physical iPhone 18 Pro Max (`00008160-000A7C610C100036`), now paired and available; actual photo upload is pending the branch preview.

Current integration `c1176ab5` passes required CI and 6,390 local tests (one existing skip). A signed Release archive and local IPA for 1.4/build 35 were prepared and the App Store publish plan was dry-run only. That candidate is superseded by the physical crop fix below and must be rebuilt before upload.

Physical testing found a real crop feedback problem: pinching to 150%, then dragging and retrying an unconfirmed save, left 116% zoom. UIKit gesture updates were being echoed through stale SwiftUI bindings. Explicit Reset/VoiceOver command revisions now drive UIKit while gestures remain authoritative, with deferred-layout/clamp guards and a frozen export adjustment that stops motion during Save. The strengthened test isolates drag from Save and compares the exact crop preview pixels before/after failure. The revision fix passed on the physical phone; the final export-freeze/Reset refinement passed on the required iPhone 18 Pro Max simulator and the physical iPhone. Real PhotosPicker sample selection, decoded color verification and crop cancellation also pass; the private driver uses add-only permission and added a marked technical sample to the library. All 781 native source-contract tests pass. This is fixture-based physical gesture/recovery proof, not a successful server upload.

Fixture-free live web/native drivers are prepared privately in `.tmp/` and the isolated native project. They use this branch’s attested managed origin, short-lived exact-origin OIDC access and synthetic invited students, never production credentials. Successful authenticated handoffs and the 512px normalized photo read-back remain open until the hosted preview is Ready.

The user explicitly authorized deletion of retired Photo Frame PR #478’s preview `br-spring-glitter-auiu9jxm`. Read-only inspection confirmed no file stores, deployments or handoff, no pin or cleanup claim, and no activity since October 15. Its legacy missing resource table blocked normal cleanup. Only that approved database branch was deleted; read-back confirmed its absence and eight preview children remained. No other preview was borrowed or deleted.

Integrated current main `21961d9cf` at `3ed83a57`. The resulting suite passes 6,553 tests in 868 files (one existing skip). Its CI audit exposed newly listed Next.js advisories; the available, cooldown-compliant 15.5.28 patch and matching ESLint config now pass the audit, TypeScript, app build and lint (zero errors, 55 existing warnings). Main also introduced two same-named native report sheets; the private item-only sheet and its sole caller now use `ItemProblemReportSheet`. The signed physical `WisconsinPerformance` test build passes after that integration fix. Earlier 1.4/build 35 archives are superseded by this main integration and must be rebuilt before upload.


## Combined native release candidate

2026-10-22: The user requested that Claude’s work ship in this candidate too. Integrated PR #605 at `4243505f3` (including the #599 UI sweep, #604 Home, and the reviewed #601 API split), PR #610 at `68bab13fa` (Accountability), and the remaining #601 logging/opt-in build delta at `b0008063b`. Retained the newer legacy-cache cleanup and current required setup, avatar receipts, diagnostics, damage reporting, and account boundaries. Version is 1.4/build 36 because App Store Connect already has an unfinished build 35 upload record. Earlier archives are superseded.

The integration exposed a frozen Wrapped identity gap: legacy Top crewmate summary rows had names without account IDs. Fresh summaries now include IDs; frozen summaries remove inaccessible identities and unsafe legacy rows while retaining aggregate statistics. Focused backend and migration tests pass. The duplicate Wrapped migration from #605 was byte-identical to main’s canonical migration and was removed; two already-applied `0200` migration names retain their exact history with a narrowly scoped prefix exception. Full combined verification is pending.

The branch-owned Managed preview is Ready at source `5bd05fff4` after CI and Managed run 39826454957 attempt 2 passed. The user approved early retirement of PR #533’s preview; its database, four file stores, inactive deployment and encrypted handoff were deleted and absence verified. No other branch’s preview was borrowed. Normal web sign-in exposed a blank retained app layout; account-boundary navigation now reloads the authenticated server layout and passed the local browser check. This fix still needs the next hosted deployment and full live handoff proof.

Combined source verification: 6,567 Vitest cases pass (one existing skip); TypeScript, app build, migration prefixes, project parity and docs checks pass. Lint has zero errors and 55 existing warnings. Native iPhone 18 Pro Max tests pass: 162 XCTest cases and 111 Swift Testing cases. Both the primary app and isolated physical UI test runner compile, and WisconsinKiosk compiles for a generic simulator destination; the required iPadOS 26.5 runtime is unavailable, so no kiosk runtime claim is made. Two independent read-only reviews found no remaining defects in the native integration or Wrapped privacy/migration/required-setup contracts.


## Authenticated handoff and physical upload

At `84586e71f`, required CI 39834816434 and Managed previews 39835882763 passed. The owned deployment `dpl_4CajpSPWg7DoouQgzcxbtL1X68py` attests the same SHA and `br-icy-rain-au18ehyu`. Wrappers setup, doctor, local development and local authentication pass. Synthetic invited students were created without email.

- Physical web→iPhone: resumed a partially saved Wiscard, confirmed the phone number, saved student/apparel choices, finished without a photo, and relaunched without returning to Welcome.
- Physical iPhone→web: saved phone/Wiscard/year, terminated at Apparel, and confirmed those persisted answers in a real web sign-in. Web completed apparel and Finish; native reopened in the app rather than Welcome.
- Physical PhotosPicker: added only a marked technical sample through add-only permission, selected/decoded it, pinched/panned and saved. The test waits for the crop to dismiss and confirms Change photo. Web fetched the actual public object without preview access headers, checked 512×512 WebP and both technical-image colors, and rendered the profile photo. No personal photo grid is in the selected proof.
- Live web recovery: a committed save with a deliberately lost response reconciled; independent groups both persisted, both explicit conflict choices worked, and an offline answer remained visibly unsaved until reconnect. A diagnostic retry initially reused another synthetic account’s unique Wiscard; the UI correctly retained the input and showed its uniqueness error. Fresh unique test cards resolved that test-data collision.
- One real UX bug remained: Continue during the final autosave could return before a queued newer edit finished. The shared flush promise now includes follow-up save passes. The expanded existing browser test fails on the old hook and all seven browser cases pass after the fix. Final hosted confirmation is pending the next candidate.

Main advanced to `c00acc4d6` with a backend service extraction while acceptance ran. Reconcile it without changing native source; retain both source-helper migrations. Native 1.4/build 36 at `84586e71f` is signed/exported and passes deep strict signature verification and App Store publish dry run. Xcode’s export validation created an `AWAITING_UPLOAD` record (exact ID verified in its ContentDelivery log); no IPA bytes were uploaded and no version was submitted or distributed.


## Final deployment memory repair

Candidate `61112d3db` passes required CI 39840163903 and authenticated local real-backend verification of the held-response Continue regression, preserved handoff answers, photo-free Finish and physical avatar read-back. Its Managed run 39841403544 failed at `dpl_7g6biuBTBCD1gfXcpHimarSAFmWX`: Vercel explicitly reported an out-of-memory event and killed the webpack build worker with SIGKILL during optimized compilation. No migration or runtime error was reported.

Current Sentry source confirms that its default webpack integration generates server/client source maps even without an upload token; `silent` suppresses logs and does not disable generation. Managed previews deliberately clear `SENTRY_AUTH_TOKEN`. Configure `sourcemaps.disable` only when that token is absent, preserving configured release uploads and runtime instrumentation. Verify the compile and actual hosted redeployment before declaring the memory failure resolved.

The tokenless app build completed with the same 5 GiB Node heap limit as Managed previews, and emitted no unused static JavaScript source maps. The two deployment-memory checks, config lint, sequential TypeScript check and diff check pass. This is local compile evidence; the hosted retry remains the acceptance gate.

## Final hosted acceptance

Source `09561456e64fade677afc6c03552537c158e2f8f` passes required CI 39843245683 (6,571 tests, one existing skip, plus database integrity) and Managed previews 39844352154. The hosted build completed successfully after the source-map change. The deployment is `dpl_CgYFMPPg8zzPhQszCdqwcGxucTfW`, <https://wisconsin-creative-m19fb6rew-erikrole.vercel.app>, on the same owned sanitized database branch. Preview setup and doctor pass.

The fixture-free final browser run attests the exact CI SHA and Managed deployment, signs in normally, verifies both physical handoff accounts and the persisted 512×512 WebP, and renders the real uploaded photo. A fresh invited student enters a newer apparel answer while the first real committed save response is held: one Continue waits for the latest answer and reaches Photo; Finish without a photo completes setup. Final receipts and inspected captures are in `verification/final/`. The entire native Git tree remains identical to the signed `84586e71f` archive, and all 225 production Swift files match the isolated app tested on the phone.

The evidence/docs commit following this source changes no app, server, migration or native behavior. Production merge/migration/deployment and App Store/TestFlight upload, submission or distribution remain the release boundary. Xcode export validation’s unfinished upload record is retained; no IPA bytes have been uploaded.

Lost-response reconciliation, independent groups, both conflict choices and offline retention/reconnect also pass again against final source `09561456e`; the new receipt is retained in `verification/final/web-recovery-result.json`.
