# Brother SDK investigation

State: SDK-generated two-page USB batch physically accepted: two good labels, one initial blank, none between. Controlled Stop retained two unsent pages and initially released only a blank. A separately journaled zero-ink SDK feed then released the held label plus one blank, physically confirmed by the user. Remaining-only recovery has received both page transitions; its physical count is pending. No chained helper default is enabled. Live capture was denied by macOS; security settings remain unchanged.

## User-observed native job

P-touch Editor 5.3.24, PT-D610BT(USB), existing Medium Small FB FX3 1 sample, two copies, Auto Cut on, Chain Printing off, Special Tape off, Mirror off. The app returned from Printing without an error. The user reported: “The missing C test and two good labels. No blanks.” [Recorded settings](native-two-label-settings.jpg).

The native batch therefore released the previously missing C test from an earlier failed experiment as well as two new good labels. Earlier power cycles and receive-idle/no-error status did not prove that all physical tape had been released. No helper or production journal record was changed to retroactively claim that failed test completed.

## SDK evidence

- Installed target: `/Applications/P-touch Editor.app/Contents/Frameworks/MacPrintSDK.framework/Versions/A/MacPrintSDK`.
- SHA-256: `3b958667dc02b7236caad63bb27656c36fe6d57a70aea6ecd1fdf96d5506e85b`; ARM64 UUID `DFFD3A57-7846-395A-97CA-8355CA009F0D`.
- Official [REA skill](https://github.com/morluto/rea/blob/main/.agents/skills/reverse-engineer-anything/SKILL.md), REA CLI 6.7.0; approved, signed Hopper installation at `/Users/role/Applications/Hopper Disassembler.app`. No Codex/client registration or security-setting change.
- Mach-O evidence `ev_c47ee3eab1c3f985f86055d7265c0f1af0948bd1a88f29b50c75da2f8f6953fd`.
- Page-control evidence `ev_f7024237e2b57cd0783b21e2eee0408d5c9427449c719415f74057721ab519af`; page stream `ev_0f55516f9ec1ceef069118459164abab7adbe3be286d828716bd56b98e3a3f00`; print-info assembly `ev_48d6a181672d65022b8cf926bfba23889769121694587326406d21d95cb6c3a5`.
- Raw REA bundle: `/private/tmp/qr-rea-native-evidence-bundle.json`. Private derived pseudocode and full vendor analysis remain outside the repository. One large legacy-profile decompilation timed out; its unchanged request was not repeated. The session was closed with verified owned-process cleanup.
- A separate offline process constructed the exact D610 model profile and selected the SDK paper named `12 mm`, key 11. It called only model/paper/raster command builders, with no device objects or I/O calls. Source `/private/tmp/qr-rea-offline-commands.cpp`; result `/private/tmp/qr-rea-offline-12mm-confirmed.txt`. These are generated SDK headers with explicit test settings, not captured P-touch runtime bytes.
- Independent static review: `/private/tmp/qr-review-d610-page-semantics.md`, exact profile at universal offset `0x61b220`, 3649 bytes, SHA-256 `93f742bc01aa02e18a8e3bda74f2947e2307641bb5728caa2e1eb7390b958b1d`.

| Page | Info n9 | Raster terminator |
| --- | --- | --- |
| Single | `02` | `1A` |
| First | `00` | `0C` |
| Middle | `01` | `0C` |
| Final | `02` | `1A` |

The native D610 profile uses PAGE_START_NEXT_END and END_NORMAL. Its page controls repeat K → M → cut interval → copies → margin → compression. Offline SDK execution confirms four-byte `1B 69 4B 00` for chain and `1B 69 4B 08` for final cutting; the upstream extra NUL is not SDK-required. The earlier probes incorrectly treated every page as final. This finding does not yet establish the correct live batching/response pacing or safe automatic finalization after an intermediate page.

The cancellation entry marks a flag; the active SDK loop later sends 200 NUL bytes plus ESC @ for D610 protocol 94. This is a reset/cancel path, not a feed/cut operation. The [Brother model FAQ](https://support.brother.com/g/b/faqend.aspx?c=gb&faqid=faqp00001298_004&ftype3=100219&lang=en&pfs=1&prod=d610bteuk) explains manual Shift+Preview → Feed & Cut for a held final label. A previously rejected zero-raster finish remains unsupported. No arbitrary finish command was tried during this SDK investigation.

## Live capture boundary and SDK-only continuation

Both ordinary attachment and the explicitly authorized administrator LLDB attachment were denied by macOS. The user authenticated directly in Ghostty; LLDB reported no target. The passive [capture script](capture_usb.py) never loaded, and its local log remained empty. The user quit LLDB and clarified that SDK work should continue. Do not repeat attachment through another mechanism, re-sign the vendor app, enable developer mode, or change SIP or other macOS security settings.

The replacement investigation uses a separate process and the installed SDK's pure command builders, without constructing a device connection or calling hardware I/O. It is generated SDK output, not a live P-touch capture. The exact 12 mm profile and accepted 194×76 / 21 px Gotham bitmap produce two explicit pages with software copies 1 and job count 2. Each compressed G row independently decodes to the approved 16-byte head data; all 194 rows per page match exactly and the reconstructed QR decodes as `c62a82d7`.

Native first-page setup is 200 NUL bytes → raster mode 01 → ESC @ → notification mode 00 → stored-up-print 01 → first header/raster/0C. The final page uses final header/raster/1A. The SDK waits for a type-6 receive-phase (phase type 0) after each page; a type-1 acknowledgement alone does not authorize the next page. After the final wait it sends `1B 69 61 FF`. The receive notification still does not establish physical ejection or a clear tape path.

An isolated two-label probe is prepared, with a durable intent before every send, a shared Web Lock, no automatic retries or reload continuation, and provisional per-page receipts. Stop prevents further page content and performs no implicit flush/feed. Nine transport safety cases cover phase pacing, type-1 rejection, persistence failure, Stop, short writes, stale notifications, phase regressions and setup settlement. Separate VM page cases cover stale tabs, immutable existing receipts, per-page uncertainty before output, controlled Stop and no reload continuation. The physical two-page batch passed; automatic Stop release and remaining-only physical recovery remain open. No default helper change is enabled.

## Preserved behavior

All 26 source/test files in the pre-chain snapshot remain byte-identical. Approved Gotham/Medium Small pixels, current transport, journal, Stop and recovery are unchanged. No source/test build is newly claimed for documentation-only evidence; syntax and diff/reference checks apply to this follow-up. No commit, push, migration application or deployment.

## SDK hardware results and next bounded gate

- Two-page test `95e44e2a-dad8-495f-bce2-d03d2118cbdd`: both printing→receive transitions arrived, and the user confirmed two good FB FX3 1 labels with one initial blank and none between. The original receipt and physical observation remain separate.
- Controlled Stop `063008bd-f133-4f41-9dfa-423513b3b52c`: only page 0 of a three-page queue was sent. Stop closed without feed/cancel or further content; two pages remain host-unsent. The user observed one blank and no complete label. Page 0 remains uncertain and must not be replayed. This rejects an automatic Stop-completion claim.
- Next prepared experiment: a single SDK-generated final page containing four all-zero 16-byte raster rows (59 wire bytes, SHA-256 `c244a46c4d00762592292b3ad3a1b911e9dca73171887883133bbbd8d2b8d404`). It is an explicit experimental feed candidate, not an exposed native finish API. It contains no text or QR pixels, starts no new initialization, and has a separate durable, one-attempt finish intent on the stopped receipt. It was sent once after independent review; the user confirmed one good held label plus one blank strip. No text or QR pixels were resent.
- Evidence for the blank-row strategy: [ptouch-rs session feed_and_cut](https://github.com/vowstar/ptouch-rs/blob/main/crates/ptouch-core/src/session.rs), inspected blob `06335a0588a77e82dc9d1d09d1866be39abf1f94`; [Brother D610 Feed Tape](https://support.brother.com/g/s/es/htmldoc/ptouch/d610bt/usen/html/guid-51505849-b9de-42eb-afc1-5c62df528914_1.html) documents manual Feed & Cut. The related-model raster reference explicitly warns that intermediate completion can precede actual finishing; it is not substituted for exact D610 hardware proof.

After-only [local SDK review](review.html), downloaded raw receipts, physical-observation record, test sources and isolated probe snapshot are retained here. No vendor binary or decompiled pseudocode was copied into the repository. The probe snapshot is evidence, not a supported product interface.

The original one-row feed candidate was rejected before output because it was below the native 4.4 mm length guard. Four blank rows pass the actual pure SDK `checkLabelLengthLimit` call with the selected 12 mm Paper and exact D610 Spec (min 44 tenths mm, margin 20 tenths mm, 180 dpi). Both designs contain zero ink. The one-row design was never sent; the four-row design was sent once and physically released the held label plus a blank. Shared-key probe writers now use CAS, including stale Connect and physical-review paths; a stale Stop-page Connect regression preserves the finish marker before any USB status write.

## Remaining-only recovery and browser encoder preparation

The user confirmed the four-row feed released the held FB FX3 1 label plus a blank strip. That physically resolves only the original first copy; the two original unsent copies remain separate. The isolated recovery interface stored a child snapshot in the same CAS-protected receipt, then a reload retained that prepared child with printing disabled until an explicit connection/run action. Child `1c7f380b-debd-441b-9bca-206aa31ac726` references only original source pages `[1,2]`; the original first page is excluded. Both child USB printing→receive transitions arrived, and its physical count is pending. No automatic continuation occurred.

The pure browser encoder draft reproduces all bytes of the five reviewed two-/three-page SDK packets and the 59-byte four-row feed. No Brother runtime would be required by this draft. It is not imported by the helper. Full product integration still needs provisional-copy state, durable feed intent, atomic final settlement, multiple-copy physical review, operator authorization, failure tests, fixture UI proof and integrated hardware acceptance.

The feed experiment validates an explicit separate feed after Stop, not an already integrated automatic Stop path. Normal batches retain one initial leader; this early-Stop release also costs a blank strip. The current helper default still uses its accepted independent-label path.
