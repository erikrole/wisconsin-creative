import { Prisma, type Role } from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { applyNote, buildAutofill, unitPriceCents, type AutofillField, type AutofillProposal } from "@/lib/budget/autofill";
import { productIdentity, scoreLineItemMatch, tokens, type MatchItem, type MatchLine, type MatchResult } from "@/lib/budget/matching";
import { plannedCents, summarizeBudget, type BudgetCategoryValue, type BudgetLineStatusValue } from "@/lib/budget/contract";
import { describeLineChanges, type LineChange } from "@/lib/budget/history";
import type {
  BulkLinesInput,
  ImportLinesInput,
  CreateBudgetInput,
  CreateLineInput,
  UpdateBudgetInput,
  UpdateLineInput,
} from "@/lib/budget/schemas";

type Actor = { id: string; role: Role };

const lineSelect = {
  id: true,
  budgetId: true,
  category: true,
  status: true,
  description: true,
  supplier: true,
  unitCostCents: true,
  unitCostKnown: true,
  plannedTotalKnown: true,
  plannedOverrideCents: true,
  statusKnown: true,
  submittedIncluded: true,
  submittedAmountCents: true,
  quantity: true,
  quantityBought: true,
  spentCents: true,
  purchasedOn: true,
  orderNumber: true,
  poNumber: true,
  linkUrl: true,
  justification: true,
  requesterUserId: true,
  requesterNote: true,
  unplanned: true,
  refundCents: true,
  recurring: true,
  gearPickCycleId: true,
  requester: { select: { id: true, name: true } },
  items: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      quantity: true,
      asset: { select: { id: true, assetTag: true, name: true, brand: true, model: true, serialNumber: true, imageUrl: true } },
      bulkSku: { select: { id: true, name: true, imageUrl: true } },
    },
  },
} satisfies Prisma.BudgetLineSelect;

type LineRow = Prisma.BudgetLineGetPayload<{ select: typeof lineSelect }>;

type BudgetLineLinkView = {
  id: string;
  quantity: number;
  kind: "asset" | "bulk";
  targetId: string;
  label: string;
  imageUrl: string | null;
  detail: string | null;
  href: string;
};

export type BudgetLineView = Omit<LineRow, "purchasedOn" | "requester" | "items"> & {
  purchasedOn: string | null;
  requesterName: string | null;
  links: BudgetLineLinkView[];
};

function toLinkView(row: LineRow["items"][number]): BudgetLineLinkView {
  if (row.asset) {
    const label = row.asset.name?.trim() || `${row.asset.brand} ${row.asset.model}`.trim();
    return {
      id: row.id,
      quantity: row.quantity,
      kind: "asset",
      targetId: row.asset.id,
      label,
      imageUrl: row.asset.imageUrl,
      detail: [row.asset.assetTag, row.asset.serialNumber ? `SN ${row.asset.serialNumber}` : null].filter(Boolean).join(" · "),
      href: `/items/${row.asset.id}`,
    };
  }
  return {
    id: row.id,
    quantity: row.quantity,
    kind: "bulk",
    targetId: row.bulkSku!.id,
    label: row.bulkSku!.name,
    imageUrl: row.bulkSku!.imageUrl,
    detail: null,
    href: `/bulk-inventory/${row.bulkSku!.id}`,
  };
}

function toLineView(row: LineRow): BudgetLineView {
  const { purchasedOn, requester, items, ...rest } = row;
  return {
    ...rest,
    purchasedOn: purchasedOn ? purchasedOn.toISOString().slice(0, 10) : null,
    requesterName: requester?.name ?? null,
    links: items.map(toLinkView),
  };
}

function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

/** Every budget with how many lines it holds, newest fiscal year first. */
export async function listBudgets() {
  const budgets = await db.budget.findMany({
    orderBy: [{ fiscalYear: "desc" }, { name: "asc" }],
    select: { id: true, name: true, fiscalYear: true, allocationCents: true, _count: { select: { lines: true } } },
  });
  return budgets.map(({ _count, ...budget }) => ({ ...budget, lineCount: _count.lines }));
}

