import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { createAuditEntry } from "@/lib/audit";
import { HttpError } from "@/lib/http";

// ── Types ─────────────────────────────────────────────────

export type CreateKitInput = {
  name: string;
  description?: string | null;
  locationId: string;
};

export type UpdateKitInput = {
  name?: string;
  description?: string | null;
  active?: boolean;
};

export type ListKitsParams = {
  search?: string;
  locationId?: string;
  includeArchived?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  limit: number;
  offset: number;
};

// ── Includes ──────────────────────────────────────────────

const kitDetailInclude = {
  location: { select: { id: true, name: true } },
  members: {
    include: {
      asset: {
        select: {
          id: true,
          assetTag: true,
          name: true,
          type: true,
          brand: true,
          model: true,
          status: true,
          imageUrl: true,
          category: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
  bulkMembers: {
    include: {
      bulkSku: {
        select: { id: true, name: true, category: true, unit: true, imageUrl: true },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.KitInclude;

const kitListInclude = {
  location: { select: { id: true, name: true } },
  _count: { select: { members: true, bulkMembers: true } },
} satisfies Prisma.KitInclude;

// ── CRUD ──────────────────────────────────────────────────

export async function createKit(
  input: CreateKitInput,
  actorId: string,
  actorRole: Role
) {
  // Validate location exists
  const location = await db.location.findUnique({ where: { id: input.locationId } });
  if (!location) throw new HttpError(400, "Location not found");

  try {
    const kit = await db.kit.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        locationId: input.locationId,
      },
      include: kitDetailInclude,
    });

    await createAuditEntry({
      actorId,
      actorRole,
      entityType: "kit",
      entityId: kit.id,
      action: "create",
      after: { name: kit.name, description: kit.description, locationId: kit.locationId },
    });

    return kit;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new HttpError(409, "A kit with this name already exists at this location");
    }
    throw error;
  }
}

export async function updateKit(
  id: string,
  input: UpdateKitInput,
  actorId: string,
  actorRole: Role
) {
  const existing = await db.kit.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Kit not found");

  const data: Prisma.KitUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.active !== undefined) data.active = input.active;

  try {
    const kit = await db.kit.update({
      where: { id },
      data,
      include: kitDetailInclude,
    });

    await createAuditEntry({
      actorId,
      actorRole,
      entityType: "kit",
      entityId: kit.id,
      action: "update",
      before: { name: existing.name, description: existing.description, active: existing.active },
      after: { name: kit.name, description: kit.description, active: kit.active },
    });

    return kit;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new HttpError(409, "A kit with this name already exists at this location");
    }
    throw error;
  }
}

export async function deleteKit(
  id: string,
  actorId: string,
  actorRole: Role
) {
  const existing = await db.kit.findUnique({
    where: { id },
    include: { _count: { select: { members: true, bulkMembers: true } } },
  });
  if (!existing) throw new HttpError(404, "Kit not found");

  await db.kit.delete({ where: { id } });

  await createAuditEntry({
    actorId,
    actorRole,
    entityType: "kit",
    entityId: id,
    action: "delete",
    before: {
      name: existing.name,
      memberCount: existing._count.members + existing._count.bulkMembers,
      serializedMemberCount: existing._count.members,
      bulkMemberCount: existing._count.bulkMembers,
    },
  });
}

// ── Members ───────────────────────────────────────────────

export async function addKitMembers(
  kitId: string,
  assetIds: string[],
  actorId: string,
  actorRole: Role
) {
  const kit = await db.kit.findUnique({ where: { id: kitId } });
  if (!kit) throw new HttpError(404, "Kit not found");

  if (assetIds.length === 0) throw new HttpError(400, "No assets provided");

  // Verify all assets exist and are at the same location
  const assets = await db.asset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, assetTag: true, locationId: true },
  });

  if (assets.length !== assetIds.length) {
    throw new HttpError(400, "One or more assets not found");
  }

  const wrongLocation = assets.filter((a) => a.locationId !== kit.locationId);
  if (wrongLocation.length > 0) {
    throw new HttpError(
      400,
      `Assets must be at the same location as the kit (${kit.locationId}). Mismatched: ${wrongLocation.map((a) => a.assetTag).join(", ")}`
    );
  }

  try {
    await db.kitMembership.createMany({
      data: assetIds.map((assetId) => ({ kitId, assetId })),
      skipDuplicates: true,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new HttpError(409, "One or more assets are already in this kit");
    }
    throw error;
  }

  await createAuditEntry({
    actorId,
    actorRole,
    entityType: "kit",
    entityId: kitId,
    action: "add_members",
    after: { assetIds, assetTags: assets.map((a) => a.assetTag) },
  });

  return getKitDetail(kitId);
}

export async function removeKitMember(
  kitId: string,
  membershipId: string,
  actorId: string,
  actorRole: Role
) {
  const membership = await db.kitMembership.findUnique({
    where: { id: membershipId },
    include: { asset: { select: { assetTag: true } } },
  });
  if (!membership || membership.kitId !== kitId) {
    throw new HttpError(404, "Membership not found");
  }

  await db.kitMembership.delete({ where: { id: membershipId } });

  await createAuditEntry({
    actorId,
    actorRole,
    entityType: "kit",
    entityId: kitId,
    action: "remove_member",
    before: { assetId: membership.assetId, assetTag: membership.asset.assetTag },
  });
}

// ── Queries ───────────────────────────────────────────────

export async function getKitDetail(kitId: string) {
  const kit = await db.kit.findUnique({
    where: { id: kitId },
    include: kitDetailInclude,
  });
  if (!kit) throw new HttpError(404, "Kit not found");
  return kit;
}

export async function listKits(params: ListKitsParams) {
  const baseWhere: Prisma.KitWhereInput = {};

  if (params.search) {
    baseWhere.OR = [
      { name: { contains: params.search, mode: "insensitive" } },
      { description: { contains: params.search, mode: "insensitive" } },
    ];
  }

  if (params.locationId) {
    baseWhere.locationId = params.locationId;
  }

  const where: Prisma.KitWhereInput = params.includeArchived
    ? baseWhere
    : { ...baseWhere, active: true };

  const sortOrder = params.sortOrder ?? (params.sortBy === "name" ? "asc" : "desc");
  const orderBy: Prisma.KitOrderByWithRelationInput | Prisma.KitOrderByWithRelationInput[] =
    params.sortBy === "memberCount"
      ? [
          { members: { _count: sortOrder } },
          { bulkMembers: { _count: sortOrder } },
          { name: "asc" },
        ]
      : params.sortBy === "updatedAt"
        ? [{ updatedAt: sortOrder }, { name: "asc" }]
        : { name: sortOrder };

  const [data, statusCounts, empty] = await Promise.all([
    db.kit.findMany({
      where,
      include: kitListInclude,
      orderBy,
      take: params.limit,
      skip: params.offset,
    }),
    db.kit.groupBy({ by: ["active"], where: baseWhere, _count: { _all: true } }),
    db.kit.count({
      where: {
        ...where,
        members: { none: {} },
        bulkMembers: { none: {} },
      },
    }),
  ]);

  const active = statusCounts.find((group) => group.active)?._count._all ?? 0;
  const archived = statusCounts.find((group) => !group.active)?._count._all ?? 0;
  const total = params.includeArchived ? active + archived : active;

  return { data, total, summary: { total, active, archived, empty } };
}
