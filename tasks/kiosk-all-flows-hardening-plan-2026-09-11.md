# Kiosk complete workflow hardening

Owner: Codex. Status: active. Authorized: user requested all findings and flows from the September 11 Kiosk review.

## Scope and contracts

Implement all 14 findings plus person/list/scan entrypoints for existing/new checkout, reservation editing, returns, item corrections, and transfers. Preserve D-040 physical custody, D-061 shared custody, existing role permissions, actual kiosk location, transactions, allocation history, and operator audit. No production writes or distribution requested.

Unrelated resource-import code, validation, area/risk docs and task indexes are dirty; preserve those changes. No staging, commits, or pushes authorized.

## Ledger

- [ ] Baseline visual capture and current-source contracts
- [ ] F1 cross-kiosk correction stock location
- [ ] F2 scanner re-arm after canceled edit
- [ ] F3 active-add scan queue
- [ ] F4 partial dashboard truth
- [ ] F5 async flow ownership and protected completion
- [ ] F6 pending pickup/return scans and authoritative receipt counts
- [ ] F7 staged pickup unit replacement
- [ ] F8 held-unit due-time availability
- [ ] F9 repeat numbered-unit custody with preserved evidence
- [ ] F10 shared return operator evidence
- [ ] F11 manual fallback feedback/retry
- [ ] F12 preserved custom draft due time
- [ ] F13 replayable completion receipts
- [ ] F14 truthful timeout/partial-return copy
- [ ] Consistent person/list/scan action routing with destination choice
- [ ] Reservation edit/add/remove including remaining plan after partial pickup
- [ ] List item actions and intentional multi-checkout returns
- [ ] Staff/Admin transfer from item/list; reviewed multi-item/numbered support
- [ ] Behavioral regression tests and stale source-contract assertions
- [ ] TypeScript, lint, app build, native build/tests, visual review
- [ ] Area docs, risks, codemaps, ledger and final proof boundaries

## Verification

Prior review baseline: 186 focused tests passed / 3 stale source assertions failed; WisconsinKiosk generic simulator build passed. Physical HID/camera/VoiceOver, live authenticated custody, and deployment remain independent gates.

Current implementation evidence will be recorded here as each gate completes.
