# Latest iPhone UI evidence

The review is local and self-contained. Captures use the DEBUG latest-browse harness, never a production session. Launch with GT_PERFORMANCE_SCENARIO=latest-browse and GT_BROWSE_DESTINATION set to the named route. GT_BROWSE_OFFLINE=1 selects the offline banner; 0 selects connected presentation. Unknown API requests stay intercepted locally.

The baseline was created from f022d861139949ef8409ab8cbaf009b9701254bf plus the preserved pre-UI hardening patch in /tmp/wisconsin-ios-device-20261017/pre-ui/source.patch. It received the same corrected fixture files as the after build. The active checkout was never restored or replaced to make a baseline. The baseline source is retained at /tmp/wisconsin-ios-device-20261017/pre-ui-source/.

The before-ui.patch, after-ui.patch, after-navigation.patch, and final-ui.patch files retain the source states. The after source manifest was saved before the navigation removal and final review-row adjustment. Reconstruction of the two changed files was checked byte-for-byte against every manifest entry before the comparison patches were emitted. Hashes in each receipt refer to these actual retained patch files. The final patch includes the separate review controls; interaction captures of those controls are after-only.

Capture procedure: install the relevant .app, stop it, launch the route with fixture environment, wait for settled runtime UI, then xcrun simctl io 795AB4E9-3E4A-4C13-9D4F-27FD822C190B screenshot. Source dimensions are verified from the device runtime: 1320x2868 pixels, scale 3, 440x956 points. The status bar is fixed to 9:41; date-relative inputs share the same capture day. Blasts comparisons both show 4h ago. The launch-relative event fixture is excluded from the comparison set.

Receipts are created and validated with .agents/skills/gt-ui-review/assets/build_review_page.py. Each pair has identical declared capture settings. Each selected image was inspected. The browser blocks file URLs, so the HTML layout was not independently browser-rendered. Its generated structure, embedded PNGs, source links, and receipts were checked; opening in the Codex file panel was queued.

Build and test logs: /tmp/wisconsin-ios-device-20261017/. Native final result: final-picker-tests.xcresult (222/222). Web-side Swift contracts: all-ios-contracts-final.log (715/715). Hardware and authenticated behavior are separate from these fixture captures.
