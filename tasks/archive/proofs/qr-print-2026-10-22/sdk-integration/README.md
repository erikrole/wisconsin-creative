# SDK chain integration evidence

[Open the review](review.html). This is local source/browser/hardware acceptance, not production release.

- [Physical observations](physical-observations.json): older forgotten count stays unverified; fresh prototype A→Stop→B/C and integrated six-kind/A-B→Stop→C counts are separately recorded.
- [Verification](verification.json), [109 focused tests](focused-tests.txt), [app build](build.txt), [Stop-during-checkpoint cases](stop-checkpoint-tests.txt). The real PostgreSQL run passed 11 cases on a fresh disposable loopback database; it is now stopped.
- Exact per-copy integrated receipts: `label-print-*.json`. They contain authenticated-API fixture Dev Staff attribution; no production-authenticated identity is claimed.
- [Source manifest](source-manifest.json), [integration patch](integration.patch), [before archive](before-source.tar.gz), [after archive](after-source.tar.gz). Native vendor analysis/binaries are excluded.
- [Matched before capture receipt](before-evidence.json), [matched after capture receipt](after-evidence.json). Native JPEG captures are preserved; PNG conversion changes only encoding.
- `phone.png` is after-only 390 CSS px smoke evidence, with no horizontal overflow; the screenshot excludes browser scrollbar pixels.

The pure browser encoder matches all five SDK two-/three-page reference packets byte for byte and the four-zero-row 59-byte feed. Protocol review and source-bound hardware proof precede enabling the local default. Printer receive phase is provisional until the final feed; no automatic reconnect/reload/error feed or pixel replay exists.

No macOS security settings changed. No application database migration, stage, commit, push, merge or deployment occurred.
