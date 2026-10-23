# PR #620 rollout checks

User authorized 2026-10-23: finish remaining rollout checks for six-student readiness; commit/push the reviewed fixes to PR #620 and use only its branch-owned Managed preview. Two test emails (invite and refreshed link) may go to the user-approved inbox. Do not send to students. Merge, production deployment, TestFlight and App Store release remain on hold.

Plan:
1. Verify exact PR head/base, preserve existing work, and exercise invite claims/session persistence/concurrency plus migration compatibility in the existing owned disposable PostgreSQL harness.
2. Review and commit only this slice, push to PR #620, and obtain its exact-head CI and Managed preview through the supported workflow. Never borrow another branch's preview or production credentials.
3. Use synthetic preview data and the approved inbox for invite delivery, rotation, invalidated-link rejection and first-time setup. Record only safe receipts, never raw links/tokens/passwords.
4. Verify the fixed native client against the same preview and physical-device link handling where available. Check canonical AASA/CDN readiness without deploying production. Record any deployment/device dependencies explicitly.
5. Update local evidence and readiness gates. Stop before merge/release.

Starting PR head 7bf5f38658611eb7da72a71c482f1514b7e03bc8; base ab9aa36bc8899aaa500ab94fc1a134518284a386. Existing local fixes are uncommitted. CI on the remote head passed; no Managed preview run is present. Both paired physical iPhones currently report an unavailable tunnel. The required simulator model is available.

Test value: existing mocks cannot prove PostgreSQL rollback, concurrent claim uniqueness, persisted sessions or SQL migration behavior. Add only database-boundary checks using the existing isolated cluster guard; no production-only seam. Keep inbox/device/provider proof separate from local database proof.

Status: fixes pushed; required CI passed; Managed preview capacity blocked. Live rollout checks remain incomplete. See the current [Claude handoff](../docs/handoff/claude-pr620-rollout-2026-10-23.md).

Local PostgreSQL proof: 13 tests passed (5 invitation/signup/migration checks plus 8 existing onboarding continuity checks). Actual HMAC/bcrypt, Prisma writes, sessions and audit rows were used; only framework cookie context and rate-limit gating were supplied. A rotated in-flight token rolls back user creation; concurrent claims commit one account/session; expired/reused proof cannot claim; 0203 preserves legacy rows and enforces nullable unique hashes. Cluster was Unix-socket-only, then stopped and removed.

Managed previews intentionally clear RESEND_API_KEY and do not permit production credentials. The approved live-mail test still needs a supported test-mail provider capability; do not disable that guard or inject production mail secrets into preview. Public canonical associated-domain activation also remains dependent on a later authorized production deployment.

The user has been asked to connect/unlock a physical iPhone; no physical install occurred yet.


## Claude handoff checkpoint — 2026-10-23, 16:09 UTC

User requested a Claude handoff. Pushed head is `39fe95555f2da6874e69ba2dd53a6f0c6ae983ff`, base `ab9aa36bc8899aaa500ab94fc1a134518284a386`. PR #620 remains draft/open/unmerged. Commits `f24ca5c...` and `39fe955...` include the reviewed implementation, PostgreSQL checks and losslessly compressed patch evidence. No further commit/push is needed to deliver this local handoff.

[CI 39982277480](https://github.com/erikrole/wisconsin-creative/actions/runs/39982277480) passed both validate and postgres-integrity. The immediately subsequent [Managed previews run 39983517196](https://github.com/erikrole/wisconsin-creative/actions/runs/39983517196) failed provisioning because all nine preview slots are occupied. Its run metadata records trusted main rather than the feature branch; confirm the triggering PR before retrying. No manual provisioning, cleanup or settings change was performed.

Physical iPhone 16 Pro details became readable after the user's “Go”; no install/launch/link/signup action occurred. `.tmp/pr620-rollout/hosted-qa.mjs` is prepared and syntax-checked but unexecuted; no hosted synthetic invites or private context exist yet. No test email was sent. Managed-preview mail isolation, supported test-mail capability, real native/backend signup, physical association and updated distribution remain distinct gates. Production/Apple CDN still lacked the new invite association rules when checked. Merge, production and native distribution remain on hold.

The handoff and this checkpoint are local/uncommitted. Historical receipts keep their original pre-push scope; use the current handoff for latest state.

Handoff validation: `npm run verify:docs` passed (codemaps current); both handoff/ledger relative-link and whitespace sweeps passed; complete PR `git diff --check` passed. No application code changed during handoff preparation.
