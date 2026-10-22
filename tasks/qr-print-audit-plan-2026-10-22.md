# QR Print audit and direct-print proof

State: local, uncommitted; approved 21 px layout and six label kinds accepted; the existing independent-label Stop is physically confirmed. SDK batch and separate Stop-feed experiments now pass physically; remaining-only child count and full chained product integration remain pending. Authenticated/migration/release gates remain separate.

## Approved integration slice

The user approved attempt 4 and requested this default layout plus direct USB printing. Add a shared exact-Gotham bitmap renderer for all six label kinds, the verified PT-D610BT transport, media checks, exclusive printing, per-label completion/uncertainty receipts, and primary USB controls. Preserve deliberate printed/applied confirmation and keep CSV as an optional secondary export. Verify renderer/transport failure boundaries, matched fixture UI, and one integrated physical label. No commit, push, or deployment is authorized.

## Scope and contracts

- Baseline: `3cf4a1f302b3a1e1276dbb50394daf7aed86ad20` on `claude/project-thread-k77b71`, PR #590.
- Preserve the unrelated primary checkout. Work only in the attached `qr-print-audit` worktree. No stage, commit, push, deployment, or production mutations requested.
- Owner: `docs/AREA_ITEMS.md`; D-022 keeps unit QR identity derived from family QR plus the unit number and keeps physical printed/applied state separate from downloads.
- User direction: balanced, centered labels every time; Medium Small QR cells; the existing Gotham font. Printer: Brother PT-D610BT, 12 mm white-on-black tape.
- Files: labels cart/helper/sheet/preview, `label-sheet.ts`, `brother-label-csv.ts`, six bundled `.lbx` templates, focused tests and owner docs. The prototype was promoted into a browser-local product path; no backend or production-data mutations were added.

## Implemented locally

- [x] Bound unit picks and number runs; invalid, unknown, retired, pending, or failed unit selections block partial downloads.
- [x] Validate unit response shape and expose retry. Preserve edits/focus when changing templates.
- [x] Bind download state to exact CSV contents; retain the union of downloaded unit batches for deliberate printed-state marking.
- [x] Repair all six native template/database mappings and portable CSV references.
- [x] Center every object frame, separate text/QR, and use Medium Small (`1.2pt`) cells in all four QR templates. Constrain text independently of the QR.
- [x] Reject QR payloads exceeding version 1 / M at this size, checking the complete derived unit identity without shortening it.
- [x] Prevent global reduced-motion transitions from invalidating text-fit measurements.

## Verification and physical evidence