/** One budget with its lines and the summary the page leads with. */
export async function getBudgetDetail(budgetId: string) {
  const budget = await db.budget.findUnique({
    where: { id: budgetId },
    select: {
      id: true,
      name: true,
      fiscalYear: true,
      allocationCents: true,
      submittedCents: true,
      submittedUnknownCount: true,
      submittedAt: true,
      submittedSource: true,
      notes: true,
      lines: { select: lineSelect, orderBy: [{ createdAt: "asc" }] },
    },
  });
  if (!budget) throw new HttpError(404, "Budget not found.");
  // UA allotment years a line can top up, newest first.
  const uaCycles = await db.gearPickCycle.findMany({ orderBy: { id: "desc" }, select: { id: true, title: true } });
  const { lines, ...rest } = budget;
  const summary = summarizeBudget(
    lines.map((line) => ({
      status: line.status as BudgetLineStatusValue,
      category: line.category as BudgetCategoryValue,
      unitCostCents: line.unitCostCents,
      unitCostKnown: line.unitCostKnown,
      plannedTotalKnown: line.plannedTotalKnown,
      plannedOverrideCents: line.plannedOverrideCents,
      statusKnown: line.statusKnown,
      submittedIncluded: line.submittedIncluded,
      submittedAmountCents: line.submittedAmountCents,
      quantity: line.quantity,
      spentCents: line.spentCents,
      unplanned: line.unplanned,
      refundCents: line.refundCents,
    })),
    rest.allocationCents,
    { submittedCents: rest.submittedCents, submittedUnknownCount: rest.submittedUnknownCount },
  );
  return { budget: rest, lines: lines.map(toLineView), summary, uaCycles };
}

export async function createBudget(actor: Actor, input: CreateBudgetInput) {
  return db.$transaction(async (tx) => {
    // The (name, fiscalYear) unique constraint decides duplicates; P2002 maps to a 409.
    const budget = await tx.budget.create({
      data: {
        name: input.name,
        fiscalYear: input.fiscalYear,
        allocationCents: input.allocationCents ?? null,
        notes: input.notes ?? null,
      },
      select: { id: true, name: true, fiscalYear: true, allocationCents: true },
    });
    let copied = 0;
    if (input.copyRecurringFromBudgetId) {
      const recurring = await tx.budgetLine.findMany({
        where: { budgetId: input.copyRecurringFromBudgetId, recurring: true, status: { not: "CANCELLED" } },
        select: {
          category: true,
          description: true,
          supplier: true,
          unitCostCents: true,
          unitCostKnown: true,
          plannedTotalKnown: true,
          plannedOverrideCents: true,
          quantity: true,
          linkUrl: true,
          justification: true,
          requesterUserId: true,
          requesterNote: true,
        },
      });
      if (recurring.length > 0) {
        await tx.budgetLine.createMany({
          data: recurring.map((line) => ({ ...line, budgetId: budget.id, status: "PLANNED" as const, recurring: true })),
        });
      }
      copied = recurring.length;
    }
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "budget",
      entityId: budget.id,
      action: "create",
      after: { ...budget, copiedRecurringLines: copied },
    });
    return budget;
  });
}

export async function updateBudget(actor: Actor, budgetId: string, input: UpdateBudgetInput) {
  return db.$transaction(async (tx) => {
    const before = await tx.budget.findUnique({
      where: { id: budgetId },
      select: { id: true, allocationCents: true, notes: true },
    });
    if (!before) throw new HttpError(404, "Budget not found.");
    const after = await tx.budget.update({
      where: { id: budgetId },
      data: { allocationCents: input.allocationCents, notes: input.notes },
      select: { id: true, allocationCents: true, notes: true },
    });
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "budget",
      entityId: budgetId,
      action: "update",
      before,
      after,
    });
    return after;
  });
}

/** Capture (or deliberately revise) the plan; subsequent edits cannot change this snapshot. */
export async function captureSubmittedPlan(actor: Actor, budgetId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.budget.findUnique({
      where: { id: budgetId },
      select: { id: true, submittedCents: true, submittedUnknownCount: true, submittedAt: true },
    });
    if (!before) throw new HttpError(404, "Budget not found.");
    const lines = await tx.budgetLine.findMany({
      where: { budgetId },
      select: { id: true, unitCostCents: true, quantity: true, plannedTotalKnown: true, plannedOverrideCents: true, unplanned: true, submittedIncluded: true, submittedAmountCents: true },
    });
    if (lines.length === 0) throw new HttpError(400, "Add a line before saving a plan.");
    const entries = lines.map((line) => ({
      id: line.id,
      included: !line.unplanned,
      amount: !line.unplanned && line.plannedTotalKnown ? plannedCents(line) : null,
    }));
    const submittedCents = entries.reduce((sum, line) => sum + (line.amount ?? 0), 0);
    if (!Number.isSafeInteger(submittedCents) || submittedCents > 2_147_483_647) throw new HttpError(400, "The submitted plan is too large.");
    const submittedUnknownCount = entries.filter((line) => line.included && line.amount === null).length;
    await tx.$executeRaw(Prisma.sql`
      UPDATE budget_lines AS line
      SET submitted_included = snapshot.included, submitted_amount_cents = snapshot.amount
      FROM (VALUES ${Prisma.join(entries.map((line) => Prisma.sql`(${line.id}::text, ${line.included}::boolean, ${line.amount}::integer)`))}) AS snapshot(id, included, amount)
      WHERE line.id = snapshot.id AND line.budget_id = ${budgetId}
    `);
    const after = await tx.budget.update({
      where: { id: budgetId },
      data: { submittedCents, submittedUnknownCount, submittedAt: new Date(), submittedSource: "admin" },
      select: { id: true, submittedCents: true, submittedUnknownCount: true, submittedAt: true },
    });
    await createAuditEntryTx(tx, { actorId: actor.id, actorRole: actor.role, entityType: "budget", entityId: budgetId, action: "capture_plan", before: { ...before, lines: lines.map((line) => ({ id: line.id, included: line.submittedIncluded, amount: line.submittedAmountCents })) }, after: { ...after, lines: entries } });
    return after;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}

