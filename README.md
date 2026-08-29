# Wisconsin Creative

> Event-driven gear operations for Wisconsin Athletics Creative.

[Production site](https://wisconsincreative.com) · [Public product overview](https://wisconsincreative.com/about) · [Releases](https://github.com/erikrole/wisconsin-creative/releases)

Wisconsin Creative is the operational command system for equipment, reservations,
game-day schedules, and physical handoffs. It replaces spreadsheets and manual
sign-out sheets with a scan-enforced, conflict-aware workflow from reservation
through return.

The repository is public for review, but the production application is
invite-only. The public `/about` route set is a static stakeholder overview;
operational routes require an authenticated account.

## The product

Wisconsin Creative connects the work that normally gets split across an inventory
tool, a calendar, and a sign-out sheet:

- **Inventory** — Serialized gear and bulk item families share one tag-first
  catalog with QR/serial lookup, accessories, metadata, images, maintenance,
  and availability derived from active allocations.
- **Reservations** — Staff and students reserve gear for upcoming work with
  event context, conflict checks, pickup guidance, and repeat-booking support.
- **Custody** — The native kiosk owns immediate checkout, reservation pickup,
  exact serialized scans, numbered bulk-unit selection, returns, and custody
  evidence.
- **Schedule** — ICS events, staffing, call windows, open work, availability,
  trades, publication, and gear readiness meet in one event-driven workflow.
- **Operations** — Dashboard queues, notifications, reports, audit history,
  and bounded repair tools keep overdue gear and exceptions visible.
- **Role-aware access** — Students, staff, admins, and explicitly granted
  collaborators see the workflows and data appropriate to their role.

## One clear handoff model

| Surface | Owns |
| --- | --- |
| Web control room | Inventory, reservations, Schedule operations, settings, reports, imports, and data-quality work |
| Native iOS app | Student work, lookup, reservations, Schedule, Settings, notifications, and field workflows |
| Native kiosk | Person identification, direct checkout, reservation pickup, serialized scans, numbered-unit custody, and return |
| Public showroom | Static, fictional, public-safe product and trust-model information |

The boundary is intentional: app and web reserve; the kiosk opens, edits, and
closes physical custody. The signed-in web scan surface is lookup-only.

## Technology

- Next.js App Router and TypeScript
- PostgreSQL on Neon with Prisma and `@prisma/adapter-neon`
- Vercel Node.js serverless functions, Blob storage, and Cron Jobs
- shadcn/ui and Tailwind CSS
- Resend transactional email
- Vitest and Playwright
- SwiftUI native iOS app with a dedicated kiosk target

## Run it locally

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run db:migrate:check
npm run dev
```

For Neon connection setup, incremental migrations, production drift checks, or
an isolated empty database, follow
[`docs/PRISMA_NEON_RUNBOOK.md`](docs/PRISMA_NEON_RUNBOOK.md). Do not create a
new `init` migration against the existing migration chain.

## Verify changes

Use the smallest gate that proves the slice, then expand it for release or
deployment work:

```bash
npm test
npx tsc --noEmit --pretty false
npm run lint
npm run verify:docs
npm run build:app
```

Authenticated browser checks require an isolated target and dedicated test
identity. Public/deployment checks use `npm run smoke:deploy`. The complete
closeout matrix lives in
[`docs/RELEASE_VERIFICATION.md`](docs/RELEASE_VERIFICATION.md).

## Deployment and releases

Vercel remains the deployment system: Git-connected changes produce preview
deployments, and `main` is the production line. GitHub Releases are deliberate
CalVer milestone records, not a second production trigger.

Release versions use `YYYY.M.N`, where `N` increments within the calendar
month. For example, the first two August 2026 releases are `2026.8.1` and
`2026.8.2`.

After a clean, verified `main` commit and explicit shipping approval:

```bash
npm run release
```

The release script updates `package.json` and `package-lock.json`, creates the
CalVer tag, and pushes the commit and tag. The tag-triggered GitHub Action then
creates the GitHub Release with generated notes. It is a shipping action, not
an ordinary development command.

## Repository map

- [`docs/NORTH_STAR.md`](docs/NORTH_STAR.md) — product direction and operating model
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — accepted architecture and boundaries
- [`docs/AREA_*.md`](docs) — shipped contracts by product area
- [`docs/CODEMAPS/`](docs/CODEMAPS) — generated route, schema, area, and dependency maps
- [`docs/RELEASE_VERIFICATION.md`](docs/RELEASE_VERIFICATION.md) — closeout and release gates
- [`tasks/`](tasks) — active plans, audits, ledgers, and archived proof

Regenerate and check source maps with:

```bash
npm run codemap
npm run codemap:check
```

Read [`docs/AI_COLLABORATION.md`](docs/AI_COLLABORATION.md) for the Codex +
Claude workflow and handoff conventions.
