# Kiosk multi-lens review plan

Owner: Claude. Status: active — audit and fix, commit and deploy authorized by Erik 2026-09-24. Physical managed-iPad session scheduled for the week of 2026-09-28.

## Why now

The kiosk has shipped fast since 2026-09-01: leftover pickup, add/remove at pickup, blocked-add dialogs, gameday kits, shared custody, anyone-can-return. The result is a large proof backlog. AC-20 through AC-28 are still waiting on managed-iPad and/or deployment proof. GAP-74/76/77/78/80 all pass through the kiosk. The 2026-09-11 hardening ledger (`kiosk-all-flows-hardening-plan-2026-09-11.md`, owner Codex) still has all 22 items unchecked, although later commits may have closed some of them. The native code is also concentrated in a few large files: `KioskCheckoutView.swift` has 2,765 lines, `KioskIdleView.swift` 1,369, `KioskComponents.swift` 1,141, and `KioskOperatorHubView.swift` 1,011. There is one native test file, `KioskFlowRoutingTests.swift`.

This plan reviews the whole app one lens at a time. Each lens has a clear question, an owning skill, and a findings artifact. Fixes land as small, separately verified slices.

## Ground rules

- Every lens starts **findings-only** (`tasks/audit-kiosk-<lens>-2026-09-.md`). A fix slice starts only after its findings have been triaged into the ledger below.
- Contracts to preserve: D-030/D-032/D-040 physical custody, D-061 shared custody, the trust model in `docs/AREA_KIOSK.md`, `withKiosk` scope, `source: "KIOSK"` audit, SERIALIZABLE custody mutations.
- The 2026-09-11 Codex hardening plan is superseded (Erik: "consider that old, start fresh"); it is archived and not reconciled item by item.
- Proof tiers are reported separately, never merged: source/test → native build → simulator render → managed-iPad physical → deployed.

## Phase 0 — Baseline and reconciliation (blocks everything)