/** A refund can't be larger than what was spent. Throwing inside the transaction rolls the change back. */
function assertRefund(row: { refundCents: number | null; spentCents: number | null }) {
  if (row.refundCents !== null && row.refundCents > (row.spentCents ?? 0)) {
    throw new HttpError(400, "A refund can't be more than what was spent.");
  }
}

async function assertGearCycle(tx: Prisma.TransactionClient, cycleId: string | null | undefined) {
  if (!cycleId) return;
  const cycle = await tx.gearPickCycle.findUnique({ where: { id: cycleId }, select: { id: true } });
  if (!cycle) throw new HttpError(404, "That Under Armour year doesn't exist.");
}

async function assertRequester(tx: Prisma.TransactionClient, userId: string | null | undefined) {
  if (!userId) return;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new HttpError(404, "That requester isn't a person on the site.");
}

export async function createLine(actor: Actor, budgetId: string, input: CreateLineInput) {
  return db.$transaction(async (tx) => {
    const budget = await tx.budget.findUnique({ where: { id: budgetId }, select: { id: true, submittedAt: true } });
    if (!budget) throw new HttpError(404, "Budget not found.");
    await assertRequester(tx, input.requesterUserId);
    await assertGearCycle(tx, input.gearPickCycleId);
    if (input.gearPickCycleId && !input.plannedTotalKnown) throw new HttpError(400, "Enter a budget total before linking an Under Armour year.");
    const row = await tx.budgetLine.create({
      data: {
        budgetId,
        category: input.category,
        status: input.status,
        description: input.description,
        supplier: input.supplier ?? null,
        unitCostCents: input.unitCostCents,
        unitCostKnown: input.unitCostKnown,
        plannedTotalKnown: input.plannedTotalKnown,
        plannedOverrideCents: input.plannedOverrideCents ?? null,
        statusKnown: input.statusKnown,
        quantity: input.quantity,
        quantityBought: input.quantityBought ?? null,
        spentCents: input.spentCents ?? null,
        purchasedOn: toDate(input.purchasedOn) ?? null,
        orderNumber: input.orderNumber ?? null,
        poNumber: input.poNumber ?? null,
        linkUrl: input.linkUrl ?? null,
        justification: input.justification ?? null,
        requesterUserId: input.requesterUserId ?? null,
        requesterNote: input.requesterNote ?? null,
        unplanned: input.unplanned || budget.submittedAt != null,
        refundCents: input.refundCents ?? null,
        recurring: input.recurring,
        gearPickCycleId: input.gearPickCycleId ?? null,
      },
      select: lineSelect,
    });
    assertRefund(row);
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "budget_line",
      entityId: row.id,
      action: "create",
      after: toLineView(row),
    });
    return toLineView(row);
  });
}

export async function updateLine(actor: Actor, lineId: string, input: UpdateLineInput) {
  return db.$transaction(async (tx) => {
    const before = await tx.budgetLine.findUnique({ where: { id: lineId }, select: lineSelect });
    if (!before) throw new HttpError(404, "Budget line not found.");
    await assertRequester(tx, input.requesterUserId);
    await assertGearCycle(tx, input.gearPickCycleId);
    if ((input.gearPickCycleId === undefined ? before.gearPickCycleId : input.gearPickCycleId) && (input.plannedTotalKnown ?? before.plannedTotalKnown) === false) throw new HttpError(400, "Enter a budget total before linking an Under Armour year.");
    const { purchasedOn, ...rest } = input;
    const row = await tx.budgetLine.update({
      where: { id: lineId },
      data: { ...rest, ...(purchasedOn !== undefined ? { purchasedOn: toDate(purchasedOn) } : {}) },
      select: lineSelect,
    });
    assertRefund(row);
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "budget_line",
      entityId: lineId,
      action: "update",
      before: toLineView(before),
      after: toLineView(row),
    });
    return toLineView(row);
  });
}

export async function deleteLine(actor: Actor, lineId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.budgetLine.findUnique({ where: { id: lineId }, select: lineSelect });
    if (!before) throw new HttpError(404, "Budget line not found.");
    await tx.budgetLine.delete({ where: { id: lineId } });
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "budget_line",
      entityId: lineId,
      action: "delete",
      before: toLineView(before),
    });
    return { id: lineId };
  });
}

// ── Links between budget lines and inventory ────────────────────────────────

export type ItemSuggestion = MatchResult & {
  kind: "asset" | "bulk";
  targetId: string;
  label: string;
  imageUrl: string | null;
  detail: string | null;
  href: string;
  suggestedQuantity: number | null;
};