- Final verification passes: 62 focused tests, TypeScript, touched-file ESLint, `npm run build:app`, `npm run verify:docs`, and `git diff --check`. The fixture browser checks pass after the reduced-motion correction; number text measures 13.257 CSS px inside its 13.344 CSS px frame. Existing stale codemaps were regenerated for docs verification. The app build restored its generated Next type reference automatically.
- Baseline regression extraction demonstrated eight failures in the original helper. Browser fixture checks cover exact CSV contents, invalid selection blocking, download freshness, cumulative unit marking, failed-response recovery, edit persistence, fixed-frame fitting, keyboard access, and phone/tablet widths.
- Authenticated feature-route proof is unavailable: PR #590 has no hosted managed preview environment. A normal signed-in production read confirmed the real item `FB FX3 1` and QR `c62a82d7`; it did not modify the item or prove the local route.
- P-touch merged record changes correctly, and native-screen QR decodes succeeded. A physical initial label clipped and failed scanning. A smaller subsequent code was rejected by the user, so it is not the accepted size.
- P-touch rejects a CSV with only one actual record, including an extra terminal blank line. Do not manufacture duplicate item rows as a workaround. A standalone prefilled label file or direct printing still needs an implemented product path.
- Medium Small V1 needs 63 core dots at 180 dpi. Full four-module quiet zones would total 87 dots (about 12.28 mm), exceeding 12 mm tape; physical scanning remains an acceptance gate even when centered. Do not silently shrink the requested code.
- Bluetooth: Chrome discovered the exact paired SPP service, but opening failed twice, then once more after fully closing P-touch. Discovery is not transport/print proof.
- USB: after the user connected a data cable, hardware registry found `04f9:20e1`. Chrome WebUSB claimed interface 0 / IN 1 / OUT 2 directly. A status-only `1b 69 53` request returned a valid 32-byte response with no errors and 12 mm tape, with P-touch closed. This proves direct communication without Brother software.
- Direct USB attempt 1 stopped before label pixels because a zero-length raster-mode drain was treated as an invalid status frame. Attempt 2 sent one complete raster job; the user reported that the font was wrong. That rendering path is rejected.
- Replaced font lookup with glyph outlines read directly from the installed `GothamXNarrow-Bold.otf` through CoreText, requiring the exact `GothamXNarrow-Bold` PostScript name. Attempt 3 used 19 px text and 43/44-dot outer ink margins. The user confirmed the font, centering, unclipped output and production scan: “Everything looks good. Font can be a little bigger.” This approves that exact direct USB label, not every template or the unintegrated product flow.
- Empty USB packets also precede completion. Earlier attempts stopped waiting too early and remain recorded without automatic retries. The revised receiver waits within an elapsed-time deadline, validates complete status frames, and closes on timeout. Mock transport checks pass for many empty packets plus printing/completion notifications and for short-write stop/no retry. Attempt 4 now proves real completion: 123 empty packets preceded a type-1 no-error completion frame, about 6.4 seconds after the raster job was sent; USB then closed.
- Attempt 4 enlarges the same exact Gotham outlines from 19 to 21 px (about 10.5%), with both text and QR core 63 dots high and balanced 42/43-dot ink margins. The QR remains version 1 / M with 3-dot Medium Small cells and the same `c62a82d7` identity. Printer-confirmed completion and the larger physical text are user-approved.

## Remaining gates

- [x] One direct USB raster label physically scans to the production item at Medium Small size, with centered Gotham text and acceptable feed/cut margins (user-approved attempt 3); real printer completion acknowledgement verified on attempt 4.
- [x] User approved the slightly larger 21 px Gotham comparison (attempt 4) and requested it as the default.
- [x] Product integration: shared exact-outline bitmap renderer/preview, PT-D610BT media preflight, cross-tab exclusive jobs, immutable 500-label batches, per-label completion receipts, reload/uncertain recovery without automatic retry, stop after current label, and user-driven applied confirmation.
- [x] USB supplies the single-label path. Optional CSV export documents the P-touch one-record limitation; it does not manufacture duplicate records.
- [ ] Authenticated feature-route proof on its own managed environment.
- [ ] User review and separately authorized shipping.

Proof: [local review](archive/proofs/qr-print-2026-10-22/review.html), matched PNG receipts/source patches, final check logs, device attempt logs, exact glyph outlines, raster round-trip and mock transport results under `tasks/archive/proofs/qr-print-2026-10-22/`. Temporary running prototype: `/private/tmp/qr-print-audit-evidence/direct-print-probe/`. The exact font outline map and its macOS regeneration script are bundled; browser fallback fonts are never used for print output.

## Integrated verification and acceptance

- Shared renderer defaults to exact GothamXNarrow-Bold at 21 px for body/lens three-line labels. Medium Small QR cells stay 3 dots; FB FX3 1 is 194×76 dots, with 42/43-dot outer margins and unchanged `c62a82d7`. The browser differs from the accepted Sharp prototype by eight edge pixels in the text only; QR pixels and placement match. Alpha thresholding uses the same mask for bounds and printing. Independent review measured all six representative label kinds centered to at most one rounding dot.
- USB is enabled by Permissions Policy only for `/labels` and the development fixture (the fixture exception is absent from the production build manifest). Desktop Chrome/Edge, exact PT-D610BT, 12 mm laminated white-on-black tape are the bounded support scope.
- The first integrated attempt stopped at readiness with no raster setup. The user confirmed no output and explicitly authorized clearing it and retrying after automatic approval review required physical-output confirmation. Re-selecting the already-active alternate was removed to preserve endpoint state. The next integrated job completed 1/1, and the user confirmed: “Yes, it looks right and scans.” This closes the one-label integrated physical gate.
- Final source verification: 76 focused tests (including 14 transport cases), TypeScript, touched-file ESLint, `npm run build:app`, docs verification and diff whitespace checks pass. The local runtime is Node 24.22; CI's Node 22 environment is not claimed verified. Existing unrelated build warnings remain.
- Browser fixture verifies exact raster QR decode, complete-batch render preflight, one completed / one unknown / one unsent label, cross-tab delayed-chooser blocking, persisted receipts after reload, explicit applied marking for completed unit 37 only, safe stop, existing CSV freshness/cumulative export behavior, failed-response retry, edit persistence, keyboard access and 1440/768/390 CSS-pixel layouts. No page errors. Mocks do not establish native transfer cancellation or every physical failure mode.
- No stage, commit, push, deployment or production printed-state mutation. The feature route's authenticated preview gate remains open. Other template/media physical acceptance remains outside the one validated body-label proof.

