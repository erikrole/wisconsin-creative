# Budget Area

## Document Control

- Area: Department budgets and purchases (planned vs. actual spend by fiscal year and budget name)
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-10-16
- Status: Slices 1 and 2 built on `claude/project-thread-a6omy6`: tables, admin-only API, the Budget page, and links between purchases and inventory with match suggestions. Importer is next. Authenticated preview proof pending.
- Routes: `/budget` (ADMIN only)
- Plan: the interactive-sheets plan in the project files (`plans/interactive-sheets-plan-2026-10-16.md`)

## Direction

The team's budget lives in a Google Sheet with one tab per fiscal year plus a football tab each year. This area replaces it with real tables so spend can be charted, audited, and linked to the inventory it bought. Football has its own budget, so it is a separate `Budget` rather than a category.

## Rules

1. Admin only. `budget.view` and `budget.manage` are ADMIN. Staff, students, and collaborators get 403 from every route and a redirect from the page, including an admin previewing as Staff.
2. A `Budget` is one named budget (Creative, Football) for one fiscal year (`Creative` + `2026-27`). The pair is unique. `fiscalYear` is `YYYY-YY`.
3. A `BudgetLine` holds both the plan and the result. Planned cost is `unitCostCents x quantity` and is never stored. `spentCents` and `quantityBought` are recorded once bought and may differ from the plan.
4. Status is `PLANNED`, `ORDERED`, `PURCHASED`, or `CANCELLED`. Cancelled lines are excluded from every total.
5. Categories are the department's closed list of eleven (equipment, IT & services, rentals, and so on).
6. Money is whole cents, capped at $10,000,000 per value. Links must be http(s).
7. Summary: planned = non-cancelled planned total; spent = recorded spend; outstanding = planned for lines not yet bought (planned or ordered with no spend); forecast = spent + outstanding; remaining = (allocation, or planned when there is no cap) - forecast. Negative means over.
8. Every mutation is audited with before and after (`budget`, `budget_line`).
9. `poNumber` and `orderNumber` come from order confirmations and are the strongest keys for linking a line to inventory items.
10. A line links to inventory through `BudgetLineItem`: one serialized asset (quantity 1) or a quantity of one bulk SKU, never both. The same item can't be linked twice to a line. An asset may be linked to more than one line only by hand; suggestions skip assets that already have a link and retired assets.
11. Suggestions are hints, never automatic. `src/lib/budget/matching.ts` scores price (exact or within about 3%), purchase date (within 14 or 60 days), a PO or order number (5+ characters) appearing in the item's notes, and shared words. A score under 45 is dropped; 65+ is "likely" and 90+ "high". An admin confirms every link, and every link or unlink is audited.
12. Linking does not change the item. Price and purchase date on the item stay as they are.
13. Autofill is a separate, explicit step (`src/lib/budget/autofill.ts`). From a linked item an admin can fill purchase date, purchase price (spend / units bought, else the planned unit cost), product link, and a notes trail ("Bought from X · PO · Order N · Budget FY budget"). The item page offers only fields that are empty (`fill`); a field that holds another value (`differs`) is shown but never overwritten, and notes are appended, never replaced. The serial number is not on an order, so it stays an item field and is displayed beside the PO. Each apply is audited on the asset as `fill_from_order`.
14. Navigation runs both ways. The item's Purchase card links to `/budget?b=<budgetId>&line=<lineId>`, which opens that budget and highlights the line. The line shows each linked item's tag and serial. A bought line with fewer linked units than `quantityBought ?? quantity` shows "N not linked", and a callout filters to those lines.
15. The lines table can be searched (description, supplier, PO, order number, category; every word must match), filtered by status, and sorted (as entered, biggest, newest, A to Z). `src/lib/budget/table.ts` is pure and tested; nothing here hits the server.

## Data Model

Migration `0176_budget_item_links` adds `budget_line_items` (line, asset or bulk SKU, quantity, created by) with a CHECK that exactly one target is set and unique (line, asset) and (line, bulk SKU); it cascades from the line, the asset, and the bulk SKU.

Migration `0175_budget`: enums `BudgetLineStatus` and `BudgetCategory`; `budgets` (name, fiscal_year, allocation_cents, notes; unique name + year); `budget_lines` (category, status, description, supplier, unit_cost_cents, quantity, quantity_bought, spent_cents, purchased_on, order_number, po_number, link_url, justification, requester_user_id, requester_note). Lines cascade from the budget; the requester link is `SetNull` on user delete.

## API Surface

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET | `/api/budget` | `budget:view` | Budgets with line counts |
| POST | `/api/budget` | `budget:manage` | Create a budget |
| GET | `/api/budget/[id]` | `budget:view` | Budget, lines, and summary |
| PATCH | `/api/budget/[id]` | `budget:manage` | Allocation and notes |
| POST | `/api/budget/[id]/lines` | `budget:manage` | Add a line |
| PATCH | `/api/budget/lines/[lineId]` | `budget:manage` | Edit a line |
| DELETE | `/api/budget/lines/[lineId]` | `budget:manage` | Delete a line |
| GET | `/api/budget/lines/[lineId]/suggestions` | `budget:view` | Inventory that might have come from the line |
| POST | `/api/budget/lines/[lineId]/links` | `budget:manage` | Link an asset or bulk SKU to the line |
| DELETE | `/api/budget/links/[linkId]` | `budget:manage` | Remove a link |
| POST | `/api/budget/links/[linkId]/apply` | `budget:manage` | Fill chosen item fields from the linked order |
| GET | `/api/budget/for-asset/[assetId]` | `budget:view` | The item's serial, its linked lines with autofill proposals, or suggested lines |
| GET | `/api/budget/item-search` | `budget:view` | Find an item to link by hand |

## Not built yet

- Import from the budget workbook (clean text prices, month names, mismatched totals) with all fiscal years and both budgets.
- Bulk matching of an imported sheet to inventory in one pass (today suggestions are per line or per item).
- Charts by month and requester, football-aware link suggestions, requester picker from Staff, CSV/XLSX export.

## Changelog

- 2026-10-16: Slice 1 added (schema, admin-only API, page, tests).
- 2026-10-16: Slice 2 added: links between lines and inventory, match suggestions, a Purchase card on the item page (admins only).
- 2026-10-16: Slice 3 added: autofill an item from its linked order, deep link from the item to its budget line, and a needs-items indicator on the budget.
- 2026-10-16: Lines table search, status filter, and sort.