export type LineSuggestion = MatchResult & {
  lineId: string;
  budgetId: string;
  budgetName: string;
  fiscalYear: string;
  description: string;
  unitCostCents: number;
  purchasedOn: string | null;
  poNumber: string | null;
};

const SUGGESTION_LIMIT = 8;
const CANDIDATE_LIMIT = 300;

const dateOnly = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const toCents = (value: Prisma.Decimal | null) => (value === null ? null : Math.round(Number(value) * 100));

function lineToMatch(line: {
  description: string;
  supplier: string | null;
  unitCostCents: number;
  unitCostKnown?: boolean;
  spentCents?: number | null;
  quantityBought?: number | null;
  linkUrl?: string | null;
  budget?: { name: string };
  purchasedOn: Date | null;
  poNumber: string | null;
  orderNumber: string | null;
}): MatchLine {
  return { ...line, purchasedOn: dateOnly(line.purchasedOn), budgetName: line.budget?.name, productUrl: line.linkUrl,
    actualUnitCents: line.spentCents != null && line.quantityBought != null && line.quantityBought > 0 ? Math.round(line.spentCents / line.quantityBought) : null };
}

function wordFilters(text: string) {
  return tokens(text)
    .filter((word) => word.length >= 3)
    .slice(0, 6)
    .flatMap((word) => [
      { brand: { contains: word, mode: "insensitive" as const } },
      { model: { contains: word, mode: "insensitive" as const } },
      { name: { contains: word, mode: "insensitive" as const } },
    ]);
}

