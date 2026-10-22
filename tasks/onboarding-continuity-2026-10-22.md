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
6. Record actual acceptance and any hosted/authenticated boundary. No commit, push, deployment, production mutation, or external email is authorized yet.

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

- [ ] Obtain this branch’s hosted Managed preview via a scoped commit, push and same-repository draft PR, once the user authorizes those actions. The current branch has no PR or environment; D-063 prohibits borrowing another branch’s environment or production credentials.
- [ ] Seed one student in that sanitized preview, authenticate web and native to that same backend, verify web→iOS and iOS→web continuation, concurrent edits, relaunch, lost-response recovery, and photo-free completion. Local fixture/API tests do not substitute for these handoffs.
- [ ] Verify real PhotosPicker/photo-library behavior on the physical iPhone 16 Pro, including permission/selection recovery and the chosen photo appearing on both clients.
- [ ] Apply migration `0200` and ship/distribute the verified server/native slice only with explicit release authorization. Existing accounts remain outside the new required gate.

No commit, push, PR, hosted database mutation, deployment, external email or distribution has occurred in this task.

## Authorized shipping follow-up

2026-10-22: The user authorized scoped commit, push and a draft PR, authenticated handoff tests both ways, and a physical iPhone photo upload check, with the intent to release an app update today. The physical iPhone 16 Pro is currently unavailable in Xcode; a connection request is pending. No merge or production release has occurred.
