# iOS onboarding ease — 2026-09-28

## Scope and contract

User requested overall first run, account creation, and filling profile data to feel easy rather than like a chore. Primary workflow: gt-ios-slice; gt-ui-review for visual evidence and gt-test-audit for regression coverage. Existing D-037/D-051 invitation, role, readiness, snooze, and photo contracts remain authoritative.

Bounded plan: inspect account/profile entry and server contracts; preserve the dirty checkout baseline; simplify account fields and profile actions; fix phone paste and visible-step navigation; verify builds, behavioral tests, rendered comparison, and recovery.

## Implementation

- One password entry, show/hide control, new-password AutoFill, and neutral minimum-length guidance. Existing invite email stays locked.
- One progress count, full-width primary action, helpful purpose-led prompts, and explicit optional profile details.
- Resume accepts only role-visible steps. Continue moves forward after revisiting a step. Each step scrolls to its heading.
- A pasted +1 US phone number keeps the ten local digits. Photo loading blocks premature finish/navigation.
- No schema, server API, or permission changes. No production accounts created or modified.

## Evidence

- Xcode Wisconsin build and 8 ProfileCompletionModelsTests passed on iPhone 18 Pro Max / iOS 27.
- 42 Vitest onboarding, recovery, API, and role-contract tests passed.
- TypeScript, targeted ESLint, and native drift checks passed.
- 3 simulator UI tests passed (33.8 seconds). Four matched screenshot pairs and after-only recovery, photo, and Accessibility Large evidence are in [the local review](review.html).
- The phone assertion fails against original Swift source with `(160) 855-5121`, confirming the dropped-digit regression.
- Real invite-to-account creation and durable profile save, physical-device password AutoFill, photo selection/crop, and distribution remain unverified.

## Baseline provenance

The baseline-source.zip preserves the pre-change native source, including pre-existing dirty and untracked Swift work. The added DEBUG fixture adapter was corrected in both baseline and final source to provide a nonempty mount and the API data envelope. The baseline was built from /tmp/wc-onboarding-baseline; no active source was swapped or reverted. Screenshots use the same fixture, device, theme, text size, status time, and scroll position. Unmapped API requests are intercepted locally; recovery tests intentionally reject writes.

The source snapshots are declared provenance; image receipts bind each captured image to its settings and snapshot hash. They are not proof of real authenticated persistence.

## Review inspection boundary

All selected native PNGs were visually inspected. The generated HTML passes embedded-image and reference checks and was queued in the Codex file panel. Browser-render inspection of the local HTML was blocked by the browser file-URL policy; no alternate browser route was attempted.