/** Inventory that might have come from this line: unlinked assets and bulk SKUs, best match first. */
export async function suggestItemsForLine(lineId: string): Promise<ItemSuggestion[]> {
  const line = await db.budgetLine.findUnique({
    where: { id: lineId },
    select: {
      description: true,
      supplier: true,
      unitCostCents: true,
      unitCostKnown: true,
      quantity: true,
      quantityBought: true,
      spentCents: true,
      linkUrl: true,
      budget: { select: { name: true } },
      purchasedOn: true,
      poNumber: true,
      orderNumber: true,
    },
  });
  if (!line) throw new HttpError(404, "Budget line not found.");
  const match = lineToMatch(line);

  const candidatePrices = [line.unitCostKnown ? line.unitCostCents : null, match.actualUnitCents].filter((price): price is number => price != null && price > 0);
  const priceBands = candidatePrices.map((cents) => ({ purchasePrice: { gte: (cents / 100) * 0.97, lte: (cents / 100) * 1.03 } }));
  const product = productIdentity(line.linkUrl);
  const bhProduct = product?.match(/^bhphotovideo\.com\/product\/(\d+)$/)?.[1];
  const productFilter = bhProduct ? [{ linkUrl: { contains: `/c/product/${bhProduct}`, mode: "insensitive" as const } }] : [];
  const bulkProductFilter = bhProduct ? [{ purchaseLink: { contains: `/c/product/${bhProduct}`, mode: "insensitive" as const } }] : [];
  const windowMs = 60 * 86_400_000;
  const dateBand = line.purchasedOn
    ? { gte: new Date(line.purchasedOn.getTime() - windowMs), lte: new Date(line.purchasedOn.getTime() + windowMs) }
    : null;
  const words = wordFilters(line.description);

  const [assets, skus] = await Promise.all([
    db.asset.findMany({
      where: {
        status: { not: "RETIRED" },
        budgetLines: { none: {} },
        OR: [...priceBands, ...productFilter, ...(dateBand ? [{ purchaseDate: dateBand }] : []), ...words],
      },
      take: CANDIDATE_LIMIT,
      select: { id: true, assetTag: true, name: true, brand: true, model: true, purchasePrice: true, purchaseDate: true, notes: true, imageUrl: true, linkUrl: true, department: { select: { name: true } } },
    }),
    db.bulkSku.findMany({
      where: {
        active: true,
        OR: [...priceBands, ...bulkProductFilter, ...tokens(line.description).filter((w) => w.length >= 3).slice(0, 6).map((word) => ({ name: { contains: word, mode: "insensitive" as const } }))],
      },
      take: CANDIDATE_LIMIT,
      select: { id: true, name: true, purchasePrice: true, notes: true, imageUrl: true, purchaseLink: true, department: { select: { name: true } } },
    }),
  ]);

  const out: ItemSuggestion[] = [];
  for (const asset of assets) {
    const item: MatchItem = {
      name: asset.name,
      brand: asset.brand,
      model: asset.model,
      purchasePriceCents: toCents(asset.purchasePrice),
      purchaseDate: dateOnly(asset.purchaseDate),
      notes: asset.notes,
      productUrl: asset.linkUrl,
      departmentName: asset.department?.name,
    };
    const result = scoreLineItemMatch(match, item);
    if (!result) continue;
    out.push({
      ...result,
      kind: "asset",
      targetId: asset.id,
      label: asset.name?.trim() || `${asset.brand} ${asset.model}`.trim(),
      imageUrl: asset.imageUrl,
      detail: [asset.assetTag, asset.department?.name].filter(Boolean).join(" · "),
      href: `/items/${asset.id}`,
      suggestedQuantity: 1,
    });
  }
  for (const sku of skus) {
    const item: MatchItem = { name: sku.name, brand: "", model: "", purchasePriceCents: toCents(sku.purchasePrice), purchaseDate: null, notes: sku.notes, productUrl: sku.purchaseLink, departmentName: sku.department?.name };
    const result = scoreLineItemMatch(match, item);
    if (!result) continue;
    out.push({
      ...result,
      kind: "bulk",
      targetId: sku.id,
      label: sku.name,
      imageUrl: sku.imageUrl,
      detail: ["Bulk item", sku.department?.name].filter(Boolean).join(" · "),
      href: `/bulk-inventory/${sku.id}`,
      suggestedQuantity: line.quantityBought,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, SUGGESTION_LIMIT);
}

/** Budget lines that might have paid for this asset, for the item page. */
export async function suggestLinesForAsset(
  assetId: string,
): Promise<{ serialNumber: string | null; imageUrl: string | null; linked: BudgetLineLinkViewForAsset[]; suggestions: LineSuggestion[] }> {
  const asset = await db.asset.findUnique({
    where: { id: assetId },
    select: {
      name: true,
      brand: true,
      model: true,
      imageUrl: true,
      serialNumber: true,
      purchasePrice: true,
      purchaseDate: true,
      linkUrl: true,
      notes: true,
      department: { select: { name: true } },
      budgetLines: {
        select: {
          id: true,
          budgetLine: {
            select: {
              id: true,
              description: true,
              supplier: true,
              spentCents: true,
              unitCostCents: true,
              unitCostKnown: true,
              quantityBought: true,
              poNumber: true,
              orderNumber: true,
              linkUrl: true,
              purchasedOn: true,
              budget: { select: { id: true, name: true, fiscalYear: true } },
            },
          },
        },
      },
    },
  });
  if (!asset) throw new HttpError(404, "Item not found.");

  const linked = asset.budgetLines.map((row) => {
    const line = row.budgetLine;
    return {
      linkId: row.id,
      lineId: line.id,
      budgetId: line.budget.id,
      budgetName: line.budget.name,
      fiscalYear: line.budget.fiscalYear,
      description: line.description,
      supplier: line.supplier,
      unitCostCents: line.unitCostCents,
      spentCents: line.spentCents,
      poNumber: line.poNumber,
      orderNumber: line.orderNumber,
      purchasedOn: dateOnly(line.purchasedOn),
      autofill: buildAutofill(
        {
          description: line.description,
          supplier: line.supplier,
          unitCostCents: line.unitCostCents,
          unitCostKnown: line.unitCostKnown,
          quantityBought: line.quantityBought,
          spentCents: line.spentCents,
          purchasedOn: dateOnly(line.purchasedOn),
          poNumber: line.poNumber,
          orderNumber: line.orderNumber,
          linkUrl: line.linkUrl,
          budgetName: line.budget.name,
          fiscalYear: line.budget.fiscalYear,
        },
        {
          purchaseDate: dateOnly(asset.purchaseDate),
          purchasePriceCents: toCents(asset.purchasePrice),
          linkUrl: asset.linkUrl,
          notes: asset.notes,
        },
      ),
    };
  });
  if (linked.length > 0) return { serialNumber: asset.serialNumber, imageUrl: asset.imageUrl, linked, suggestions: [] };

  const item: MatchItem = {
    name: asset.name,
    brand: asset.brand,
    model: asset.model,
    purchasePriceCents: toCents(asset.purchasePrice),
    purchaseDate: dateOnly(asset.purchaseDate),
    notes: asset.notes,
    productUrl: asset.linkUrl,
    departmentName: asset.department?.name,
  };
  const priceCents = item.purchasePriceCents;
  const productId = productIdentity(asset.linkUrl)?.match(/^bhphotovideo\.com\/product\/(\d+)$/)?.[1];
  const windowMs = 60 * 86_400_000;
  const lines = await db.budgetLine.findMany({
    where: {
      status: { not: "CANCELLED" },
      OR: [
        ...(priceCents !== null ? [{ unitCostCents: { gte: Math.floor(priceCents * 0.97), lte: Math.ceil(priceCents * 1.03) } }] : []),
        ...(priceCents !== null ? [{ spentCents: { gte: Math.floor(priceCents * 0.97), lte: Math.ceil(priceCents * 1.03) } }] : []),
        ...(productId ? [{ linkUrl: { contains: `/c/product/${productId}`, mode: "insensitive" as const } }] : []),
        ...(asset.purchaseDate
          ? [{ purchasedOn: { gte: new Date(asset.purchaseDate.getTime() - windowMs), lte: new Date(asset.purchaseDate.getTime() + windowMs) } }]
          : []),
        ...tokens(`${asset.brand} ${asset.model} ${asset.name ?? ""}`)
          .filter((word) => word.length >= 3)
          .slice(0, 6)
          .map((word) => ({ description: { contains: word, mode: "insensitive" as const } })),
      ],
    },
    take: CANDIDATE_LIMIT,
    select: {
      id: true,
      description: true,
      supplier: true,
      unitCostCents: true,
      unitCostKnown: true,
      spentCents: true,
      quantityBought: true,
      linkUrl: true,
      purchasedOn: true,
      poNumber: true,
      orderNumber: true,
      budget: { select: { id: true, name: true, fiscalYear: true } },
    },
  });

  const suggestions: LineSuggestion[] = [];
  for (const line of lines) {
    const result = scoreLineItemMatch(lineToMatch(line), item);
    if (!result) continue;
    suggestions.push({
      ...result,
      lineId: line.id,
      budgetId: line.budget.id,
      budgetName: line.budget.name,
      fiscalYear: line.budget.fiscalYear,
      description: line.description,
      unitCostCents: line.unitCostCents,
      purchasedOn: dateOnly(line.purchasedOn),
      poNumber: line.poNumber,
    });
  }
  return { serialNumber: asset.serialNumber, imageUrl: asset.imageUrl, linked, suggestions: suggestions.sort((a, b) => b.score - a.score).slice(0, SUGGESTION_LIMIT) };
}

export type BudgetLineLinkViewForAsset = {
  linkId: string;
  lineId: string;
  budgetId: string;
  budgetName: string;
  fiscalYear: string;
  description: string;
  supplier: string | null;
  unitCostCents: number;
  spentCents: number | null;
  poNumber: string | null;
  orderNumber: string | null;
  purchasedOn: string | null;
  /** What the item can take from this order, with what it has now. */
  autofill: AutofillProposal[];
};

export type LinkTarget = { assetId: string; bulkSkuId?: undefined; quantity?: number } | { bulkSkuId: string; assetId?: undefined; quantity?: number };

export async function linkItem(actor: Actor, lineId: string, target: LinkTarget) {
  return db.$transaction(async (tx) => {
    const line = await tx.budgetLine.findUnique({ where: { id: lineId }, select: { id: true, description: true } });
    if (!line) throw new HttpError(404, "Budget line not found.");
    if (target.assetId) {
      const asset = await tx.asset.findUnique({ where: { id: target.assetId }, select: { id: true } });
      if (!asset) throw new HttpError(404, "Item not found.");
    } else {
      if (target.quantity === undefined) throw new HttpError(400, "Enter the number of bulk units from this purchase.");
      const sku = await tx.bulkSku.findUnique({ where: { id: target.bulkSkuId }, select: { id: true } });
      if (!sku) throw new HttpError(404, "Bulk item not found.");
    }
    // The (line, item) unique constraints decide duplicates; P2002 maps to a 409.
    const link = await tx.budgetLineItem.create({
      data: {
        budgetLineId: lineId,
        assetId: target.assetId ?? null,
        bulkSkuId: target.bulkSkuId ?? null,
        quantity: target.assetId ? 1 : (target.quantity ?? 1),
        createdById: actor.id,
      },
      select: { id: true, assetId: true, bulkSkuId: true, quantity: true },
    });
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "budget_line_item",
      entityId: link.id,
      action: "link",
      after: { budgetLineId: lineId, ...link },
    });
    return link;
  });
}

