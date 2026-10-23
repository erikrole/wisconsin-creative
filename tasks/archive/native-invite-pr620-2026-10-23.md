# Native invite-link signup for PR #620

Scope authorized 2026-10-23: students must finish signup natively against PR #620; no commit/push/merge/deployment/App Store or TestFlight release. Preserve existing local security review fixes. No production data or Neon changes.

Base head: 7bf5f38658611eb7da72a71c482f1514b7e03bc8, branch claude/project-thread-wz96o0.

Plan:
1. Add strict, memory-only native intake for the existing HTTPS invite link and token-aware discover/register/resend Codable contracts.
2. Route signed-out links through native discovery, preserve same-person registration input on a refreshed link, handle stale async discovery, and require explicit sign-out for an existing session.
3. Add native missing/expired-link recovery and retain legacy-server discovery tolerance without weakening server inbox proof.
4. Verify real Swift request serialization/response handling, trusted link parsing and UI lifecycle using existing unit/fixture infrastructure. Run affected source contracts, XcodeGen consistency, iPhone 18 Pro Max build/tests, TypeScript/lint/app build for the associated-domain change, and docs checks.
5. Save local native UI evidence and update the review/mobile contracts, distinguishing fixtures from live database/inbox/device association/distribution proof.

Owners: native APIClient + SessionStore, LoginView/NativeAuthViews, WisconsinApp link entry, a dedicated invite-link/resend component, narrow AASA /login?invite match. ios/project.yml remains the project source of truth. Independent final security/client review is required; implementation stays in this task.

Status: **LOCAL READY, UNRELEASED**. The authorized local implementation and verification are complete. External rollout gates below remain open; no merge or release is authorized.

## Implemented outcome

- Accept canonical HTTPS emailed invites without persisting/logging their token. Reject other hosts, ambiguous duplicate proof, fragments, browser-owned links and malformed input.
- Forward the email-bound token through the actual Swift discover/register requests. Decode missing/expired proof as recovery and keep older-server discovery compatibility.
- Offer native resend for missing/expired links, with truthful unavailable, malformed-response and rate-limit handling. A fresh same-address link preserves entered fields and removes the old link's warning; stale requests cannot replace the latest intent.
- Require explicit sign-out before using an invitation while signed in. Existing operational deep links remain intact.
- Keep the email's primary action/raw fallback in the browser with the ordered AASA `web=1` exclusion. The updated-app action is separate. This protects an existing 1.4 install from losing its browser setup path.
- Register new Swift files through XcodeGen; keep `project.yml` and the existing schemes unchanged. Add the shared recovery component to the native audit inventory.

## Verification and evidence

- **29 Swift tests passed**: parser trust boundaries, invite discovery/serialization, typed 403 recovery, unavailable/malformed resend, session preservation and existing deep-link/latest-request contracts. The test host explicitly used the DB-free login fixture mode.
- **4 native UI scenarios passed** on an isolated iPhone 18 Pro Max, iOS 27.0: cold valid invite reaches Welcome; missing link resends once/Change resets/opens the incoming link; expired submit preserves fields and accepts a fresh link; unconfigured and rate-limited responses stay honest. After the last view fix, the expired-link scenario passed again with an explicit assertion that the obsolete warning disappears.
- **861 native/companion and email contracts passed across 163 files**. The new shared component's audit inventory registration was corrected after the initial inventory check failed.
- Simulator build and **unsigned generic iOS Release build passed**. TypeScript, changed-file ESLint and DB-free `build:app` passed. No migration-running build was used.
- XcodeGen consistency, generated codemaps, docs verification, relative-link sweep and `git diff --check` passed. The local HTML review rendered offline with all 9 images loaded and no horizontal overflow.
- Necessary independent native/security review found older-client URL interception and stale form-error risks; both were addressed. Simulator inspection also caught keyboard coverage of Create account, fixed by system keyboard avoidance for registration.
- The first warm-link test driver restarted the app. The correct system driver then exposed an unrelated preview install owning the same scheme. Final warm delivery used an isolated instance of the same required model, preserving the original simulator/apps/data.

[Local UI review](proofs/native-invite-pr620-2026-10-23/review.html) · [safe verification receipt](proofs/native-invite-pr620-2026-10-23/verification.json) · [capture manifest](proofs/native-invite-pr620-2026-10-23/capture-manifest.json).

All native API calls in these scenarios were fixture intercepted. Cold entry used a fixture launch URL; warm entry used the DEBUG-only custom bridge into the real HTTPS parser. This proves native intake, request/response handling and UI recovery, not Apple association/CDN routing or durable server mutation. Screenshots are after-only; earlier keyboard diagnostics are retained, but unmeasured final scroll offsets prevent a trustworthy matched-pair receipt.

## Rollout boundary and 1.4 answer

GitHub PR #620 remains draft/open/unmerged at the head/base above. Hosted CI does not contain these local edits. The current production signup contract was not changed by this task. Released **1.4 (36) cannot send the proof required by #620**; enabling that backend contract would prevent native first-time account creation in the old binary. The local fix needs a future native update. Browser account creation followed by native sign-in remains the compatibility path; it does not add invite-aware signup to 1.4.

Before coordinated rollout, separately verify real token delivery, real shared-backend registration, physical-device associated-domain behavior and the updated native distribution. Do not remove inbox proof for compatibility. No production data, Neon integration, preview environment, invitation, email, release setting or existing App Store release was changed.

## Test-value / diff audit

No tests were deleted. Tests protect the real parser, Swift request serialization/Codable boundary, inbox-proof/API contract, session safety and native recovery UI. New fixture code is DEBUG-only and uses the existing network interception infrastructure. Final local diff, including the earlier security fixes: production/support **383 added / 49 removed**; tests/fixture source **486 added / 9 removed**. Per-file counts are in `proofs/native-invite-pr620-2026-10-23/local-change-size.json`.

Stop here. No staging, commit, push, merge, deployment, TestFlight or App Store action was performed or is authorized by this slice.


2026-10-23 follow-up: the user authorized committing/pushing this reviewed slice to #620 and using its owned Managed preview for remaining checks. See [active rollout ledger](../pr620-rollout-checks-2026-10-23.md). The merge, production and distribution holds remain in force.
