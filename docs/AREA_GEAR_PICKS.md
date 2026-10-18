# UA Staff Gear Picks Area

## Document Control

- Area: Yearly Under Armour staff gear picks for full-time creative staff
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-10-16
- Status: Built on `feat/ua-gear-picks` for cycle 2027-28; authenticated preview proof pending.
- Routes: `/gear` (participants), `/gear/admin` (ADMIN only)

## Direction

Each year full-time creative staff pick Under Armour gear, on top of their standard issue covered by the department, up to a dollar allowance by fit (2027-28: Men's $192, Women's $357). This replaces a static pick-list page and a copy-and-paste email. Staff save and submit in the app; an admin downloads the equipment department's budget workbook already filled from submitted picks (or the CSV). There is no server-side Google Sheets integration.

## Rules

1. Only explicit participants of the cycle can pick. Being staff is not enough; the roster is a table, not a role rule.
2. A participant shops one fit. `MEN` sees Men's and unisex items; `WOMEN` sees Women's and unisex items.
3. Picks are editable until the admin-set deadline. A cycle with no deadline stays open. After the deadline the page is read-only and saves return 409 (`GEAR_PICKS_CLOSED`).
4. The catalog JSON is the only source of items and prices. Each item's colors are shown Red, then White, then Black, then any others in catalog order (`sortGearColors`), so cards open on red. The server prices every line from it and snapshots `unitPriceCents` on the line; client prices are ignored.
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
| GET | `/api/gear-picks/admin/export.xlsx` | `gear_picks:manage` | The equipment department's workbook with the cycle tab filled (see Equipment Sheet). Submitted picks only. Audited (`format: equipment_sheet`) and rate limited with the CSV |

## Equipment Sheet

The equipment department's budget workbook ("Z-Brand Creative") is the official order form. `src/lib/gear-picks/templates/equipment-sheet-brand-creative.xlsx` is their file, converted once from `.xls` in Excel so styles and formulas survive. Only the cycle tab is kept: the repository is public, and the historic tabs are the department's record, not ours. `src/lib/gear-picks/equipment-sheet.ts` fills a copy of the cycle's tab (`2027-28` → `27-28`) the way the department filled earlier tabs by hand:

- One row per item, color, and price, with summed counts across the size columns. No names; picks only (standard issue stays off the sheet for now, and Coaches/Staff issue is left blank).
- Footwear → Shoe selection (columns 6, 6½ … 13, US men's sizes only). Sideline collection and headwear → Sideline apparel. Everything else → Team catalog.
- Item names carry the fit prefix (`M …`, `W …`); unisex stays bare. Style #, Color #, Color, Unit Cost (snapshotted price), and QTY are filled; `tot.`, `Total`, and the budget/remaining formulas stay live (`fullCalcOnLoad`). `XXL` maps to `2XL`.
- Sizes with no column (waist, fitted caps, `OSFA`, women's and catalog shoe sizes) go in QTY with a notes breakdown (`32 ×2`, `W 8 ×1`). Women's shoe sizes are never converted.
- Rows holding the department's notes (for example "Talls may or may not be available") are skipped. A full section spills into Team catalog, then Golf, noted "(section full)"; if nothing is left the route returns 422 and the CSV still works.
- The tab title typo ("2027-2078") is corrected on export.

New cycle: get the department's updated workbook, delete every tab but the new cycle's, save it as `.xlsx` in Excel (File > Save As > Excel Workbook), and replace the template.

## UI

- `/gear`: compact **Standard issue** disclosure explains that the department covers this gear separately from the allowance. **Choose your gear** offers search, collection/category filters, and optional **Within my allowance** (off by default). Cards preview colors and support size/quantity selection. The list and review edit the actual selected color, size, and quantity; duplicate and sizing problems remain visible, totals update immediately, and edits lock during saving. Profile lists remain read-only. A sticky footer shows the remaining allowance, total, save state, Save draft, and Review & submit (Review changes after submission). Adding the first line of a style that is already in the participant's department-covered kit (standard issue or core kit, matched by style for their fit) opens an "Included in your standard issue" (or core kit) dialog naming the kit color. It is awareness only: a duplicate or another color is fine, and "Add to picks" adds the line. Later sizes and colors of that style add without asking. Non-participants see an explanation.
- `/gear` intro: a "How it works" splash (`GearPicksIntro.tsx`) opens automatically on a participant's first visit each cycle (normally right after the dashboard banner) while picks are open and not yet submitted. Seen state is per device in localStorage (`gear-picks-intro-seen:<cycleId>:<participantId>`, so a shared browser still shows it to each person). It shows the kit count for their fit, their allowance (or what is left on a draft), and the deadline with its time, plus tips: optional allowance filtering, photo/color previews, editing selected colors in review, checking item sizes with matching profile defaults only, and changes allowed until the deadline. A "How it works" header button reopens it while picks are open.

- `/gear/admin`: summary counts, deadline editor, people table (status Not started / Draft / Submitted, fit, editable allowance, picked total, expandable lines, remove with confirmation), add-person picker, totals by item, color, and size, and Export CSV. Sidebar entry "UA Gear Picks" under Team for admins. The header has Export CSV and Equipment sheet (primary) downloads.
- Dashboard: a banner for participants who haven't submitted while the cycle is open, with the allowance and deadline and a "Choose gear" button.

## Code

- `src/lib/gear-picks/catalog-2027-28.json`, `catalog.ts` (typed catalog, SKU index, sizes), `pricing.ts` (validation and pricing), `types.ts` (response shapes).
- `src/lib/services/gear-picks.ts`: participant and admin reads, the save transaction, admin changes, aggregation, CSV rows.
- Routes under `src/app/api/gear-picks/`; pages under `src/app/(app)/gear/`; banner `src/app/(app)/dashboard/gear-picks-banner.tsx`; hook `src/hooks/use-gear-picks.ts`.
- Product images: `public/gear/2027-28/*.webp`.
- Tests: `tests/gear-picks-pricing.test.ts`, `tests/gear-picks-routes.test.ts`.

## Known Limits

- Icon Lo (6024284) has a verified catalog size range but no confirmed US sizing system. It is labeled Catalog shoe size and never prefilled. User suspects men’s sizing; supplier confirmation remains open.

- One cycle at a time: the service reads the cycle id from the catalog module. A new year needs a new catalog JSON, images, a cycle row, a roster seed, and the department's workbook with that year's tab.
- Removing a participant deletes their saved lines (recorded in the audit log).

## Change Log

- 2026-10-18: **Handout.** Migration `0185_ua_handouts` adds `GearPickHandout` (`gear_pick_handouts`, unique per cycle, user, SKU, size and source). A person's pieces come from `participantPieces` / `studentPieces` in `order.ts` (the same logic as the Order table); the Handout tab (`HandoutBoard`, `handout.ts`) lists people with progress, search and an Outstanding / Done filter, and an admin marks pieces handed out one at a time or all at once (`setHandout`, audited, batched per person). Pieces with no size on file are blocked. Handouts are keyed by size, so if a person's size changes after a handout, the new size shows as outstanding. This replaces the sheet's Handout Tracker.
- 2026-10-18: **Tabs on `/gear/admin`.** The page is split into Overview (budget, Needs attention, staff access, deadline), People (staff and students), Order (rollup, with staff-only picks totals collapsed) and Receiving (order record and check-ins, with search and a Still to arrive filter). The tab lives in the URL hash (`#people`), and the Needs attention links switch tabs and scroll to their section.
- 2026-10-18: **Order record and receiving.** Migration `0184_ua_order_receiving` adds `orderPlacedAt`, `poNumber`, `orderNumber`, `expectedAt` on the cycle and `GearPickReceipt` (`gear_pick_receipts`, one row per check-in so partial shipments work). The Equipment department places the order (October) and gear arrives about July, so the site records it rather than placing it. Admin actions `setOrder`, `addReceipt` (SKU `style-color`, size, 1 to 500, date) and `removeReceipt` are audited. `src/lib/gear-picks/receiving.ts` compares the order plan to receipts per SKU and size (units with no size are left out until sized; extra receipts show as "Not on order") and derives the phase: Planning, Ordered, Receiving, Received.
- 2026-10-18: **Student kit in the Order table.** Each rostered student adds a CW Momentum 1/4 Zip ($52.50, Red) and a Drive Polo ($40.00, Red), men's or women's cut from their profile fit (unisex or unset uses the men's cut), sized from their top size. The student shoe ($50 budget) is only counted until its style is chosen. Styles chosen from the 2027-28 catalog prices matching the kit price; confirm with the department.
- 2026-10-18: **Order table.** `src/lib/gear-picks/order.ts` (`buildOrderPlan`) rolls each participant's standard issue and core kit (from fit and profile sizes; shoes use the shoe size) and saved picks into one quantity per item, color and size, shown in the Order section of `/gear/admin`. People with no size show as "Size needed". Student kits are not included until their items are chosen. The standard-issue shoe is not in the shop catalog, so it has no price yet.
- 2026-10-18: **Admin edits student sizes.** New admin action `setStudentSizes` (permission `gear_picks` manage) updates the student's profile top and shoe size from the Students table (pencil icon) and writes a `set_student_sizes` audit entry with before and after. Sizes stay on the profile, so the change shows there too.
- 2026-10-18: **Seeded roster.** Migration `0183_ua_seed_students` adds last year's 14 students to the 2027-28 cycle by matching active student accounts on exact name; unmatched names are skipped and added by hand in the Students section. Shoe styles are deferred; admins editing others' sizes is approved but not built yet.
- 2026-10-18: **Needs attention.** `/gear/admin` opens with an ordered list from `src/lib/gear-picks/attention.ts` (over budget, students missing a size, placeholder budget, picks not launched or staff not submitted, no students), each linking to its section. Empty state: "Nothing needs attention."
- 2026-10-18: **Student roster.** Migration `0182_ua_allotment_students` adds `GearPickStudent` (`gear_pick_students`, unique per cycle and user) and `studentKitCents` on the cycle (2027-28: $142.50 = zip $52.50 + polo $40.00 + $50.00 shoe budget). `/gear/admin` has a Students section: add or remove active student accounts (audited `addStudent` / `removeStudent`), sizes read from the profile with a Needs size filter. Every student on the list counts against the budget at the kit price. Sport assignment is intentionally not used. The roster starts empty; admins add students in the UI. Core kit and standard issue are still not counted in the budget.
- 2026-10-18: **Kit column on `/gear/admin`.** The people table shows Standard issue (dashed grey), Core kit (purple, men's fit only) and Picks (teal) pills per person, from the catalog kits (`kitCountsForFit`).
- 2026-10-18: **Allotment budget (admin-only).** Migration `0181_ua_allotment_budget` adds `budgetCents` and `budgetConfirmed` to `GearPickCycle` (2027-28 starts at $5,500, unconfirmed). `/gear/admin` opens with a Budget summary in the new allotment design (`AllotmentOverview.tsx`): total budget, staff picks so far (drafts included), and what is left. `PATCH setBudget` is audited. Student kits, core kit, and standard issue are not counted yet. Overlaps the Budget module in PR #494; reconcile which table owns the UA budget when that lands.

- 2026-10-16: **iPhone participant picker (local, not deployed).** Browse → UA Gear uses `GET /api/gear-picks/me?catalog=1` and `PUT /api/gear-picks/me`. The catalog is omitted unless the phone asks, so the website banner stays the same size. Admin roster, deadline, launch, CSV, and the equipment spreadsheet stay on `/gear/admin`. An Xcode build and a signed-in walkthrough are still open.
- 2026-10-08 (local, not deployed): Picker save/reload race protections, persistent recovery, narrow-screen budget visibility, and direct filter reset. See recovery acceptance below.

- 2026-10-07: First build for 2027-28: schema and migration `0169_gear_picks`, roster seed script, participant pick page, admin results with CSV export, dashboard banner, `gear_picks` permission.
- 2026-10-08: Colors lead with Red, then White, then Black on every item.
- 2026-10-08: Heads-up dialog when a pick is already in the participant's standard issue or core kit (`kitEntryForStyle`).
- 2026-10-09: Equipment sheet export fills the department's workbook (`27-28` tab) from submitted picks.
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
- 2026-10-08: "How it works" first-visit splash on `/gear` with a header button to reopen it. Accepted on the authenticated local preview at phone and desktop width (after-only proof: `tasks/archive/proofs/gear-picks-intro-2026-10-08/review.html`); automatic first-visit open not captured because the preview participant had already submitted.


- 2026-10-08 shipping preparation: preserved the new How it works splash and aligned its copy with Standard issue, optional allowance filtering, color editing in review, and matching-size defaults. Full tests (5,564), integrated Chromium checks (12), application build, and standalone TypeScript pass. Earlier TypeScript blockers were fixed in their two test helpers. [Integrated intro capture](../tasks/archive/proofs/ua-picker-fit-2026-10-08/integration/intro-390.png) is after-only fixture proof; hosted/authenticated acceptance is recorded in PR #442 before merge.

### Native iPhone sizing and recovery (2026-10-17, local)

- Native item and review screens use a size picker for all sized gear. Options come from the API catalog; a previously saved size stays visible, while exact-size validation can still require a replacement. There is no custom text entry on iPhone. One-size items remain OSFA. Web sizing behavior is unchanged.
- The allowance card emphasizes what remains. Saves invalidate older reads; failed destructive reloads retain dirty and conflict state. Controls lock while saving or replacing a draft.
- Acceptance: the Simulator walkthrough selected a catalog size and added it to the local review sheet; 222 native tests and 715 iOS source contracts pass. Authenticated draft/submit persistence remains unverified. See the [native review](../tasks/archive/proofs/ios-latest-2026-10-17/review.html).