export async function unlinkItem(actor: Actor, linkId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.budgetLineItem.findUnique({
      where: { id: linkId },
      select: { id: true, budgetLineId: true, assetId: true, bulkSkuId: true, quantity: true },
    });
    if (!before) throw new HttpError(404, "That link no longer exists.");
    await tx.budgetLineItem.delete({ where: { id: linkId } });
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "budget_line_item",
      entityId: linkId,
      action: "unlink",
      before,
    });
    return { id: linkId };
  });
}

export type ItemSearchResult = { kind: "asset" | "bulk"; targetId: string; label: string; imageUrl: string | null; detail: string | null };

/** Quick lookup for linking by hand when no suggestion fits. */
export async function searchItemsToLink(query: string): Promise<ItemSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const [assets, skus] = await Promise.all([
    db.asset.findMany({
      where: {
        OR: [
          { assetTag: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
          { brand: { contains: q, mode: "insensitive" } },
          { model: { contains: q, mode: "insensitive" } },
          { serialNumber: { contains: q, mode: "insensitive" } },
        ],
      },
      take: 8,
      orderBy: { assetTag: "asc" },
      select: { id: true, assetTag: true, name: true, brand: true, model: true, imageUrl: true, department: { select: { name: true } } },
    }),
    db.bulkSku.findMany({
      where: { active: true, name: { contains: q, mode: "insensitive" } },
      take: 4,
      orderBy: { name: "asc" },
      select: { id: true, name: true, imageUrl: true, department: { select: { name: true } } },
    }),
  ]);
  return [
    ...assets.map((asset) => ({
      kind: "asset" as const,
      targetId: asset.id,
      label: asset.name?.trim() || `${asset.brand} ${asset.model}`.trim(),
      imageUrl: asset.imageUrl,
      detail: [asset.assetTag, asset.department?.name].filter(Boolean).join(" · "),
    })),
    ...skus.map((sku) => ({ kind: "bulk" as const, targetId: sku.id, label: sku.name, imageUrl: sku.imageUrl, detail: ["Bulk item", sku.department?.name].filter(Boolean).join(" · ") })),
  ];
}


