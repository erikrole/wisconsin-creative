# Contributing

`AGENTS.md` is the canonical contract for how work is done here (humans, Claude,
Codex and Cursor alike). Start there, then `docs/NORTH_STAR.md` for product
direction.

## Workflow

1. Branch from `main` with a short descriptive name.
2. Keep the change to one independently verifiable slice. Batch related work
   into one pull request; every merge to `main` triggers a Vercel deploy.
3. Run the smallest gate that proves the slice (see `docs/RELEASE_VERIFICATION.md`):

   ```bash
   npm test
   npx tsc --noEmit --pretty false
   npm run lint
   npm run verify:docs
   npm run build:app
   ```

4. Open a pull request using the template. User-visible changes need an entry
   in `src/lib/releases.json` with the PR number. Internal work gets the
   `no-release-note` label.
5. UI changes include screenshots. `main` requires the `validate` and
   `postgres-integrity` checks and an up-to-date branch.

## Local setup

Use Node 22. See the README and `docs/PREVIEW_ENVIRONMENTS.md`. Never pull
production variables or create a new database for an existing branch.
Database changes follow `docs/PRISMA_NEON_RUNBOOK.md`.

## Commits and pull requests

- Titles are short and in product language: `Fix Safari export button (#123)`.
- Squash merge. The PR title becomes the commit message.
- Do not commit secrets, `.env*` files, or large binary captures; review
  screenshots belong on a `scratch/<topic>-shots` branch, not in `main`.

## Security

Report vulnerabilities privately; see `SECURITY.md`.
