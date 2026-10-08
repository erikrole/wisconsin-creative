# UA Staff Gear Picks Area

## Document Control

- Area: Yearly Under Armour staff gear picks for full-time creative staff
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-10-08
- Status: Built on `feat/ua-gear-picks` for cycle 2027-28; authenticated preview proof pending.
- Routes: `/gear` (participants), `/gear/admin` (ADMIN only)

## Direction

Each year full-time creative staff pick Under Armour gear, on top of their free standard issue, up to a dollar allowance by fit (2027-28: Men's $192, Women's $357). This replaces a static pick-list page and a copy-and-paste email. Staff save and submit in the app; an admin reads the results and copies the CSV into the equipment order sheet by hand. There is no server-side Google Sheets integration.

## Rules

1. Only explicit participants of the cycle can pick. Being staff is not enough; the roster is a table, not a role rule.
2. A participant shops one fit. `MEN` sees Men's and unisex items; `WOMEN` sees Women's and unisex items.
3. Picks are editable until the admin-set deadline. A cycle with no deadline stays open. After the deadline the page is read-only and saves return 409 (`GEAR_PICKS_CLOSED`).
4. The catalog JSON is the only source of items and prices. The server prices every line from it and snapshots `unitPriceCents` on the line; client prices are ignored.
5. A save replaces the whole list in one `SERIALIZABLE` transaction. The client sends the `version` it last read (0 before the first save); a mismatch returns 409 (`GEAR_PICKS_STALE`) and the page offers a reload.
6. Each line is a SKU (`style-colorCode`), a size, and a quantity of 1 to 5. Apparel needs a size (free text up to 12 characters; the picker offers XS to 3XL and defaults to the profile top size, mapping 2XL to XXL). Footwear defaults to the profile shoe size (picker offers 6 to 15 in halves). Headwear is one size (`OSFA`). The same SKU and size can't appear twice.
7. The total can't exceed the participant's allowance, for drafts or submissions.
8. `submittedAt` records the first submit and is never cleared; later saves keep the person submitted and bump `updatedAt`.

## Data Model

Migration `0169_gear_picks` adds the `GearPickFit` enum and:

- `GearPickCycle` (`gear_pick_cycles`): id such as `2027-28`, title, nullable deadline. The migration inserts the 2027-28 row.
- `GearPickParticipant` (`gear_pick_participants`): cycle, user, fit, `allowanceCents`; unique per cycle and user. Cascades from the cycle and the user.
- `GearPickSubmission` (`gear_pick_submissions`): one per participant; `submittedAt`, `totalCents`, `version`.
- `GearPickLine` (`gear_pick_lines`): sku, style, color code, size, quantity, `unitPriceCents`; unique per submission, sku, and size; cascades from the submission.

## Roster Seed

The 2027-28 roster lives in `scripts/seed-gear-pick-participants.mjs` as data (name and fit). It matches active, non-collaborator users by exact `users.name`, inserts missing participant rows with the fit's default allowance, and never changes an existing row, so admin edits survive a re-run. Laurie Digman also picks this cycle but has no site account; she is handled off-site.

```bash
node scripts/seed-gear-pick-participants.mjs          # dry run
node scripts/seed-gear-pick-participants.mjs --apply  # write
```

It uses the direct database URL resolver (`DIRECT_URL`, then `DATABASE_URL_UNPOOLED`). Run it after `0169_gear_picks` is deployed to the target database. Admins can also add, remove, and change participants from `/gear/admin`.

## API Surface

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET | `/api/gear-picks/me` | `gear_picks:view` | Cycle (deadline, open), participant (fit, allowance) or null, saved lines and totals, profile size defaults |
| PUT | `/api/gear-picks/me` | `gear_picks:submit` | Replace the list (`lines`, `submit`, `version`); participant, open cycle, catalog, fit, quantity, size, and allowance checks; audit `save_draft` or `submit` with before/after lines |
| GET | `/api/gear-picks/admin` | `gear_picks:manage` | Every participant with status, lines, and totals; totals by SKU and size; addable people |
| PATCH | `/api/gear-picks/admin` | `gear_picks:manage` | `setDeadline`, `addParticipant`, `updateParticipant`, `removeParticipant`; each audited with before/after |
| GET | `/api/gear-picks/admin/export.csv` | `gear_picks:manage` | One row per line: Group ("Staff Pick"), Person, Item #, Item, Color, Size, Qty, Unit Price, Line Total, Submitted At. Only submitted picks are exported; drafts are left out. Audited and rate limited |

## UI

- `/gear`: "Already in your kit" thumbnails from the catalog `kits`, then the catalog by category with jump links, search (name, color, item number, collection), collection chips, and "Only what fits my budget" (on by default; hides unpicked items priced above what is left). Cards swap the image by color, show the catalog-sketch or spec-sheet badge, price notes, and collection eyebrow, and open a larger preview. Each color holds one or more size lines with a quantity stepper. A sticky footer shows the total against the allowance, what is left or the overage, and Save draft / Submit picks (after submitting, Save changes). Non-participants see an explanation.
- `/gear` intro: a "How it works" splash (`GearPicksIntro.tsx`) opens automatically on a participant's first visit each cycle (normally right after the dashboard banner) while picks are open and not yet submitted. Seen state is per device in localStorage (`gear-picks-intro-seen:<cycleId>`). It shows the kit count for their fit, their allowance (or what is left on a draft), and the deadline with its time, plus tips: "Fits my budget" is on, tap a photo to enlarge, sizes are prefilled from the profile when it has one (otherwise "Pick a size for each item"), changes allowed until the deadline. A "How it works" header button reopens it while picks are open.
- `/gear/admin`: summary counts, deadline editor, people table (status Not started / Draft / Submitted, fit, editable allowance, picked total, expandable lines, remove with confirmation), add-person picker, totals by item, color, and size, and Export CSV. Sidebar entry "UA Gear Picks" under Team for admins.
- Dashboard: a banner for participants who haven't submitted while the cycle is open, with the allowance and deadline and a "Choose gear" button.

## Code

- `src/lib/gear-picks/catalog-2027-28.json`, `catalog.ts` (typed catalog, SKU index, sizes), `pricing.ts` (validation and pricing), `types.ts` (response shapes).
- `src/lib/services/gear-picks.ts`: participant and admin reads, the save transaction, admin changes, aggregation, CSV rows.
- Routes under `src/app/api/gear-picks/`; pages under `src/app/(app)/gear/`; banner `src/app/(app)/dashboard/gear-picks-banner.tsx`; hook `src/hooks/use-gear-picks.ts`.
- Product images: `public/gear/2027-28/*.webp`.
- Tests: `tests/gear-picks-pricing.test.ts`, `tests/gear-picks-routes.test.ts`.

## Known Limits

- One cycle at a time: the service reads the cycle id from the catalog module. A new year needs a new catalog JSON, images, a cycle row, and a roster seed.
- Removing a participant deletes their saved lines (recorded in the audit log).

## Change Log

- 2026-10-07: First build for 2027-28: schema and migration `0169_gear_picks`, roster seed script, participant pick page, admin results with CSV export, dashboard banner, `gear_picks` permission.
- 2026-10-08: Default allowances raised to Men's $192 and Women's $357 to match the equipment sheet. The 8 production participant rows were seeded at these amounts.
- 2026-10-08: "How it works" first-visit splash on `/gear` with a header button to reopen it. Accepted on the authenticated local preview at phone and desktop width (after-only proof: `tasks/archive/proofs/gear-picks-intro-2026-10-08/review.html`); automatic first-visit open not captured because the preview participant had already submitted.