2. Record the current gates: kiosk-focused vitest, source-contract tests, `WisconsinKiosk` xcodebuild, and `KioskFlowRoutingTests`.
3. Capture landscape iPad simulator baselines for every screen state: activation, idle, identity, hub, checkout (empty, cart, blocked, kit), pickup (normal, leftover, battery), return (personal, shared, someone else's), and success (with/without badge). These become the `gt-ui-review` "before" column.
4. Simulator: `iPad Air 11-inch (M4)` on iOS 26.5 — the closest simulator to the fleet's two managed `iPad Air 11-inch (M2)` (iPad14,8) kiosks on iPadOS 26.5. Captures use `scripts/kiosk-capture-scenarios.sh` against the DEBUG `GT_KIOSK_SCENARIO` fixtures, cropped to the landscape band because the headless simulator stays portrait.

Output: a reconciled open-findings list and a screenshot baseline set.

## Phase 1 — Lens passes

Lenses A–C touch custody truth and run first, in order. Lenses D–H can run in parallel after A–C are triaged. Lens I runs throughout. Lens J closes the phase.

| # | Lens (expertise) | Core question | Skill | Primary surfaces |
|---|---|---|---|---|
| A | **Custody domain** (ops/equipment manager) | Does every flow leave allocations, stock location, requester and returner, and audit exactly right, including partial, leftover, shared, transferred, kit, and numbered-battery paths? | `gt-audit-ios` + domain walk | pickup/checkout/return/checkin routes, `KioskStore`, D-040/D-061 |
| B | **API hardening** (backend) | Are all `/api/kiosk/*` mutations idempotent under retry and double-tap, serializable where concurrent, audited with before/after, and within timeout? Can a completion be replayed safely (F13)? | `gt-api-hardening` | `src/app/api/kiosk/**`, services, `resolve-scan` |
| C | **Scanning & hardware** (field ops) | HID scanner re-arm, scan queueing during async work (F2/F3), camera fallback, manual entry (F11), Wiscard identity, rejection sound, speaker volume in a loud room | `gt-audit-ios` | `KioskBarcodeCameraView`, scanner coordinator, `KioskNativeTextField` |
| D | **Native architecture** (iOS engineer) | State-machine ownership of async flows (F5), cancellation on timeout, and file decomposition of the four 1k+ line views without behavior change | `gt-ios-slice` | `KioskStore`, `KioskFlowRouting`, `KioskCheckoutView` |
| E | **Interaction design / HIG** (product designer) | Is each flow still ≤3 taps (AC-4) after recent additions? Are the hierarchy and copy clear, counter-distance legible, and Liquid Glass used consistently? Are timeout and partial-return messages truthful (F14)? | `gt-ui-review`, `make-interfaces-feel-better` | all screens, `KioskDesign`, `KioskComponents` |
| F | **Accessibility** | VoiceOver order and labels, Dynamic Type at landscape widths, contrast on `#0B0B0D`, status not shown by color alone, target sizes, sound cues paired with visual cues | `design:accessibility-review` | all screens |
| G | **Resilience & fleet ops** (SRE) | Network drop mid-completion, heartbeat and session expiry, 401 → activation, idle-timeout mid-flow (AC-9/14), sleep mode, cold launch/resume, build versioning, and the `UIRequiresFullScreen` deprecation migration | `gt-incident` lens, `gt-audit-ios` | `KioskShellView`, `KioskOnlyApp`, heartbeat, `project.yml` |
| H | **Security & trust** | Activation code lifecycle, cookie scope, rate limits on identify/resolve-scan, roster data exposure, the new anyone-can-return path, and the "wrong person" gap (no in-kiosk undo) | `gt-api-hardening` | activate/identify/users/me routes, trust model |
| I | **Tests** (QA) | Replace stale source-contract assertions with behavioral tests at owner boundaries. Grow native coverage beyond routing: store transitions, scan queue, receipt replay | `gt-test-audit` | `tests/*kiosk*` (42 files), `WisconsinKioskTests` |
| J | **Performance** | Idle dashboard and roster compute, first-paint on cold launch, scan-to-feedback latency, and N+1 queries in dashboard/student reads | `gt-audit-ios` + API timing | `dashboard`, `student`, `KioskIdleView` |

Each lens produces its findings in this shape: severity (custody-breaking / operator-blocking / friction / polish), evidence (file:line or capture), and the proposed slice.

## Phase 2 — Fix slices

- Order: custody-breaking → operator-blocking → friction → polish. Within a tier, group fixes by owner file so each slice stays a single verifiable change.
- Every slice goes through the `AGENTS.md` verification matrix: focused tests, `tsc`, lint, `build:app`, `WisconsinKiosk` xcodebuild, and a `gt-ui-review` before/after page for visible changes.
- The Lens D decomposition runs as behavior-neutral slices after the A–C fixes land, so refactors don't hide custody fixes.

## Phase 3 — Physical acceptance and rollout

1. A single managed M2 iPad Air session with a script covering AC-20…28 and the kiosk legs of GAP-74/76/77/78/80: HID scanner, camera, speaker, VoiceOver, and Guided Access.
2. Deploy compatible server code, then the kiosk build via the existing distribution path.
3. Sync `AREA_KIOSK.md` acceptance statuses, `GAPS_AND_RISKS.md`, codemaps, and archive this plan and the reconciled 09-11 plan.

## Ledger

- [x] P0 archive superseded 09-11 plan
- [x] P0 baseline: WisconsinKiosk Debug simulator build passes at 8a09d0ca (one warning: UIRequiresFullScreen deprecated); baseline binary preserved for paired captures
- [x] P0 iPad screenshot baseline (24 fixture scenarios)
- [x] A custody domain findings (A1–A13)
- [x] B API hardening + H security findings (B1–B9)
- [x] C scanning, hardware + G resilience findings (C1–C12)
- [x] D architecture + I tests + J performance findings (D1–D18)
- [x] E/F design and accessibility pass from captures
- [x] Fix slices — custody/server: B1/A13, B2, B3/C2/D2, B4, B5/A11, B6, B8/D18/A12, B9, A3, A5, A6, A7, A8, A9, A10, D16
- [x] Fix slices — native: C1/D1/A1, C3, C4, C5, C6, C8, C9/D3, C10, C11, D4, A2, A4, D11
- [x] Fix slices — design: scanner pill scope, idle status control, checkout details layout + kit menu, compact scan stage, battery copy, hub overdue count, activation emphasis, event sheet empty rows, drawer scanner badge truth
- [ ] Deferred (next slice): D5/D6/D7 view decomposition and shared scan-feedback controller; D8 dead idle event code; D10 single-round-trip scan preflight; D12 dashboard payload; D13 avatar cache; D14/D15 source-grep test pruning; C7 HID burst guard in text fields; C12 polish list; UIRequiresFullScreen migration; kiosk_pickup audit inside createBooking
- [ ] Managed-iPad acceptance session (week of 2026-09-28): HID scanner, camera, speaker, VoiceOver, Guided Access; AC-20…32
- [ ] Deploy + read-back

## Decisions (2026-09-24)

1. Simulator/device: the kiosk's own hardware — two managed iPad Air 11-inch (M2) — with iPad Air 11-inch (M4) iOS 26.5 as the simulator stand-in. `AGENTS.md` simulator policy amended accordingly.
2. The 09-11 plan is old; start fresh.
3. Audit and fix; commit and deploy authorized.
4. Physical acceptance next week.
5. Before/after screenshots for artifact review: baseline binary built from `8a09d0ca` and preserved so the pair is recaptured back to back.
