# Recent iOS review fixes

Scope: close the 11 findings in `/private/tmp/wc-ios-review-20261022/REVIEW.md` on one isolated local checkout. Original feature branches and dirty root files stay untouched. The user subsequently authorized the commit, push, and PR for the fixes and onboarding improvements; merge to main, production migration deployment, and distribution remain outside scope.

Baseline: main `ecc399c3c`, plus existing feature deltas from #564 `8714da249`, #604/#599 `eaa1fdec1`, #600 `8951d72a0`, #601 `5881ac706`. Exact revision/merge-base manifest is under `tasks/archive/proofs/ios-review-fixes-2026-10-22/baseline-sources.json`. Existing changes were composed without staging or committing; API additions were retained in the extracted domain extensions and generated Xcode membership will be rebuilt.

## Plan and owning contracts

1. Regenerate Xcode project and establish a buildable combined baseline (project.yml owns membership).
2. Fix Wrapped identity visibility on both newly built and frozen cards (D-056), shared-secret interruption ownership (D-052), announcement response decoding, and license empty-state recovery.
3. Fix Search Gear local authentication, mixed serialized/family projection, scan-scope routing, personal Home copy/sections (D-058), all-area blast validation, and nil versus zero comparison rates.
4. Add focused regression cases at the existing service/native/source-contract owners. Prove they fail before each fix where applicable.
5. Build/test Wisconsin for iPhone 18 Pro Max; inspect fixture screens and failure/recovery interactions. Produce local matched UI evidence, update area acceptance, and request an independent final review.

## Findings

- [x] 1. Xcode target registration after client extraction/cache replacement
- [x] 2. Wrapped hidden/inactive identities, including frozen payloads
- [x] 3. Shared-login pending-secret clearing
- [x] 4. Announcement dismissal envelope/retry clearing
- [x] 5. Active license controls with an empty pool
- [x] 6. Search Gear local device authentication
- [x] 7. Siri bulk-family matches
- [x] 8. Scanned family resets incompatible search scope
- [x] 9. Personal Home wording and truthful sections/fixtures
- [x] 10. All six blast areas accepted
- [x] 11. Zero win rate distinct from unavailable

## Acceptance and boundaries

Implemented all 11 findings. Initial verification: 251 native tests, 821 focused source/API tests, 135 broader backend tests, seven simulator UI tests, TypeScript, touched-file lint (111 files), and build:app passed. Final native checks will also include the subsequently requested onboarding refinement. The independent backend and native reviews found no actionable regressions. The optional drift scan still flags 11 pre-existing style/heuristic hits in the assembled feature branches (7 status colors, 2 gestures already marked as buttons, 2 preformatted area labels); these are recorded separately from the 11 review defects. Siri lock-screen authentication, real camera QR input, APNs and hardware-only acceptance cannot be inferred from simulator success. Existing #564 migrations are included in the combined feature source but will not be applied to any database by this task.

## Additional authorized slice: onboarding appearance

The user requested a visual refinement while verification was finishing. The current required-onboarding native source was snapshotted from the dirty root and three-way composed into this isolated checkout; API hardening and other root work were not imported. Presentation edits are limited to `ProfileCompletionWelcomeView.swift` and its shared components. Existing validation, save, required/optional rules, and choice sheets remain owned by the current onboarding work. Match the current pre-refinement source snapshot, light/dark fixtures, and large text.

Final result: all 11 fixes and onboarding appearance are source-complete and independently reviewed. Wisconsin builds; all 251 native tests, 821 focused source/API contracts, 135 backend owner cases, and seven simulator UI tests pass. Source-only onboarding checks also pass (28). TypeScript, lint, build:app, project generation, and audit inventory pass. Native proof uses iPhone 18 Pro Max, iOS 27.0, UDID 795AB4E9-3E4A-4C13-9D4F-27FD822C190B. Local HTML reviews retain comparable PNG receipts, runtime binary hashes, and explicit external-proof limits. The local commit on codex/ios-review-fixes preserves this verified combined source, including the existing feature dependencies listed in baseline-sources.json; no root product files were changed by this task.

Concurrent onboarding updates were reconciled before final proof: required setup retains Sign out in the footer/load-failure recovery, profile refresh flags clear on account/save transitions, and the new required-setup bypass regression joins the native gate (251 tests). The final visual baseline includes these same behavior updates.

The remaining style-drift follow-up is now closed: see `ios-style-drift.md` and `../proofs/ios-style-drift-2026-10-22/review.html`. The unchanged detector and simulator verification wrapper pass.

Delivery: implementation commit `5881c44c` is pushed on `origin/codex/ios-review-fixes` with PR [#605](https://github.com/erikrole/wisconsin-creative/pull/605) targeting main. The required public release entry identifies this PR. CI and the automatic branch-owned managed preview are separate remote gates; production and App Store distribution are unchanged.
