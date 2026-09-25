---
name: gt-ios-slice
description: "Implement a Wisconsin Creative native iOS or WisconsinKiosk change with API, lifecycle, and target verification."
---

# GT iOS Slice

Implement the requested native outcome using existing SwiftUI and product patterns. `AGENTS.md` owns shared policy and proof. Inspect the actual view/store/model/client and server envelope, plus relevant `docs/AREA_MOBILE.md` and owner contracts.

1. Identify the affected target and supported baseline from the project, current scripts, and mobile area doc. Keep native workflows native and kiosk custody in kiosk.
2. Plan a coherent slice; a small fix does not require a separate broad audit. Preserve unrelated native and fixture-harness changes.
3. Keep loading/stale/error/pending/success states honest. Preserve entered data across failures and interruptions; reconcile uncertain writes before dismissal or retry. Check cancellation, scene refresh, and duplicate actions when touched.
4. Compare actual API responses with Swift Codable models, nullability, envelopes, and rollout skew. Register new files in the correct existing project/target; inspect the current generation convention before manual project-file edits.
5. Use the affected project/build/source-contract tests from `package.json` and the `AGENTS.md` matrix. The default is iPhone 18 Pro Max for `Wisconsin` and iPad Air 11-inch (M4) on iOS 26.5 for `WisconsinKiosk`. Never substitute another model merely because it is booted.
6. Use `gt-ui-review` for matched visual evidence. Isolated fixture screenshots prove rendering, not authenticated server behavior or durable mutation. Hardware-only camera, passkey, push, scanner, and custody proof remains device-specific.

Report source/test, build, simulator, authenticated lifecycle, physical-device, and distribution evidence separately. Readiness cannot be inferred from TypeScript tests or source edits alone. Sync affected documentation without marking undeployed work as production-shipped.
