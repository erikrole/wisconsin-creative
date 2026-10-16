import { Prisma, type Role } from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { applyNote, buildAutofill, unitPriceCents, type AutofillField, type AutofillProposal } from "@/lib/budget/autofill";
import { scoreLineItemMatch, tokens, type MatchItem, type MatchLine, type MatchResult } from "@/lib/budget/matching";
import { summarizeBudget, type BudgetCategoryValue, type BudgetLineStatusValue } from "@/lib/budget/contract";
import type {
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

export type BudgetLineLinkView = {
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
    href: `/bulk-inventory`,
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
      notes: true,
      lines: { select: lineSelect, orderBy: [{ createdAt: "asc" }] },
    },
  });
  if (!budget) throw new HttpError(404, "Budget not found.");
  const { lines, ...rest } = budget;
  const summary = summarizeBudget(
    lines.map((line) => ({
      status: line.status as BudgetLineStatusValue,
      category: line.category as BudgetCategoryValue,
      unitCostCents: line.unitCostCents,
      quantity: line.quantity,
      spentCents: line.spentCents,
    })),
    rest.allocationCents,
  );
  return { budget: rest, lines: lines.map(toLineView), summary };
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
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "budget",
      entityId: budget.id,
      action: "create",
      after: budget,
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

async function assertRequester(tx: Prisma.TransactionClient, userId: string | null | undefined) {
  if (!userId) return;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new HttpError(404, "That requester isn't a person on the site.");
}

export async function createLine(actor: Actor, budgetId: string, input: CreateLineInput) {
  return db.$transaction(async (tx) => {
    const budget = await tx.budget.findUnique({ where: { id: budgetId }, select: { id: true } });
    if (!budget) throw new HttpError(404, "Budget not found.");
    await assertRequester(tx, input.requesterUserId);
    const row = await tx.budgetLine.create({
      data: {
        budgetId,
        category: input.category,
        status: input.status,
        description: input.description,
        supplier: input.supplier ?? null,
        unitCostCents: input.unitCostCents,
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
      },
      select: lineSelect,
    });
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
    const { purchasedOn, ...rest } = input;
    const row = await tx.budgetLine.update({
      where: { id: lineId },
      data: { ...rest, ...(purchasedOn !== undefined ? { purchasedOn: toDate(purchasedOn) } : {}) },
      select: lineSelect,
    });
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
  suggestedQuantity: number;
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
  purchasedOn: Date | null;
  poNumber: string | null;
  orderNumber: string | null;
}): MatchLine {
  return { ...line, purchasedOn: dateOnly(line.purchasedOn) };
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
      quantity: true,
      quantityBought: true,
      purchasedOn: true,
      poNumber: true,
      orderNumber: true,
    },
  });
  if (!line) throw new HttpError(404, "Budget line not found.");
  const match = lineToMatch(line);

  const price = line.unitCostCents / 100;
  const priceBand = { gte: price * 0.97, lte: price * 1.03 };
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
        OR: [{ purchasePrice: priceBand }, ...(dateBand ? [{ purchaseDate: dateBand }] : []), ...words],
      },
      take: CANDIDATE_LIMIT,
      select: { id: true, assetTag: true, name: true, brand: true, model: true, purchasePrice: true, purchaseDate: true, notes: true, imageUrl: true },
    }),
    db.bulkSku.findMany({
      where: {
        active: true,
        OR: [{ purchasePrice: priceBand }, ...tokens(line.description).filter((w) => w.length >= 3).slice(0, 6).map((word) => ({ name: { contains: word, mode: "insensitive" as const } }))],
      },
      take: CANDIDATE_LIMIT,
      select: { id: true, name: true, purchasePrice: true, notes: true, imageUrl: true },
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
    };
    const result = scoreLineItemMatch(match, item);
    if (!result) continue;
    out.push({
      ...result,
      kind: "asset",
      targetId: asset.id,
      label: asset.name?.trim() || `${asset.brand} ${asset.model}`.trim(),
      imageUrl: asset.imageUrl,
      detail: asset.assetTag,
      href: `/items/${asset.id}`,
      suggestedQuantity: 1,
    });
  }
  for (const sku of skus) {
    const item: MatchItem = { name: sku.name, brand: "", model: "", purchasePriceCents: toCents(sku.purchasePrice), purchaseDate: null, notes: sku.notes };
    const result = scoreLineItemMatch(match, item);
    if (!result) continue;
    out.push({
      ...result,
      kind: "bulk",
      targetId: sku.id,
      label: sku.name,
      imageUrl: sku.imageUrl,
      detail: "Bulk item",
      href: "/bulk-inventory",
      suggestedQuantity: line.quantityBought ?? line.quantity,
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
  };
  const priceCents = item.purchasePriceCents;
  const windowMs = 60 * 86_400_000;
  const lines = await db.budgetLine.findMany({
    where: {
      status: { not: "CANCELLED" },
      OR: [
        ...(priceCents !== null ? [{ unitCostCents: { gte: Math.floor(priceCents * 0.97), lte: Math.ceil(priceCents * 1.03) } }] : []),
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
      select: { id: true, assetTag: true, name: true, brand: true, model: true, imageUrl: true },
    }),
    db.bulkSku.findMany({
      where: { active: true, name: { contains: q, mode: "insensitive" } },
      take: 4,
      orderBy: { name: "asc" },
      select: { id: true, name: true, imageUrl: true },
    }),
  ]);
  return [
    ...assets.map((asset) => ({
      kind: "asset" as const,
      targetId: asset.id,
      label: asset.name?.trim() || `${asset.brand} ${asset.model}`.trim(),
      imageUrl: asset.imageUrl,
      detail: asset.assetTag,
    })),
    ...skus.map((sku) => ({ kind: "bulk" as const, targetId: sku.id, label: sku.name, imageUrl: sku.imageUrl, detail: "Bulk item" })),
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
