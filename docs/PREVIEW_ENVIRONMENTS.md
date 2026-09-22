# Preview environments and agent handoffs

Owner: infrastructure. Updated 2026-09-22. Accepted architecture: [D-063](DECISIONS.md#d-063-branch-owned-previews-and-one-automatic-production-build).

## Current rollout boundary

The review site's Git connection is removed, so a main push no longer starts its duplicate build. Production and review remain online. Main requires a PR and passing `validate` and `postgres-integrity`, with no mandatory human reviewer. The sanitized template, first branch environment, private file stores, and encrypted handoff are live. Source changes remain uncommitted; automatic managed previews and cleanup stay gated until the shipping and cutover steps below are complete.

## Start or resume a branch

Use Node 22 (`.nvmrc`), the repository's npm version, and Vercel CLI 59.11.7 (`npm install --global vercel@59.11.7`). Use one named Git feature branch for one task, regardless of whether Claude, Cursor, or Codex continues it.

```sh
npm ci
npm run preview:setup
npm run dev:preview
# In another terminal in the same checkout:
npm run auth:local
npm run preview:doctor
```

`preview:setup` reuses the private branch state shared by worktrees on this computer. On another computer it retrieves the branch's encrypted development setting from the Vercel resource project, using your authenticated Vercel CLI. Run `vercel login` if needed. Provisioning keys are held only by trusted CI. A new branch must first have a passing same-repository PR and completed Managed previews run; before cutover, an authorized operator provisions it. Missing state is an explicit error, never a reason to use production credentials.

`preview:attach` refreshes an existing local copy from Vercel. An optional private JSON path supports a separately authorized secure handoff. Never paste credential JSON into chat, publish it as an Actions artifact, or commit it. Source branch names and the resulting non-secret preview URL are enough for a task handoff.

The same branch keeps its database, fixtures, session secret, and file stores. Different branches get different resources. A database connection is accepted only after its endpoint, database, branch and signed sanitized-template ancestry agree. Invalid existing state fails closed. Never reset a branch to solve an authentication error.

The server prints its actual loopback URL. Its deterministic port changes when necessary to avoid another checkout; an explicitly requested occupied port fails without killing anything. `auth:local` uses that server's port and cookie name. Changing Git branches stops the old server. `.next/dev` and `.next/build` separate local outputs, with process locks preventing two writers to the same output. Vercel uses its standard `.next` directory. Do not bypass these wrappers with raw Next commands.

## Resources and limits

- Each Git branch owns a child of the protected `Wisconsin Creative Previews` template in `floral-fog-52897668`, PostgreSQL 17 / AWS us-east-1. Child compute is 0.25–1 CU and suspends after five minutes.
- The template has synthetic people, equipment, kits, bookings, and events. It contains no production application rows, passwords, sessions, files, or outbound tokens. Historical migration receipts are retained as provenance, with explicit exceptions.
- Each branch has one public image store and separate private Signature and Resource stores. These are connected only to development settings on `wisconsin-creative-preview-resources`, a resource holder with no Git link, framework or deployments.
- The encrypted handoff holds only that preview's application credentials. It excludes Neon/Vercel operator tokens and the signing key. Access follows membership of the Erik Role Vercel team.
- Managed preview deployments override all inherited project variables, then supply only the branch allowlist. Mail, push, cron, production file-store tokens, production Redis, and telemetry credentials are disabled. Preview cron schedules are removed.
- Dedicated preview Redis is not provisioned. Rate limiting uses the existing local fallback; Companion remote-sync features fail closed until isolated Redis credentials are supplied. External delivery and device-only flows require separate acceptance.
- Plans were not upgraded. Production retains its protected database, seven-day recovery history and daily snapshot schedule. Review retains its separate protected database and six-hour history. The approved Vercel automation token expires 2027-09-22; rotate it before expiry.

## Hosted previews

After successful `CI`, the main-branch orchestrator checks that the exact commit still heads an open same-repository PR. It uploads that commit without executing PR source on the credentialed runner. Executable Vercel config, symlinks, environment files, local artifacts and repository provider linkage are excluded. The remote build receives only isolated branch credentials.

Provisioning and cleanup use one serialized queue (`queue: max`), preserving pending work for different branches. Fork PRs receive no infrastructure secrets. The workflow waits for Ready and proves synthetic login plus database reads using short-lived project OIDC access; deployment protection stays enabled. The run log records the deployment URL and branch identity without credentials.

## Retention and cleanup

```sh
npm run preview:pin
npm run preview:unpin
```

Pin an unpublished branch or long-running manual acceptance environment. Cleanup only considers signed disposable children in the sanitized project. Existing Git branches, open PRs, pins, recent authenticated use, and active deployments retain the environment. The first confirmed absence records a deletion date; both deletion and last use must be at least seven days old. An atomic cleanup claim coordinates with local pin/start/handoff operations so they cannot both succeed. A partially failed retirement stays claimed and must be reconciled or resumed; do not reuse its credentials.

`npm run preview:cleanup` is read-only by default. The protected scheduled workflow supplies `--apply`. It verifies resource ownership, removes only matching preview deployments and file stores, removes the private handoff, then deletes the disposable Neon child. Production, review, templates, unattested legacy branches, and Slice are excluded. No legacy branches were deleted during this hardening pass.

## Production and manual review

Main is the only automatic production line. Review remains available at `review.wisconsincreative.com` with no Git trigger. A deliberate refresh uses a reviewed, fetched main commit:

```sh
npm run review:refresh -- <40-character-main-commit>
# After authorization to refresh the review site:
npm run review:refresh -- <same-commit> --apply
```

The first command reports the target and commit without deploying. The second uploads exactly that commit to the fixed review project. It cannot promote the production project. A GitHub Release is version metadata, not an additional deployment trigger.

## Cutover checklist

1. Ship the reviewed source through a PR; require both protected checks. Verify the production deployment is Ready and public routes remain healthy.
2. Set GitHub repository variable `MANAGED_PREVIEWS_ENABLED=true`. The `preview-infrastructure` environment already restricts secrets to protected branches and contains `NEON_PREVIEW_API_KEY`, `VERCEL_PREVIEW_TOKEN`, and `PREVIEW_SIGNING_KEY`.
3. Trigger a same-repository acceptance PR and verify the full hosted workflow, authenticated pages, private/public storage, and a second computer or clean-state handoff.
4. Only after that succeeds, disable native Vercel Git preview builds while retaining main production deployment. This avoids a period with no working preview path. Verify one build per intended target.
5. Run cleanup in dry-run mode, inspect retention decisions, then set the separate `PREVIEW_CLEANUP_ENABLED=true` variable to enable scheduled destructive cleanup. Keep the active acceptance environment pinned until complete.

Rollback: disable both GitHub activation variables; restore native Git previews if they were disabled. Do not reset or delete data. Restore a previous Ready production deployment only under explicit incident authority. The review site remains manual throughout.

## Changelog and acceptance

2026-09-22: live review trigger removal, branch protection, exact-target migration checkpoints and forward repairs `0153`/`0154`; sanitized template, first isolated child, three file stores, and encrypted handoff. Local route smoke and patched hosted login, database reads and seven rendered pages passed. The patched lockfile clears high/critical audit findings; four moderate findings remain. Source shipping, automatic workflow cutover, production pooling deployment and dedicated preview Redis remain separate boundaries. Detailed evidence is in the [active ledger](../tasks/infrastructure-hardening-plan-2026-09-22.md).