Current proof: [USB integration review](archive/proofs/qr-print-2026-10-22/usb-integration/review.html), matched captures and source receipts, source snapshot, quality/build logs, browser harnesses, production policy manifest, and hardware completion screenshot/state.

## Requested full-page refinement

The user requested bigger/better previews and refinement of the whole page after approving the integrated physical label. Preserve the accepted renderer and USB lifecycle. Increase previews to a crisp 1:1 printer-dot view, add an enlarged inspection dialog, center each preview in a consistent tray, replace native-template filenames with product names in normal controls, improve picker/sheet/printer hierarchy, and refine custom-label forms. Verify matched fixture captures, dialog/keyboard behavior, wide/tablet/phone layouts, USB/CSV regressions, quality gates and owner docs. No shipping action is authorized.

Refinement proof: normal previews are exactly 194×76 CSS px for the accepted sample, up from 112.31×44; the inspection dialog is 388×152 at desktop width and preserves aspect when constrained. Bitmap PNG bytes match the pre-refinement source exactly. Preview ink is centered in its tray. Browser checks cover accessible dialog naming, Escape/focus return, all three custom generators, valid selection state, four viewport widths and the 1024 px app-sidebar width constraint. USB and CSV regression browser checks still pass; 76 focused tests and TypeScript pass. Final build and review are recorded in the visual-refinement proof folder.

- [x] Requested full-page refinement complete locally; final app build, 76 focused tests, TypeScript and lint pass. Matched source-bound review: [larger previews and page refinement](archive/proofs/qr-print-2026-10-22/ui-refinement/review.html). Print pixels remain unchanged.

The combined review and refined helper are opened locally. Dark appearance was checked in the user’s actual Chrome window. Final docs/codemaps and whitespace checks pass. The isolated baseline review server is stopped; the current database-free helper remains on loopback port 3145 for review.

## Print journal, recovery and operator history (authorized follow-up)

1. Add a strict print-job state machine and durable, authenticated operator history; immutable per-copy identities, timestamps, active index, optimistic concurrency and idempotent log writes. Stop output on persistence failure and preserve acknowledged progress.
2. Recover unreadable/legacy local journals explicitly, keep the shared-browser unresolved-job guard across accounts, reconcile uncertain output, and continue only remaining copies with linked history.
3. Use one template-ordered prepared queue for USB/CSV/display, visible whole-sheet renderer preflight, responsive preparation, and exact generated-QR checks.
4. Scope drafts to the account, surface persistence/conflict failures, and add undo for remove/clear. Separate device, storage, domain and presentation responsibilities.
5. Verify regression tests, browser recovery/keyboard/layout, source-bound visual evidence, type/lint/build/docs and independent recovery review. Prepare a bounded all-template and device-fault acceptance checklist; physical outcomes require actual observation. Keep migration/live/authenticated/release boundaries explicit.

Ownership: this worktree only; primary checkout and pre-existing edits preserved. No commit, push, deployment or production mutation is included.


### Recovery implementation and verification state

