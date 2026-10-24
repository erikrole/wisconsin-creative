# Claude handoff: PR #620 and native invitation rollout checks

Prepared 2026-10-23 at 16:09 UTC. Continue the remaining checks for six-student readiness from the existing branch. **Do not merge, deploy production, or distribute/release an iOS build.** The user requested this handoff before the remaining live checks were completed.

## Start here

- Repository: `erikrole/wisconsin-creative`; [draft PR #620](https://github.com/erikrole/wisconsin-creative/pull/620).
- Work only in `/Users/role/.codex/worktrees/security-pr620/wisconsin-creative` on `claude/project-thread-wz96o0`.
- Pushed head: `39fe95555f2da6874e69ba2dd53a6f0c6ae983ff`; base/main: `ab9aa36bc8899aaa500ab94fc1a134518284a386`. GitHub reports open, draft, unmerged and mergeable. Refresh these facts before dependent work.
- The worktree was clean before this local handoff and ledger update. These handoff edits are intentionally uncommitted; do not discard them. Application changes are already pushed.
- Preserve the original dirty checkout at `/Users/role/Code/wisconsin-creative` and the unrelated onboarding worktree. Do not borrow either one's environment.
- Read `AGENTS.md`, the repository's `gt-ios-slice` skill, [preview runbook](../PREVIEW_ENVIRONMENTS.md), [active ledger](../../tasks/pr620-rollout-checks-2026-10-23.md), and the relevant mobile/auth contracts before changes.

## Existing authorization and holds

The user explicitly approved committing/pushing these reviewed fixes to #620 and using **only this branch's Managed preview**. The earlier review handoff's prohibition on a preview database is superseded for this branch-owned environment. Do not ask again for the same push/preview authorization.

The user approved two product test messages (one invitation and one refreshed link) to one inbox they control. The recipient is stored in the ignored, local `.tmp/pr620-rollout/operator-handoff.json`; it is not a credential. No test message has been sent. No real student has been invited or modified. Do not send to the six students.

The user also approved connecting/unlocking the physical iPhone 16 Pro for link checks and replied “Go.” A read of that device subsequently succeeded. No app install, launch, signup or link action has occurred on it.

**Merge, production deployment/data changes, TestFlight/App Store upload or release, repository/settings changes, and preview cleanup remain on hold.** Do not change release settings, weaken inbox proof, inject production credentials into previews, or provision manually. Obtain a separate decision if an action outside these approvals is needed.

## Current outcome and evidence

Two commits were pushed:

1. `f24ca5c21c9b06c2f4ddea7a242cd48c9527472b` — `fix: complete native invite signup and protect invitation claims`.
2. `39fe95555f2da6874e69ba2dd53a6f0c6ae983ff` — `chore: preserve review patches as lossless evidence archives` (packaging only).

Native intake now validates canonical HTTPS invitation URLs in memory, forwards proof through discover/register, recovers from missing/expired proof, preserves fields on a fresh same-address link, rejects stale discovery results, and asks before signing out an existing session. Tokens are not persisted or logged. Existing operational links remain intact. New Swift files are registered through XcodeGen; `ios/project.yml` is the source of truth.

Key code: `ios/Wisconsin/Core/AuthInviteLink.swift`, `APIClient+Auth.swift`, `APIClient.swift`, `SessionStore.swift`, `App/WisconsinApp.swift`, `Views/LoginView.swift`, `NativeAuthViews.swift`, and `InviteLinkResendButton.swift`.

The email's primary browser action and raw fallback include `web=1`; the ordered AASA exclusion precedes the `/login` invite claim. A separate action opens the updated iPhone app. Server fixes make claiming conditional on the exact unclaimed, unexpired token inside a Serializable transaction, prevent issuance after claim, contain preparation failures within the delivery-status contract, and prevent false “sent” UI.

Verified gates:

| Gate | Evidence and limit |
| --- | --- |
| Native unit | 29 Swift tests passed. |
| Native UI | Four scenarios passed on isolated iPhone 18 Pro Max, iOS 27.0; final stale-warning regression reran successfully. All network calls were fixture intercepted. |
| Native/email contracts | 861 tests across 163 files passed. |
| Builds | Simulator, unsigned generic iOS Release, TypeScript, changed-file ESLint and DB-free `build:app` passed. XcodeGen consistency passed. |
| Database boundary | 13 real PostgreSQL checks passed: five invite/migration checks plus eight existing continuity checks. Actual HMAC, bcrypt, Prisma writes, sessions and audit rows; cookie context and rate-limit gating supplied. |
| Migration | 208 migration prefixes checked. Actual 0203 SQL was exercised only on an isolated legacy-table schema. No application/production database migration was run locally. |
| Independent review | Required native/security and concurrency reviews completed; findings were addressed. |
| Docs/evidence | Docs/codemaps, references and complete PR whitespace check passed before handoff; handoff-specific checks are recorded in the active ledger. |

The PostgreSQL cluster used a private Unix socket, was stopped and removed, and accepted no application database URL. It proved rollback after token rotation during hashing, exactly one concurrent account/session, expired/reused-proof rejection, legacy nullable-column compatibility and the unique token index. Log: `/private/tmp/wc-pr620-rollout-postgres-final.log`.

- [Native UI review](../../tasks/archive/proofs/native-invite-pr620-2026-10-23/review.html).
- [Native implementation ledger](../../tasks/archive/native-invite-pr620-2026-10-23.md) and [historical verification receipt](../../tasks/archive/proofs/native-invite-pr620-2026-10-23/verification.json).
- [Original security review and fixes](codex-security-review-pr-620-results.md) and [web review](../../tasks/archive/proofs/security-pr620-2026-10-23/review.html).

Older receipts/results describe the pre-push, fixture-only checkpoint. Their claims of “uncommitted” and “PostgreSQL not executed” are historical; this handoff and the active ledger describe the latest status. Live shared-backend, inbox and physical association gates remain open. Evidence `.patch.gz` files preserve original patch bytes; inspect with `gzip -dc`. Do not strip patch contents or change capture hashes.

## CI passed; Managed preview is blocked

[CI run 39982277480](https://github.com/erikrole/wisconsin-creative/actions/runs/39982277480) passed on pushed head `39fe955...`: both `validate` (job 120512531030) and `postgres-integrity` (120512530608) succeeded. Tests, audit gate, release note, migration guard and `build:app` passed. Hosted iOS was skipped; local native proof is listed above.

The latest automated [Managed previews run 39983517196](https://github.com/erikrole/wisconsin-creative/actions/runs/39983517196), starting immediately after that CI completion, failed at “Provision and upload exact validated PR” (job 120516645080):

> Refusing to create a preview branch: 9 preview branches already exist (limit 9). Merge or close old PRs, or run Preview cleanup, then retry.

This is an infrastructure capacity blocker. Do not close/merge unrelated PRs or run mutating cleanup under the rollout approval. The workflow metadata uses trusted `main` and has no PR association in its run record; confirm the triggering PR/head before retrying or attesting a deployment. No owned preview was attached or declared Ready in this task.

List workflow runs without a branch filter: `gh run list --workflow managed-previews.yml --limit 8 --json databaseId,headSha,headBranch,event,status,conclusion,url`. These are `workflow_run` events running trusted main orchestration, so filtering by the feature branch or using the connector's commit-workflow listing misses them.

Once capacity is resolved through an authorized path and the correct hosted run succeeds, use `npm run preview:setup` and `npm run preview:doctor`. For local web proof use `npm run dev:preview` then `npm run auth:local` and the printed URL. Never reset another branch or bypass the wrappers. Recheck head/base and deployment attestation; a changed candidate can invalidate live proof.

## Remaining live gates

1. **Owned hosted backend:** Attach only the successfully attested #620 preview. Exercise synthetic first-time signup, rotated/missing/expired/reused proof, session persistence, audit and account state against that deployment. No hosted test rows have been created yet.
2. **Real product email:** Managed previews deliberately block `RESEND_API_KEY` and outbound integrations (`scripts/lib/preview-environment.mjs`, `scripts/deploy-managed-preview.mjs`, `src/lib/environment-safety.ts`). No existing provider key or dedicated Resend capability was found. User approval for two test messages persists, but a supported test-mail capability is still missing. Do not bypass preview isolation or substitute Gmail/Outlook sending and call that Resend proof.
3. **Real native/backend flow:** Use the same owned preview and synthetic account. DEBUG overrides `WC_PREVIEW_ORIGIN` (validated HTTPS `*.vercel.app`) and `WC_PREVIEW_ACCESS_TOKEN` (short-lived, exact-origin OIDC) are supported. Keep values out of evidence, logs and command text. The parser accepts canonical Wisconsin URLs only; delivering that URL explicitly while API calls target the preview proves client intake/backend behavior, not OS association.
4. **Physical iPhone:** Required iPhone 16 Pro was reachable with Developer Mode enabled on iOS 27.2. Device identity is in the private operator note; details are `/private/tmp/wc-pr620-physical16-details.json`. Recheck connectivity and installed Wisconsin bundle IDs first. Preserve the production App Store app; do not overwrite it just to run a dev build. No physical app proof exists yet.
5. **Canonical association/distribution:** Both production AASA and Apple's CDN returned the existing appID `T26T3G8C7Q.com.erikrole.Wisconsin`, but neither had the new `/login` invite/`web=1` rules when checked. Verify again when rollout is separately authorized. Their URLs are `https://wisconsincreative.com/.well-known/apple-app-site-association` and `https://app-site-association.cdn-apple.com/a/v1/wisconsincreative.com`. Actual universal-link activation and an updated distributed app require later deployment/release; do not deploy now to pass this gate.

The released **1.4 (36) binary does not contain this fix** and cannot submit the proof #620 requires for native first-time signup after the backend change ships. Browser setup followed by native sign-in is the compatibility path. Today's production signup was unchanged by this unmerged work. Do not state that native onboarding for the six students is fully ready.

## Prepared local QA driver: not executed

Ignored `.tmp/pr620-rollout/hosted-qa.mjs` has passed syntax checking only. Read it before use. Its prerequisites are the correct attached preview and `WC_QA_DEPLOYMENT_ID`.

It verifies owned database state and deployment metadata, obtains short-lived OIDC, signs into the synthetic preview admin, creates six synthetic `@creative.local` invitations with `sendInvite:false`, seeds token hashes only on its newly created rows, checks missing/rotated proof rejection and confirms mail is disabled. The first account is reserved for the actual native client. It does **not** finish all six registrations or prove email delivery. Strengthen any missing exact-source/head check before execution.

It will create `.tmp/pr620-rollout/private-context.json` containing test credentials, raw links and access tokens (mode 600), plus a safe `seed-receipt.json`. Neither exists at handoff. Never print/commit the private file. The DEBUG `wisconsin://fixture-invite` bridge operates in intercepted fixture mode and must not be used to claim a live backend or Apple CDN pass.

## Resume order and closeout

1. Refresh PR refs/checks and inspect local handoff changes. Preserve all unrelated work.
2. Address the preview-capacity decision through an authorized path; do not provision manually. Reconcile the hosted run and attach/doctor its environment.
3. Review/complete the prepared driver, then verify hosted signup and native lifecycle against synthetic preview data. Record safe receipts with exact source/deployment IDs.
4. Resolve the supported test-mail capability; send only the two approved messages if that capability is available. Keep provider acceptance, actual inbox receipt and refreshed-link behavior separate.
5. Perform the approved physical-client checks where feasible; explicitly leave production association and distributed-binary proof pending under the hold.
6. Update #620's stale description/review status and local evidence with actual completed gates. Do not mark an external gate passed from source or fixtures. Do not merge or release.

Repeat only affected checks after changes. Local DB rerun, if needed, uses the existing credential-free wrapper below; do not run the migration-shaped full `npm run build` against an uncontrolled environment:

```sh
node --input-type=module <<'JS'
import {spawn} from 'node:child_process';
import {dbFreeEnvironment} from './scripts/lib/review-pr.mjs';
const p = spawn(process.execPath, ['scripts/test-onboarding-postgres.mjs'], {
  env: dbFreeEnvironment(3100), stdio: 'inherit'
});
p.on('exit', code => process.exit(code ?? 1));
JS
```

The previous 1.4 release monitor is completed/deleted. Do not recreate it or issue another release request. Stop when the authorized checks are complete or a concrete capability/approval is required; report the remaining boundary accurately.
