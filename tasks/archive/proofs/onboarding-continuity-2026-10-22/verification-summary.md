# Local acceptance evidence

- 7 browser cases pass: trusted two-finger touch, drag/wheel, keyboard recovery, crop retry, off-center preview/export pixels, save ordering, conflict recovery, photo-free Finish and checklist sync with denied storage.
- 8 disposable-PostgreSQL integration cases pass. No hosted student account or production database was used.
- 105 focused API/profile/avatar/image/audit-inventory tests pass.
- 780 Swift source-contract tests pass across 148 files.
- 10 native model/image XCTest cases pass, including actual off-center exported pixels and fractional server receipt dates.
- 2 final iPhone 18 Pro Max, iOS 27.0 UI scenarios pass: pinch/drag/retry and required student setup through photo skip/finish. Installed private-bundle Swift source matches the final source byte-for-byte.
- TypeScript, current native build, app build, Xcode registration, schema validation and 201 migration-prefix checks pass. Repository lint reports 43 existing warnings and no errors; crop editor/browser spec lint cleanly.
- Codemaps/docs and git diff --check pass.
- Read-only schema/API and crop reviews found no unresolved blockers. The requested off-center pixel assertions were added and pass on both clients.

## Remaining gates

Authenticated web-to-iOS and iOS-to-web continuation awaits this branch's own Managed preview. Creating it requires an authorized commit, push and draft PR; D-063 prohibits borrowing another branch environment or production credentials. Physical photo-library behavior, migration deployment and native distribution remain unverified.

The local HTML review is self-contained and queued in Codex. Browser rendering was blocked by its local-file URL policy; generated HTML and all selected source images were inspected without a browser workaround.