- Implemented a validated command state machine, versioned local outbox/CAS fencing, explicit in-flight copy identity, one-checkpoint final completion, no device replay on log retry, immutable per-copy snapshots and exact remaining-only child batches.
- Added migration 0198 and authenticated print-history endpoints. Operator identity comes from the session; device acknowledgement, explicit physical review and applied state remain distinct. Server checkpoints and audit events are atomic; create/body-bound checkpoint retries and the shared-browser unique reservation are covered by real disposable PostgreSQL tests. No migration was applied to an application database.
- Independent review found and fixed stale begin authorization, passive-tab outbox overwrite, foreign-operator pending-log recovery, account history leakage, corrupt raw-record disclosure, and reviewed-outbox recovery outside the first history page.
- Canonical template ordering drives the sheet, CSV and USB; full bitmap/font/text/QR preflight is responsive and retryable. Approved preview PNG bytes remain identical. Draft save failures/conflicts are visible, drafts belong to the account, and Undo preserves later edits/selections.
- Focused tests, real PostgreSQL cases, source checks and browser evidence are recorded in `archive/proofs/qr-print-2026-10-22/recovery/`. Final totals/build/docs status are recorded with the proof.
- Hardware: the fixture sent six layouts and received six no-error acknowledgements. The user accepted all layouts and four production scans, then clarified that six good labels plus six blank offcuts came out. This closes the six-kind layout/scan gate. The existing transport pre-cuts the blank leader and finalizes each label separately: one leader offcut per label is now a known tape-cost limitation. Chained printing is not enabled; its final feed and stop/completion semantics need a separate physical test. The controlled stop then recorded two completed copies and four unsent; the user confirmed exactly two printed labels and two blank offcuts. No automatic continuation was sent.
- Disconnect/reload proof: after the user unplugged USB, Continue became disabled. Reload restored exactly two completed/four unsent; nothing resumed. The stopped test batch was explicitly finished without its remaining labels and the pre-test sheet restored. Both test batches remain in local fixture history. This is a between-job disconnect check, not a mid-transfer cable-pull test.
- Open: authenticated branch-owned feature-route proof, application migration/release. Mid-transfer disconnect and tape-out remain outside physical acceptance. No stage, commit, push, merge or deployment.


Final local gates: 92 focused tests plus 9 real disposable PostgreSQL service/migration cases (101 total); app build, TypeScript, touched-file ESLint, Prisma validation/prefix checks, codemaps/docs and whitespace checks pass. The Prisma schema diff contains only the new job table, indexes and user relation; the forward SQL adds checked revision/browser invariants. The real database cases exercise concurrent reservation, exact retries, audit rollback, student/foreign-account boundaries, exact child lineage, atomic failed-child rollback, explicit staff physical reconciliation, and retained operator attribution. Browser evidence covers partial/unknown/reload/remaining-only recovery, all six kinds with simulated USB, failed logging, safe stop, changed media, corrupt journals, failed batch creation, stale reviewed outbox, draft conflict/undo and viewport widths. Independent review reports no remaining P1/P2 in reviewed source. Node 24.22 was used locally; the configured CI Node 22 gate remains separate.

`preview:status` confirms this branch has no managed preview. No authenticated feature-route or live application migration proof is claimed. The six-label physical job is accepted after the user clarified that all six printed labels were present alongside six blank leader offcuts. A second job stopped at two acknowledged labels and preserved four unsent, matching the user's physical count. The cable was then unplugged for a no-output recovery check. No tape-out or mid-transfer cable-pull test is claimed.

Current follow-up proof: [journal and safe recovery review](archive/proofs/qr-print-2026-10-22/recovery/review.html), retained source snapshots, matching capture receipts, 101-test logs, build/source checks, and actual USB completion/stop/disconnect UI evidence. The original combined UI review is preserved as `review-through-ui-refinement.html`.

## Chained printing (authorized 2026-10-22 follow-up)

User scope: remove blank strips between labels while preserving safe recovery and Stop. Preserve the approved renderer, QR identity and all earlier changes; no shipping action is authorized.

1. Retain current sources (`/private/tmp/qr-print-chain-evidence/before-source.tar.gz`, SHA-256 `8c90f06619edf0577e9578abae3f98c7ba8e5fc656310b69e9b988e5aede6281`). Research exact D610 commands and independently review acknowledgement/final-feed semantics.
2. Run a bounded isolated two-page chain and separate held-tail feed/cut probe. Intermediate acknowledgements are provisional; raw receipts are durable, output never retries, and the product default remains unchanged until physical proof.
3. If hardware succeeds, extend the journal/domain/controller/transport/UI to represent every provisional copy and final-feed intent. Stop must send no further label content and release the held tail through the verified finish path. Disconnect/log failure must retain unknown copies for explicit physical review.
4. Add meaningful transport/domain/controller/PostgreSQL and browser recovery cases, run required source/build gates, update visual evidence and owner contracts. Physical gate includes mixed layouts, Stop and uncertain-tail recovery.

