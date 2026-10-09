# UA Staff Gear Picks Area

## Document Control

- Area: Yearly Under Armour staff gear picks for full-time creative staff
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-10-08
- Status: Built on `feat/ua-gear-picks` for cycle 2027-28; authenticated preview proof pending.
- Routes: `/gear` (participants), `/gear/admin` (ADMIN only)

## Direction

Each year full-time creative staff pick Under Armour gear, on top of their standard issue covered by the department, up to a dollar allowance by fit (2027-28: Men's $192, Women's $357). This replaces a static pick-list page and a copy-and-paste email. Staff save and submit in the app; an admin reads the results and copies the CSV into the equipment order sheet by hand. There is no server-side Google Sheets integration.

## Rules

1. Only explicit participants of the cycle can pick. Being staff is not enough; the roster is a table, not a role rule.
2. A participant shops one fit. `MEN` sees Men's and unisex items; `WOMEN` sees Women's and unisex items.
3. Picks are editable until the admin-set deadline. A cycle with no deadline stays open. After the deadline the page is read-only and saves return 409 (`GEAR_PICKS_CLOSED`).
4. The catalog JSON is the only source of items and prices. The server prices every line from it and snapshots `unitPriceCents` on the line; client prices are ignored.
5. A save replaces the whole list in one `SERIALIZABLE` transaction. The client sends the `version` it last read (0 before the first save); a mismatch returns 409 (`GEAR_PICKS_STALE`) and the page offers a reload.
6. Each line is a SKU (`style-colorCode`), size, and quantity of 1 to 5. Apparel and footwear require sizes; fitted headwear uses explicit item options. Verified `sizes` in catalog JSON are enforced by client and server (Stretch Fit caps, bucket hat, shoes/slides, and the numeric-waist Drive Pant). Other apparel retains free text up to 12 characters. Tops default only from a matching profile fit; pants and base layers require explicit selection. Shoe defaults require a matching US sizing system and an offered size; no conversion or rounding. One-size headwear normalizes to `OSFA`. Old incompatible values stay visible but block saving. The same normalized SKU/size cannot appear twice.
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

- `/gear`: compact **Standard issue** disclosure explains that the department covers this gear separately from the allowance. **Choose your gear** offers search, collection/category filters, and optional **Within my allowance** (off by default). Cards preview colors and support size/quantity selection. The list and review edit the actual selected color, size, and quantity; duplicate and sizing problems remain visible, totals update immediately, and edits lock during saving. Profile lists remain read-only. A sticky footer shows the remaining allowance, total, save state, Save draft, and Review & submit (Review changes after submission). Non-participants see an explanation.
- `/gear/admin`: summary counts, deadline editor, people table (status Not started / Draft / Submitted, fit, editable allowance, picked total, expandable lines, remove with confirmation), add-person picker, totals by item, color, and size, and Export CSV. Sidebar entry "UA Gear Picks" under Team for admins.
- Dashboard: a banner for participants who haven't submitted while the cycle is open, with the allowance and deadline and a "Choose gear" button.

## Code

- `src/lib/gear-picks/catalog-2027-28.json`, `catalog.ts` (typed catalog, SKU index, sizes), `pricing.ts` (validation and pricing), `types.ts` (response shapes).
- `src/lib/services/gear-picks.ts`: participant and admin reads, the save transaction, admin changes, aggregation, CSV rows.
- Routes under `src/app/api/gear-picks/`; pages under `src/app/(app)/gear/`; banner `src/app/(app)/dashboard/gear-picks-banner.tsx`; hook `src/hooks/use-gear-picks.ts`.
- Product images: `public/gear/2027-28/*.webp`.
- Tests: `tests/gear-picks-pricing.test.ts`, `tests/gear-picks-routes.test.ts`.

## Known Limits

- Icon Lo (6024284) has a verified catalog size range but no confirmed US sizing system. It is labeled Catalog shoe size and never prefilled. User suspects men’s sizing; supplier confirmation remains open.

- One cycle at a time: the service reads the cycle id from the catalog module. A new year needs a new catalog JSON, images, a cycle row, and a roster seed.
- Removing a participant deletes their saved lines (recorded in the audit log).

## Change Log

- 2026-10-08 (local, not deployed): Picker save/reload race protections, persistent recovery, narrow-screen budget visibility, and direct filter reset. See recovery acceptance below.

- 2026-10-07: First build for 2027-28: schema and migration `0169_gear_picks`, roster seed script, participant pick page, admin results with CSV export, dashboard banner, `gear_picks` permission.
- 2026-10-08: Default allowances raised to Men's $192 and Women's $357 to match the equipment sheet. The 8 production participant rows were seeded at these amounts.

### Picker recovery acceptance (2026-10-08, local implementation)

- An unsaved list retains its original version across background refreshes; newer saved versions block saving and offer an explicit discard-and-reload action.
- Saves and reloads are single-flight. Pick controls cannot edit a request in flight, and successful saves adopt the acknowledged list and version together.
- Failed background reads keep the form mounted. Failed explicit reloads, uncertain save responses, and deadline rejection preserve the local list. Recovery feedback stays visible on the page and in review.
- Empty filtered results offer **Show all gear**, which clears search/category/collection/budget filters; the remaining allowance stays visible at narrow widths.
- Acceptance: 45 existing gear pricing/route tests and 7 isolated Chromium regressions pass; all seven regressions fail on the original component for the intended missing behavior. Application build and changed-file lint pass. Standalone TypeScript remains blocked by existing errors in two unrelated iOS test helpers. Authenticated preview and production acceptance remain pending.
- Evidence and commands: [hardening ledger](../tasks/ua-picker-hardening-2026-10-08.md), [matched local review](../tasks/archive/proofs/ua-picker-2026-10-08/review.html). Fixtures prove client behavior, not authenticated persistence.

### Picker design acceptance (2026-10-08, local implementation)

- Standard issue is a compact, keyboard-accessible disclosure with image previews; it states that the department covers these essentials separately from the pick allowance.
- The catalog uses wider desktop cards, separate name/price lines, named colors with 44px swatch targets, and an explicit picked-count badge. Narrow screens expose collection/category selectors behind Filters; active filters are counted.
- The budget bar emphasizes the remaining amount, keeps the picked total and save status visible, and separates secondary draft saving from review.
- The pick-list/review sheet allows inline size and quantity editing. Validation, allowance totals, and pending-save locks update immediately. Profile consumers remain read-only; product-preview color swatches inherit the larger targets.
- Acceptance: 9 isolated Chromium checks pass at desktop and narrow widths. The inline-edit regression fails on the preserved pre-design source. Matched [design review](../tasks/archive/proofs/ua-picker-design-2026-10-08/review.html) uses the actual pre-design dirty source, not Git HEAD. Authenticated and production proof remain pending.

- 2026-10-08 wording correction: call this gear **Standard issue**, covered by the department. Do not describe it as free.

### Selection and sizing acceptance (2026-10-08, local implementation)

- All five approved follow-ups implemented: required footwear sizes, matching profile defaults, item-specific fitted-hat/waist sizing, review color edits, and optional allowance filtering with revised language. Source options were checked against the supplied 2027 UA sheets.
- Acceptance: 53 pricing/route tests and 11 Chromium regressions pass; eight sizing/default cases fail on preserved pre-change source. Application-only build and changed-file lint pass. The two unrelated standalone TypeScript errors and authenticated preview boundary remain open.
- [Matched review](../tasks/archive/proofs/ua-picker-fit-2026-10-08/review.html) preserves the previous dirty source and Standard issue wording. No shipping actions.
