# Native onboarding visual refinement — 2026-09-28

## Direction and scope

The user requested substantially more polish, Apple-like design, and animation between screens, explicitly invoking frontend-design and apple-design. Native SwiftUI patterns supply the platform implementation. Preserve Wisconsin brand tokens, invitation and profile contracts, the prior usability improvements, and unrelated checkout changes.

Bounded plan: preserve the previous pass as baseline; unify account/profile hierarchy and inputs; animate whole pages with direction-aware forward/Back transitions; verify native build, interaction/recovery, motion, light/dark appearance and larger text; publish local evidence only.

## Implementation

- Shared centered SF Symbol, large system title, and supporting description.
- Adaptive white/dark backgrounds with inset soft form surfaces; no new dependencies.
- Compact segmented progress, a rounded primary action, and a native material footer.
- Stable header/footer with a keyed scroll page in a transition-owning ZStack; 0.34-second restrained spring and directional offsets. Reduced Motion uses a 0.12-second opacity-only transition and unanimated progress.
- Keyboard stays closed on arrival and dismisses before Continue. VoiceOver receives a grouped step heading after transition; actual VoiceOver/device acceptance is pending.
- Existing required data, optional steps, API writes, snooze and draft preservation remain intact.

## Verification

- Native simulator build and 20 affected source-contract tests passed.
- Final Xcode build and three onboarding UI tests passed (30.865 seconds, zero failures).
- Light/dark mode, larger text and forward/Back motion frames visually inspected. Native drift, docs verification and whitespace checks passed.
- No real accounts created or profile data written; fixture mutations intentionally fail locally.
- Physical-device AutoFill/photo, live persistence and distribution are unverified.

## Evidence provenance

Baseline is the preceding usability pass, not Git HEAD. Its source snapshot and new before captures are retained here. Compare the same fixture, iPhone 18 Pro Max / iOS 27, 440×956pt viewport (1320×2868px at 3×), locale, and initial scroll. Initial keyboard behavior changes intentionally with this revision.

The previous local HTML browser request was blocked by the file-URL policy. Do not retry through another browser route. Inspect native image/video frames and HTML structure, and expose the generated report as a local artifact.

## Review artifacts

- [Matched visual review](review.html)
- [Native step transitions](step-transitions.mp4)
- Source snapshots, image receipts and verification logs are retained alongside the review.
- Motion recording precedes the final keyboard-dismiss and accessibility grouping tweaks; transition code is unchanged.
- Runtime VoiceOver and Reduce Motion acceptance remain unverified.