Files: `brother-usb.ts`, `label-print-job.ts`, `label-print-controller.ts`, `label-print-storage.ts`/service if needed, USB hook/controls, focused tests and owner docs. Existing database table stores versioned JSON; do not add a schema migration unless necessary.

Independent protocol review: exact-model upstream uses one initialization across pages, `ESC i K 00` for chain and `1A` per page, with D610 info `n9=02`. `K08` is the no-chain bit; final switch/standalone flush still need physical proof. A related Brother USB reference permits intermediate completion before physical output finishes, so no intermediate chain page may be recorded as permanently printed. Readiness must also validate phase number, and close/error cleanup must never hide a feed. No source proves a bare zero-raster `K08+1A` finish on D610; supported physical fallback is Shift+Preview → Feed & Cut.

Chain probe results so far (isolated page, default helper unchanged):

- Probe 1: once-initialized two-page chain received two type-1/no-error acknowledgements; user reported one good label plus two blanks. Rejected.
- Probe 2 restored upstream per-page raster mode/drain and exact five-byte chain command, with distinguishable TEST CHAIN A/B labels rendered/decoded through the shared renderer. Two no-error acknowledgements again; user reported A and two blanks, no B. Rejected.
- One zero-raster final-feed attempt (complete D610 header, no reset/content) timed out after 20 seconds and closed without replay. Manual Feed & Cut did not recover B or left an error. Requested printer power cycle to clear this disposable test before more device operations.
- Replan: preserve the physically verified initialization before each page, add chain only to the first page, and use the normal final-page path without unsupported K08. This is a separate hypothesis, not enabled product behavior. Known failed zero-raster release is disabled.
- Device acknowledgements are not physical acceptance. Test receipts and source snapshots are retained in `/private/tmp/qr-print-chain-evidence/`; no confirmed application copy was replayed or changed.

Final chain investigation result: not accepted and not enabled. Probe 3 preserved normal initialization per page and omitted K08 on its intended final page; it timed out during the first page and never sent D. The user observed one blank and no label. User powered off/on; a final status-only request confirmed receive-idle phase number zero and no printer errors, and USB closed. No further content/feed operations were sent. The existing helper, journal, stop and physical recovery paths remain byte-identical to the pre-investigation source.

The next evidence gate is an exact D610 known-good chain/final-feed capture, not another parameter guess. No multi-provisional-copy state machine or chain default was added before transport proof. See [the failed-chain investigation](archive/proofs/qr-print-2026-10-22/chain-investigation/review.html) for exact sequences, receipts and physical observations.


## Known-good SDK investigation (active)

User scope: capture a working chained job from P-touch, reproduce its commands in the helper, and preserve safe recovery and Stop. The user additionally requested the GitHub Reverse Engineer Anything skill and approved installing its native analysis provider, Hopper.

1. Inspect live P-touch USB settings and available capture paths. CUPS does not carry this SDK path. Ordinary macOS debugger attachment was denied; automatic approval review rejected a privileged debugger bypass. Do not attach through another mechanism, re-sign the vendor app, or weaken macOS security.
2. Use the official REA skill and CLI against the exact installed MacPrintSDK. User approved Hopper-only installation at `/Users/role/Applications/Hopper Disassembler.app`; no Codex registration/configuration changes. Preserve native evidence locally, identify D610 profile, first/middle/final commands, cut settings and supported finish behavior. Static generation remains distinct from captured runtime bytes.
3. Before another bounded physical trial, independently review the exact command sequence and any unresolved final-feed behavior. Do not repeat earlier unsupported parameter guesses. Keep accepted product transport/layout unchanged until physical evidence supports replacement.
4. Once hardware behavior is proved, extend the journal/controller/transport to persist provisional chain copies and explicit final-feed intent, preserve uncertainty on disconnect, stop before any further label content, and never feed implicitly from close/error cleanup. Verify failure cases, fixture UI and physical Stop/recovery before enabling a default.

