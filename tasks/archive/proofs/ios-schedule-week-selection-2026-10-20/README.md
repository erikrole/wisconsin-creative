# Schedule week-selection proof

Base: 576058716e17649fb34650a61e000e13caf477ae. Local branch: codex/schedule-week-selection.

Open review.html for the matched comparison and verification boundaries. verification.json records the actual gates. The paired source snapshots include an identical temporary native capture method; this method was removed from the test source after capture. capture-harness.swift retains both capture scenarios. The before snapshot has the original bottom expression moved to its production owner without a behavior change. The native negative control selected October 27 instead of October 20.

The long-list capture clears the Sport filter through the real All Sports menu, scrolls until Today appears, taps it, and asserts Today disappears. window-geometry.txt records the measured logical viewport, locale and timezone.

Native: IOS_TEST_DESTINATION='platform=iOS Simulator,id=8FA58E18-C447-4C75-8A9F-14E19BCB6AE9' npm run ios:xcode:verify

Source contracts: node node_modules/vitest/vitest.mjs run tests/ios-schedule-*.test.ts tests/ios-current-day-rollover.test.ts

No distribution action is part of this fix.

Source snapshots and the applyable fix are stored as `.patch.gz` files. Receipt `sourcePatchSha256` values hash the decompressed source snapshot bytes; those bytes are preserved exactly.