/** Copy the chosen details from the linked order onto the item. Admin picks the fields; nothing is automatic. */
export async function applyOrderToAsset(actor: Actor, linkId: string, fields: AutofillField[]) {
  return db.$transaction(async (tx) => {
    const link = await tx.budgetLineItem.findUnique({
      where: { id: linkId },
      select: {
        id: true,
        asset: { select: { id: true, purchaseDate: true, purchasePrice: true, linkUrl: true, notes: true } },
        budgetLine: {
          select: {
            description: true,
            supplier: true,
            unitCostCents: true,
            unitCostKnown: true,
            quantityBought: true,
            spentCents: true,
            purchasedOn: true,
            poNumber: true,
            orderNumber: true,
            linkUrl: true,
            budget: { select: { name: true, fiscalYear: true } },
          },
        },
      },
    });
    if (!link) throw new HttpError(404, "That link no longer exists.");
    if (!link.asset) throw new HttpError(400, "Only serialized items can take details from an order.");

    const line = link.budgetLine;
    const lineInput = {
      description: line.description,
      supplier: line.supplier,
      unitCostCents: line.unitCostCents,
      unitCostKnown: line.unitCostKnown,
      quantityBought: line.quantityBought,
      spentCents: line.spentCents,
      purchasedOn: dateOnly(line.purchasedOn),
      poNumber: line.poNumber,
      orderNumber: line.orderNumber,
      linkUrl: line.linkUrl,
      budgetName: line.budget.name,
      fiscalYear: line.budget.fiscalYear,
    };

    const data: Prisma.AssetUpdateInput = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const asset = link.asset;
    for (const field of new Set(fields)) {
      if (field === "purchaseDate") {
        if (!line.purchasedOn) throw new HttpError(400, "This order has no purchase date yet.");
        before.purchaseDate = dateOnly(asset.purchaseDate);
        data.purchaseDate = line.purchasedOn;
        after.purchaseDate = dateOnly(line.purchasedOn);
      } else if (field === "purchasePrice") {
        before.purchasePrice = asset.purchasePrice === null ? null : String(asset.purchasePrice);
        const cents = unitPriceCents(lineInput);
        if (cents === null) throw new HttpError(400, "This order has no recorded unit price.");
        data.purchasePrice = new Prisma.Decimal((cents / 100).toFixed(2));
        after.purchasePrice = (cents / 100).toFixed(2);
      } else if (field === "linkUrl") {
        if (!line.linkUrl) throw new HttpError(400, "This order has no product link.");
        before.linkUrl = asset.linkUrl;
        data.linkUrl = line.linkUrl;
        after.linkUrl = line.linkUrl;
      } else if (field === "notes") {
        before.notes = asset.notes;
        const next = applyNote(asset.notes, lineInput);
        data.notes = next;
        after.notes = next;
      }
    }
    if (Object.keys(data).length === 0) throw new HttpError(400, "Choose at least one detail to fill.");

    await tx.asset.update({ where: { id: asset.id }, data });
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "asset",
      entityId: asset.id,
      action: "fill_from_order",
      before: { ...before, budgetLineItemId: linkId },
      after,
    });
    return { assetId: asset.id, filled: Object.keys(after) };
  });
}


/** Drop, restore, or recategorize several lines at once. Returns each line's previous values so the caller can undo. */
export async function bulkUpdateLines(actor: Actor, budgetId: string, input: BulkLinesInput) {
  return db.$transaction(async (tx) => {
    const before = await tx.budgetLine.findMany({
      where: { budgetId, id: { in: input.lineIds } },
      select: { id: true, status: true, statusKnown: true, category: true },
    });
    if (before.length !== new Set(input.lineIds).size) throw new HttpError(404, "Some of those lines aren't in this budget.");
    await tx.budgetLine.updateMany({
      where: { budgetId, id: { in: input.lineIds } },
      data: { ...(input.status ? { status: input.status, statusKnown: input.statusKnown ?? true } : {}), ...(input.category ? { category: input.category } : {}) },
    });
    for (const line of before) {
      await createAuditEntryTx(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "budget_line",
        entityId: line.id,
        action: "update",
        before: { status: line.status, statusKnown: line.statusKnown, category: line.category },
        after: {
          status: input.status ?? line.status,
          statusKnown: input.status ? input.statusKnown ?? true : line.statusKnown,
          category: input.category ?? line.category,
        },
      });
    }
    return { previous: before };
  });
}