REA SDK identity: SHA-256 `3b958667dc02b7236caad63bb27656c36fe6d57a70aea6ecd1fdf96d5506e85b`, ARM64 UUID `DFFD3A57-7846-395A-97CA-8355CA009F0D`. Initial Mach-O evidence `ev_c47ee3eab1c3f985f86055d7265c0f1af0948bd1a88f29b50c75da2f8f6953fd`; native decompilation is working through REA 6.7.0 / Hopper. Raw vendor-derived analysis stays under `/private/tmp/qr-rea-*`; record protocol findings and acceptance separately.

SDK follow-up result: REA/Hopper decompiled native command builders; an independent static review and an offline vendor SDK harness confirm first/middle/final info `00/01/02`, raster endings `0C/0C/1A`, four-byte K commands and native control ordering. The app's two-copy Auto Cut on / Chain Printing off job physically released the old missing C test plus two good new labels, with no blanks. This demonstrates that power cycling and idle status did not prove a clear tape path. Automatic Stop/feed is not yet proved. Both ordinary and explicitly authorized administrator debugger attachment were denied by macOS. The passive script never loaded; live capture is abandoned without changing security settings. All 26 source/test files still match the pre-chain snapshot. See [SDK investigation](archive/proofs/qr-print-2026-10-22/sdk-investigation/README.md).

User explicitly approved safe administrator capture and authenticated directly in Ghostty. macOS still denied attachment; no target or capture was active. The user quit LLDB and clarified that the QR work should continue through SDK generation without changing macOS security settings. Do not repeat the attachment approach.

Active SDK-only slice: generate a two-page stream using pure installed SDK builders; independently decode every raster byte and QR, then review an isolated transport before physical output. Persist every send intent and phase receipt, send no further page after Stop, never replay on error/reload, and require physical review for all provisional output. Keep all 26 accepted helper source/test files unchanged until batch, Stop and recovery are physically proved. Offline packet/raster verification and six safety cases now pass; physical trial remains pending.


SDK physical progression: the generated two-page job passed with two good labels, one initial blank and none between. The subsequent controlled Stop sent only page 0 of a three-page queue; the user saw one blank and no complete label. Page 0 remains uncertain/possibly held, and two pages remain host-unsent. No default/source change is accepted. A separate zero-ink, one-raster-row final SDK page is prepared as a bounded feed experiment, with durable one-attempt intent and no automatic retry; it has not been sent. Evidence: [SDK batch and Stop review](archive/proofs/qr-print-2026-10-22/sdk-investigation/review.html).

The one-row final-feed candidate failed the offline minimum-length review before output. Its replacement is four zero-ink rows and passes the actual native SDK length guard. A separate CAS-protected finish intent, exact packet hash and stale-tab tests are prepared; no feed attempt has run yet.

The reviewed four-zero-row final page passed native length validation and was sent once with a durable finish intent, no initialization and no label-pixel replay. The user confirmed one good held label plus one blank strip. The isolated remaining-only child contains exactly original source pages 1 and 2, excludes the confirmed first copy, survives reload without printing, and received both page transitions. Its physical count remains pending. The draft pure browser encoder matches every byte of all five reviewed two-/three-page SDK packets and the Stop-feed packet. It is not integrated. Next bounded implementation design: [SDK integration notes](archive/proofs/qr-print-2026-10-22/sdk-investigation/sdk-integration-notes.md).


### Fresh distinct-letter gate and integration (active)

The earlier remaining-only child `1c7f380b-debd-441b-9bca-206aa31ac726` stays physically unverified: the user forgot its count. Its raw receipt is preserved and no copies were replayed. A separate TEST CHAIN A/B/C receipt passed: actual Stop released only A plus two blanks; reload emitted nothing; explicit recovery printed B and C exactly once, no A duplicate, one initial blank and none between.

