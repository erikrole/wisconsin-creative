import { Prisma, type Role } from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { linkDomain } from "@/lib/wishlist/contract";
import type { CreateWishInput, PromoteWishInput, UpdateWishInput } from "@/lib/wishlist/schemas";

type Actor = { id: string; role: Role };

const wishSelect = {
  id: true,
  title: true,
  linkUrl: true,
  estimateCents: true,
  quantity: true,
  neededBy: true,
  reason: true,
  status: true,
  statusNote: true,
  requestedById: true,
  budgetLineId: true,
  createdAt: true,
  requestedBy: { select: { id: true, name: true } },
  budgetLine: { select: { id: true, budgetId: true } },
} satisfies Prisma.WishItemSelect;

type WishRow = Prisma.WishItemGetPayload<{ select: typeof wishSelect }>;

export type WishView = {
  id: string;
  title: string;
  linkUrl: string | null;
  estimateCents: number | null;
  quantity: number;
  neededBy: string | null;
  reason: string | null;
  status: WishRow["status"];
  statusNote: string | null;
  requestedById: string | null;
  requestedByName: string | null;
  budgetId: string | null;
  budgetLineId: string | null;
  createdAt: string;
};

function toView(row: WishRow): WishView {
  return {
    id: row.id,
    title: row.title,
    linkUrl: row.linkUrl,
    estimateCents: row.estimateCents,
    quantity: row.quantity,
    neededBy: row.neededBy ? row.neededBy.toISOString().slice(0, 10) : null,
    reason: row.reason,
    status: row.status,
    statusNote: row.statusNote,
    requestedById: row.requestedById,
    requestedByName: row.requestedBy?.name ?? null,
    budgetId: row.budgetLine?.budgetId ?? null,
    budgetLineId: row.budgetLineId,
    createdAt: row.createdAt.toISOString(),
  };
}

const toDate = (value: string | null | undefined) => (value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00.000Z`));

/** Every wish, newest first. Staff and admins see all of them. */
export async function listWishes(): Promise<WishView[]> {
  const rows = await db.wishItem.findMany({ select: wishSelect, orderBy: { createdAt: "desc" } });
  return rows.map(toView);
}

export async function createWish(actor: Actor, input: CreateWishInput): Promise<WishView> {
  return db.$transaction(async (tx) => {
    const row = await tx.wishItem.create({
      data: {
        title: input.title,
        linkUrl: input.linkUrl ?? null,
        estimateCents: input.estimateCents ?? null,
        quantity: input.quantity,
        neededBy: toDate(input.neededBy) ?? null,
        reason: input.reason ?? null,
        requestedById: actor.id,
      },
      select: wishSelect,
    });
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "wish_item",
      entityId: row.id,
      action: "create",
      after: toView(row),
    });
    return toView(row);
  });
}

/** The requester may edit their own open wish; admins may edit any and also decide it. */
export async function updateWish(actor: Actor, wishId: string, input: UpdateWishInput): Promise<WishView> {
  return db.$transaction(async (tx) => {
    const before = await tx.wishItem.findUnique({ where: { id: wishId }, select: wishSelect });
    if (!before) throw new HttpError(404, "Wish not found.");
    const isAdmin = actor.role === "ADMIN";
    if (!isAdmin && (before.requestedById !== actor.id || before.status !== "OPEN")) {
      throw new HttpError(403, "You can only edit your own open wishes.");
    }
    if (!isAdmin && (input.status !== undefined || input.statusNote !== undefined)) {
      throw new HttpError(403, "Only admins can approve or decline a wish.");
    }
    if (before.status === "IN_BUDGET") throw new HttpError(409, "This wish is already in the budget. Edit its budget line instead.");
    const { neededBy, ...rest } = input;
    const row = await tx.wishItem.update({
      where: { id: wishId },
      data: { ...rest, ...(neededBy !== undefined ? { neededBy: toDate(neededBy) } : {}) },
      select: wishSelect,
    });
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "wish_item",
      entityId: wishId,
      action: "update",
      before: toView(before),
      after: toView(row),
    });
    return toView(row);
  });
}

export async function deleteWish(actor: Actor, wishId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.wishItem.findUnique({ where: { id: wishId }, select: wishSelect });
    if (!before) throw new HttpError(404, "Wish not found.");
    if (actor.role !== "ADMIN" && (before.requestedById !== actor.id || before.status !== "OPEN")) {
      throw new HttpError(403, "You can only remove your own open wishes.");
    }
    await tx.wishItem.delete({ where: { id: wishId } });
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "wish_item",
      entityId: wishId,
      action: "delete",
      before: toView(before),
    });
    return { id: wishId };
  });
}

/** Admin: turn a wish into a planned line on a budget. The wish stays, now linked to that line. */
export async function promoteWish(actor: Actor, wishId: string, input: PromoteWishInput) {
  return db.$transaction(async (tx) => {
    const wish = await tx.wishItem.findUnique({ where: { id: wishId }, select: wishSelect });
    if (!wish) throw new HttpError(404, "Wish not found.");
    if (wish.status === "IN_BUDGET") throw new HttpError(409, "This wish is already in the budget.");
    if (wish.status === "DECLINED") throw new HttpError(409, "Re-open this wish before moving it to the budget.");
    const budget = await tx.budget.findUnique({ where: { id: input.budgetId }, select: { id: true, submittedAt: true } });
    if (!budget) throw new HttpError(404, "Budget not found.");
    const line = await tx.budgetLine.create({
      data: {
        budgetId: input.budgetId,
        category: input.category,
        status: "PLANNED",
        description: wish.title,
        supplier: linkDomain(wish.linkUrl),
        unitCostCents: input.unitCostCents,
        quantity: input.quantity,
        linkUrl: wish.linkUrl,
        justification: wish.reason,
        requesterUserId: wish.requestedById,
        unplanned: input.unplanned || budget.submittedAt != null,
      },
      select: { id: true, budgetId: true },
    });
    const row = await tx.wishItem.update({
      where: { id: wishId },
      data: { status: "IN_BUDGET", budgetLineId: line.id },
      select: wishSelect,
    });
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "wish_item",
      entityId: wishId,
      action: "promote",
      before: toView(wish),
      after: toView(row),
    });
    return toView(row);
  });
}