export type LineHistoryEntry = {
  id: string;
  action: string;
  at: string;
  actorName: string | null;
  changes: LineChange[];
};

/** What happened to a line, newest first, in plain words. */
export async function getLineHistory(lineId: string): Promise<LineHistoryEntry[]> {
  const rows = await db.auditLog.findMany({
    where: { entityType: "budget_line", entityId: lineId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, action: true, createdAt: true, beforeJson: true, afterJson: true, actor: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    at: row.createdAt.toISOString(),
    actorName: row.actor?.name ?? null,
    changes: describeLineChanges(row.beforeJson as Record<string, unknown> | null, row.afterJson as Record<string, unknown> | null),
  }));
}


export type BudgetTrendRow = {
  fiscalYear: string;
  submittedCents: number;
  spentCents: number;
  forecastCents: number;
  allocationCents: number | null;
  incomplete: boolean;
};

/** One budget name across fiscal years, oldest first, for the year-over-year view. */
export async function getBudgetTrend(name: string): Promise<BudgetTrendRow[]> {
  const budgets = await db.budget.findMany({
    where: { name },
    orderBy: { fiscalYear: "asc" },
    select: {
      fiscalYear: true,
      allocationCents: true,
      submittedCents: true,
      submittedUnknownCount: true,
      lines: { select: { status: true, statusKnown: true, category: true, unitCostCents: true, plannedTotalKnown: true, plannedOverrideCents: true, quantity: true, spentCents: true, refundCents: true, unplanned: true } },
    },
  });
  return budgets.map((budget) => {
    const summary = summarizeBudget(
      budget.lines.map((line) => ({ ...line, status: line.status as BudgetLineStatusValue, category: line.category as BudgetCategoryValue })),
      budget.allocationCents,
      { submittedCents: budget.submittedCents ?? null, submittedUnknownCount: budget.submittedUnknownCount ?? 0 },
    );
    return {
      fiscalYear: budget.fiscalYear,
      submittedCents: summary.submittedCents,
      spentCents: summary.spentCents,
      forecastCents: summary.forecastCents,
      allocationCents: budget.allocationCents,
      incomplete: summary.unknownSpentCount > 0 || summary.unknownPlannedCount > 0 || summary.unknownStatusCount > 0 || summary.statusSpendConflictCount > 0 || summary.submittedUnknownCount > 0,
    };
  });
}


/**
 * Save the reviewed lines of an import. A line with the same name (ignoring case) already in the budget is
 * updated, so running the import again doesn't duplicate anything.
 */
export async function importLines(actor: Actor, budgetId: string, input: ImportLinesInput) {
  return db.$transaction(async (tx) => {
    const budget = await tx.budget.findUnique({ where: { id: budgetId }, select: { id: true, submittedAt: true } });
    if (!budget) throw new HttpError(404, "Budget not found.");
    const existing = await tx.budgetLine.findMany({ where: { budgetId }, orderBy: { createdAt: "asc" }, select: { id: true, description: true } });
    // Lines can share a name (two "SD card" purchases), so each sheet row takes the next unused line of that name.
    const byName = new Map<string, string[]>();
    for (const line of existing) {
      const key = line.description.trim().toLowerCase();
      byName.set(key, [...(byName.get(key) ?? []), line.id]);
    }
    let created = 0;
    let updated = 0;
    for (const line of input.lines) {
      const data = {
        category: line.category,
        status: line.status,
        description: line.description,
        supplier: line.supplier,
        unitCostCents: line.unitCostCents,
        unitCostKnown: line.unitCostKnown,
        plannedTotalKnown: line.plannedTotalKnown,
        plannedOverrideCents: line.plannedOverrideCents ?? null,
        statusKnown: line.statusKnown,
        quantity: line.quantity,
        quantityBought: line.quantityBought ?? null,
        spentCents: line.spentCents,
        purchasedOn: toDate(line.purchasedOn) ?? null,
        poNumber: line.poNumber,
        orderNumber: line.orderNumber,
        unplanned: line.unplanned,
      };
      const matchId = byName.get(line.description.trim().toLowerCase())?.shift();
      if (matchId) {
        await tx.budgetLine.update({ where: { id: matchId }, data });
        updated += 1;
      } else {
        await tx.budgetLine.create({ data: { ...data, justification: line.justification ?? null, budgetId, unplanned: data.unplanned || budget.submittedAt != null }, select: { id: true } });
        created += 1;
      }
    }
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "budget",
      entityId: budgetId,
      action: "import",
      after: { created, updated },
    });
    return { created, updated };
  });
}