The helper now uses an explicitly tagged SDK chain transport. Every intermediate page is buffered/provisional, the final page or separately durable Stop-feed intent settles all sent copies atomically, errors never feed, and every held/in-flight copy remains reviewable individually. Existing untagged receipts retain their earlier semantics. Exact create/checkpoint identity, session attribution, parent lineage and browser reservation are preserved. Receipt downloads and an opt-in USB simulator support review. A passive refresh now retains an optimistic pending completion after a local storage failure.

Independent review found no remaining P1/P2 after that refresh fix. The production encoder matches all five offline SDK reference packets byte for byte, including the exact 59-byte zero-ink feed. The integrated helper's six-kind batch physically passed: all six good, four production scans, one initial blank, no between-label blanks. Integrated Stop/recovery and final build/visual/docs gates are still pending. Proof: `archive/proofs/qr-print-2026-10-22/sdk-integration/`. No macOS security settings changed; no application migration or release action occurred.


### Integrated chain acceptance

- [x] SDK chain is the local default for new batches; untagged v2 receipts keep their earlier semantics. No new schema migration is needed for the versioned JSON extension.
- [x] All six layouts and four QR scans physically accepted; one initial blank, none between.
- [x] Actual Stop during B completed only A/B, zero-ink release, C unsent; user saw A/B plus two blanks. Reload sent nothing. Explicit remaining-only child printed C once plus one initial blank, no A/B duplicate. Both jobs reviewed and the previous sheet restored.
- [x] Simulated page disconnect retains all held/in-flight copies, blocks new output and requires individual review. Failed local final-save + passive refresh retains pending settlement; log retry sends no bytes.
- [x] Independent review found no remaining P1/P2. Focused tests, real disposable PostgreSQL service/audit/lineage cases, TypeScript, touched-file ESLint and migration-free app build pass.
- [x] Matched visual review, source/capture hashes, responsive smoke, docs/codemaps, references and whitespace verified. Current proof: [SDK integration review](archive/proofs/qr-print-2026-10-22/sdk-integration/review.html). 109 focused tests + 11 real PostgreSQL cases (120 total); no additional output required.

The source snapshot and retained before/after patch are under `sdk-integration/`; raw native vendor analysis remains outside the repository. Production/authenticated managed-preview proof, application of existing migration 0198, mid-transfer physical cable pull, tape-out and release are not claimed. No commit/push/deploy, no additional hardware output, and no macOS security changes.


## Authorized authenticated checks and release (2026-10-22)

The user now explicitly authorizes finishing authenticated checks and shipping the helper, including print-history migration. This supersedes earlier local-only authorization boundaries for this release slice. PR #590 has already merged, so `codex/qr-print-usb-history` will own a new PR and its own managed preview. Preserve the primary checkout.

1. Commit the accepted QR-only slice, integrate current main and resolve in-scope conflicts. Main already uses 0198 for game snapshots; the unapplied print-history SQL is renamed unchanged to 0202. Keep historical proof receipts/source snapshots intact.
2. Pass current source/CI/integrity gates, obtain the hosted branch-owned preview, and use `preview:setup` → `dev:preview` → `auth:local`. Verify real authenticated create/history/checkpoints, session attribution, operator/role boundaries and no automatic printer output.
3. Confirm preview migration/history and exact source deployment, update release notes/PR, merge only with required checks and conversations satisfied, then verify production deployment/migration/readiness. No production label or gear state is changed merely to test the journal.
4. Reconcile owner docs and release evidence with actual outcomes. Never claim a preview or fixture proves production.


Release review: an independent schema/history review found and closed a response-size risk. New batches reserve serialized space for outcomes; history pages cap the actual UTF-8 envelope at 3.5 MB, retain the complete active receipt on the first page, and paginate without skipped batches. Late pagination responses cannot overwrite a newer account or recovery refresh. The additive 0202 migration, audit atomicity, session attribution, role boundaries and retained account-deletion snapshots have no remaining P1/P2 findings. Current Node 22 full-suite verification passed 6,639 tests before finding five undersized development-only test controls; those controls now meet the 40 px baseline. The 12 real disposable PostgreSQL cases, including maximum-size history pagination, and four control-baseline cases then passed. The initial sandbox database attempt could not reach loopback; the permitted isolated-database run passed. Authenticated and production gates remain pending.
