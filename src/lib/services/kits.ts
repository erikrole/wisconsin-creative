import { BookingStatus, FootballGamedayKitRole, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { HttpError } from "@/lib/http";
import {
  FOOTBALL_SPORT_CODE,
  footballGamedayKitRoleLabel,
} from "@/lib/football-gameday-kits";
import {
  kitPickupAliasNames,
  locationsShareKitPickup,
} from "@/lib/reservation-pickup-locations";
import { withSerializationRetry } from "@/lib/serialization";
import { unique } from "@/lib/utils";

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

// ── Types ─────────────────────────────────────────────────

export type CreateKitInput = {
  name: string;
  description?: string | null;
  locationId: string;
  sportCode?: string | null;
  gamedayRole?: FootballGamedayKitRole | null;
};

type UpdateKitInput = {
  name?: string;
  description?: string | null;
  active?: boolean;
  sportCode?: string | null;
  gamedayRole?: FootballGamedayKitRole | null;
};

type ListKitsParams = {
  search?: string;
  locationId?: string;
  includeArchived?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  limit: number;
  offset: number;
};

type KitEquipmentPlan = {
  kitId: string;
  name: string;
  serializedAssetIds: string[];
  bulkItems: Array<{ bulkSkuId: string; quantity: number }>;
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

function uniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

type LocationLookupClient = {
  location: {
    findUnique: (args: {
      where: { id: string };
      select: { name: true };
    }) => Promise<{ name: string } | null>;
    findMany: (args: {
      where: { name: { in: string[] } };
      select: { id: true };
    }) => Promise<Array<{ id: string }>>;
  };
};

async function resolveKitPickupLocationIds(
  client: LocationLookupClient,
  locationId: string,
  knownName?: string | null,
) {
  const name = knownName ?? (await client.location.findUnique({
    where: { id: locationId },
    select: { name: true },
  }))?.name;
  if (!name) return [locationId];
  const aliases = kitPickupAliasNames(name);
  if (aliases.length <= 1) return [locationId];
  const rows = await client.location.findMany({
    where: { name: { in: aliases } },
    select: { id: true },
  });
  return rows.length > 0 ? rows.map((row) => row.id) : [locationId];
}

const SUGGESTABLE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.BOOKED,
  BookingStatus.PENDING_PICKUP,
  BookingStatus.OPEN,
  BookingStatus.COMPLETED,
];

function exclusiveSportCode(sportCode: string | null | undefined) {
  return sportCode ?? null;
}

function resolveSportAndRole(
  sportCode: string | null | undefined,
  role: FootballGamedayKitRole | null | undefined,
) {
  const sport = exclusiveSportCode(sportCode);
  if (!role) return { sportCode: sport, gamedayRole: null as FootballGamedayKitRole | null };
  if (sport && sport !== FOOTBALL_SPORT_CODE) {
    throw new HttpError(400, "SLOW1, BENCH, and ROAM kits are football jobs");
  }
  return { sportCode: FOOTBALL_SPORT_CODE, gamedayRole: role };
}

async function assertUniqueGamedayRole(
  tx: Prisma.TransactionClient,
  input: {
    kitId?: string;
    locationId: string;
    locationName?: string | null;
    gamedayRole: FootballGamedayKitRole | null;
  },
) {
  if (!input.gamedayRole) return;
  const locationIds = await resolveKitPickupLocationIds(tx, input.locationId, input.locationName);
  const collision = await tx.kit.findFirst({
    where: {
      ...(input.kitId ? { id: { not: input.kitId } } : {}),
      active: true,
      gamedayRole: input.gamedayRole,
      locationId: locationIds.length === 1 ? locationIds[0] : { in: locationIds },
    },
    select: { name: true },
  });
  if (!collision) return;
  const job = footballGamedayKitRoleLabel(input.gamedayRole) ?? input.gamedayRole;
  throw new HttpError(409, `${job} already has a kit at this pickup`);
}

function kitUniqueConflictMessage(error: unknown) {
  const target = error instanceof Prisma.PrismaClientKnownRequestError
    ? JSON.stringify(error.meta ?? {})
    : "";
  if (target.includes("gameday_role") || target.includes("gamedayRole")) {
    return "That football job already has a kit at this pickup";
  }
  return "A kit with this name already exists at this location";
}

async function assertExclusiveSerializedMembers(
  tx: Prisma.TransactionClient,
  input: { kitId: string; sportCode: string | null; assetIds: string[] },
) {
  if (input.assetIds.length === 0) return;
  const collisions = await tx.kitMembership.findMany({
    where: {
      assetId: { in: input.assetIds },
      kit: {
        id: { not: input.kitId },
        active: true,
        sportCode: exclusiveSportCode(input.sportCode),
      },
    },
    select: {
      asset: { select: { assetTag: true } },
      kit: { select: { name: true } },
    },
  });
  if (collisions.length === 0) return;
  throw new HttpError(
    409,
    collisions
      .map((row) => `${row.asset.assetTag} is already in ${row.kit.name}`)
      .join("; "),
  );
}

async function nextCopiedKitName(
  tx: Prisma.TransactionClient,
  locationId: string,
  sourceName: string,
) {
  const base = `${sourceName} copy`;
  const existing = await tx.kit.findMany({
    where: { locationId, name: { startsWith: base } },
    select: { name: true },
  });
  const taken = new Set(existing.map((row) => row.name));
  if (!taken.has(base)) return base;
  for (let index = 2; index <= 50; index += 1) {
    const candidate = `${base} ${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new HttpError(409, "Could not create a unique copy name at this location");
}

// ── CRUD ──────────────────────────────────────────────────

export async function createKit(
  input: CreateKitInput,
  actorId: string,
  actorRole: Role
) {
  const location = await db.location.findUnique({ where: { id: input.locationId } });
  if (!location) throw new HttpError(400, "Location not found");
  const { sportCode, gamedayRole } = resolveSportAndRole(input.sportCode, input.gamedayRole);

  try {
    return await withSerializationRetry(() =>
      db.$transaction(async (tx) => {
        await assertUniqueGamedayRole(tx, {
          locationId: input.locationId,
          locationName: location.name,
          gamedayRole,
        });
        const kit = await tx.kit.create({
          data: {
            name: input.name.trim(),
            description: input.description?.trim() || null,
            locationId: input.locationId,
            sportCode,
            gamedayRole,
          },
          include: kitDetailInclude,
        });

        await createAuditEntryTx(tx, {
          actorId,
          actorRole,
          entityType: "kit",
          entityId: kit.id,
          action: "create",
          after: {
            name: kit.name,
            description: kit.description,
            locationId: kit.locationId,
            sportCode: kit.sportCode,
            gamedayRole: kit.gamedayRole,
          },
        });

        return kit;
      }, SERIALIZABLE)
    );
  } catch (error) {
    if (uniqueConstraintError(error)) {
      throw new HttpError(409, kitUniqueConflictMessage(error));
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
  try {
    return await withSerializationRetry(() =>
      db.$transaction(async (tx) => {
        const existing = await tx.kit.findUnique({
          where: { id },
          include: { location: { select: { name: true } } },
        });
        if (!existing) throw new HttpError(404, "Kit not found");

        const nextActive = input.active !== undefined ? input.active : existing.active;
        const nextRoleInput = input.gamedayRole !== undefined
          ? input.gamedayRole
          : (input.sportCode !== undefined && exclusiveSportCode(input.sportCode) !== FOOTBALL_SPORT_CODE)
            ? null
            : existing.gamedayRole;
        const nextSportInput = input.sportCode !== undefined
          ? exclusiveSportCode(input.sportCode)
          : existing.sportCode;
        const { sportCode, gamedayRole } = resolveSportAndRole(nextSportInput, nextRoleInput);

        const data: Prisma.KitUpdateInput = {};
        if (input.name !== undefined) data.name = input.name.trim();
        if (input.description !== undefined) data.description = input.description?.trim() || null;
        if (input.active !== undefined) data.active = input.active;
        if (input.sportCode !== undefined || sportCode !== existing.sportCode) data.sportCode = sportCode;
        if (input.gamedayRole !== undefined || gamedayRole !== existing.gamedayRole) data.gamedayRole = gamedayRole;

        if (nextActive && gamedayRole) {
          await assertUniqueGamedayRole(tx, {
            kitId: id,
            locationId: existing.locationId,
            locationName: existing.location.name,
            gamedayRole,
          });
        }
        if (nextActive) {
          const members = await tx.kitMembership.findMany({
            where: { kitId: id },
            select: { assetId: true },
          });
          await assertExclusiveSerializedMembers(tx, {
            kitId: id,
            sportCode,
            assetIds: members.map((member) => member.assetId),
          });
        }

        const kit = await tx.kit.update({
          where: { id },
          data,
          include: kitDetailInclude,
        });

        await createAuditEntryTx(tx, {
          actorId,
          actorRole,
          entityType: "kit",
          entityId: kit.id,
          action: "update",
          before: {
            name: existing.name,
            description: existing.description,
            active: existing.active,
            sportCode: existing.sportCode,
            gamedayRole: existing.gamedayRole,
          },
          after: {
            name: kit.name,
            description: kit.description,
            active: kit.active,
            sportCode: kit.sportCode,
            gamedayRole: kit.gamedayRole,
          },
        });

        return kit;
      }, SERIALIZABLE)
    );
  } catch (error) {
    if (uniqueConstraintError(error)) {
      throw new HttpError(409, kitUniqueConflictMessage(error));
    }
    throw error;
  }
}

export async function deleteKit(
  id: string,
  actorId: string,
  actorRole: Role
) {
  await withSerializationRetry(() =>
    db.$transaction(async (tx) => {
      const existing = await tx.kit.findUnique({
        where: { id },
        include: { _count: { select: { members: true, bulkMembers: true } } },
      });
      if (!existing) throw new HttpError(404, "Kit not found");

      await tx.kit.delete({ where: { id } });

      await createAuditEntryTx(tx, {
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
    }, SERIALIZABLE)
  );
}

export async function cloneKit(
  id: string,
  actorId: string,
  actorRole: Role
) {
  try {
    return await withSerializationRetry(() =>
      db.$transaction(async (tx) => {
        const source = await tx.kit.findUnique({
          where: { id },
          include: {
            bulkMembers: { select: { bulkSkuId: true, quantity: true } },
          },
        });
        if (!source) throw new HttpError(404, "Kit not found");

        const name = await nextCopiedKitName(tx, source.locationId, source.name);
        const kit = await tx.kit.create({
          data: {
            name,
            description: source.description,
            locationId: source.locationId,
            sportCode: source.sportCode,
            // Copies cannot take SLOW1–ROAM4; those jobs stay unique at pickup.
            bulkMembers: {
              create: source.bulkMembers.map((member) => ({
                bulkSkuId: member.bulkSkuId,
                quantity: member.quantity,
              })),
            },
          },
          include: kitDetailInclude,
        });

        await createAuditEntryTx(tx, {
          actorId,
          actorRole,
          entityType: "kit",
          entityId: kit.id,
          action: "cloned",
          after: {
            sourceKitId: source.id,
            sourceName: source.name,
            name: kit.name,
            sportCode: kit.sportCode,
            gamedayRole: null,
            serializedMemberCount: 0,
            bulkMemberCount: source.bulkMembers.length,
          },
        });

        return kit;
      }, SERIALIZABLE)
    );
  } catch (error) {
    if (uniqueConstraintError(error)) {
      throw new HttpError(409, kitUniqueConflictMessage(error));
    }
    throw error;
  }
}

export async function suggestFootballGamedayKit(params: {
  requesterUserId: string;
  locationId: string;
}) {
  const location = await db.location.findUnique({
    where: { id: params.locationId },
    select: { name: true },
  });
  if (!location) return null;
  const locationIds = await resolveKitPickupLocationIds(db, params.locationId, location.name);
  const last = await db.booking.findFirst({
    where: {
      requesterUserId: params.requesterUserId,
      kitId: { not: null },
      status: { in: SUGGESTABLE_BOOKING_STATUSES },
      locationId: locationIds.length === 1 ? locationIds[0] : { in: locationIds },
      kit: { gamedayRole: { not: null } },
    },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    select: { kit: { select: { gamedayRole: true } } },
  });
  const gamedayRole = last?.kit?.gamedayRole;
  if (!gamedayRole) return null;
  const current = await db.kit.findFirst({
    where: {
      active: true,
      gamedayRole,
      locationId: locationIds.length === 1 ? locationIds[0] : { in: locationIds },
      OR: [{ members: { some: {} } }, { bulkMembers: { some: {} } }],
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });
  return current?.id ?? null;
}

// ── Members ───────────────────────────────────────────────

export async function addKitMembers(
  kitId: string,
  assetIds: string[],
  actorId: string,
  actorRole: Role,
  options: { allowAlreadyMembers?: boolean } = {},
) {
  if (assetIds.length === 0) throw new HttpError(400, "No assets provided");
  const uniqueAssetIds = unique(assetIds);

  return withSerializationRetry(() =>
    db.$transaction(async (tx) => {
      const kit = await tx.kit.findUnique({
        where: { id: kitId },
        include: { location: { select: { name: true } } },
      });
      if (!kit) throw new HttpError(404, "Kit not found");

      const assets = await tx.asset.findMany({
        where: { id: { in: uniqueAssetIds } },
        select: {
          id: true,
          assetTag: true,
          locationId: true,
          location: { select: { name: true } },
        },
      });

      if (assets.length !== uniqueAssetIds.length) {
        throw new HttpError(400, "One or more assets not found");
      }

      const wrongLocation = assets.filter(
        (asset) => !locationsShareKitPickup(kit.location.name, asset.location.name),
      );
      if (wrongLocation.length > 0) {
        throw new HttpError(
          400,
          `These items belong to a different location than ${kit.location.name}: ${wrongLocation.map((asset) => asset.assetTag).join(", ")}`,
        );
      }

      await assertExclusiveSerializedMembers(tx, {
        kitId,
        sportCode: kit.sportCode,
        assetIds: uniqueAssetIds,
      });

      const existing = await tx.kitMembership.findMany({
        where: { kitId, assetId: { in: uniqueAssetIds } },
        select: { assetId: true },
      });
      const existingIds = new Set(existing.map((row) => row.assetId));
      const addedAssetIds = uniqueAssetIds.filter((assetId) => !existingIds.has(assetId));

      if (addedAssetIds.length === 0) {
        if (options.allowAlreadyMembers) {
          return { kit: await tx.kit.findUniqueOrThrow({ where: { id: kitId }, include: kitDetailInclude }), addedAssetIds };
        }
        throw new HttpError(409, "Those items are already in this kit");
      }

      await tx.kitMembership.createMany({
        data: addedAssetIds.map((assetId) => ({ kitId, assetId })),
      });

      const addedAssets = assets.filter((asset) => addedAssetIds.includes(asset.id));
      await createAuditEntryTx(tx, {
        actorId,
        actorRole,
        entityType: "kit",
        entityId: kitId,
        action: "add_members",
        after: {
          assetIds: addedAssetIds,
          assetTags: addedAssets.map((asset) => asset.assetTag),
          skippedAlreadyMembers: uniqueAssetIds.length - addedAssetIds.length,
        },
      });

      return {
        kit: await tx.kit.findUniqueOrThrow({ where: { id: kitId }, include: kitDetailInclude }),
        addedAssetIds,
      };
    }, SERIALIZABLE)
  );
}

export async function removeKitMember(
  kitId: string,
  membershipId: string,
  actorId: string,
  actorRole: Role
) {
  await withSerializationRetry(() =>
    db.$transaction(async (tx) => {
      const membership = await tx.kitMembership.findUnique({
        where: { id: membershipId },
        include: { asset: { select: { assetTag: true } } },
      });
      if (!membership || membership.kitId !== kitId) {
        throw new HttpError(404, "Membership not found");
      }

      await tx.kitMembership.delete({ where: { id: membershipId } });

      await createAuditEntryTx(tx, {
        actorId,
        actorRole,
        entityType: "kit",
        entityId: kitId,
        action: "remove_member",
        before: { assetId: membership.assetId, assetTag: membership.asset.assetTag },
      });
    }, SERIALIZABLE)
  );
}

export async function addKitBulkMember(
  kitId: string,
  input: { bulkSkuId: string; quantity: number },
  actorId: string,
  actorRole: Role,
) {
  return withSerializationRetry(() =>
    db.$transaction(async (tx) => {
      const kit = await tx.kit.findUnique({
        where: { id: kitId },
        include: { location: { select: { name: true } } },
      });
      if (!kit) throw new HttpError(404, "Kit not found");

      const bulkSku = await tx.bulkSku.findUnique({
        where: { id: input.bulkSkuId },
        select: {
          id: true,
          name: true,
          locationId: true,
          active: true,
          location: { select: { name: true } },
        },
      });
      if (!bulkSku) throw new HttpError(404, "Item family not found");
      if (!bulkSku.active) {
        throw new HttpError(400, `${bulkSku.name} is archived and cannot be added to a kit`);
      }
      if (!locationsShareKitPickup(kit.location.name, bulkSku.location.name)) {
        throw new HttpError(400, `${bulkSku.name} belongs to a different location than ${kit.location.name}`);
      }

      const membership = await tx.kitBulkMembership.upsert({
        where: { kitId_bulkSkuId: { kitId, bulkSkuId: input.bulkSkuId } },
        create: { kitId, bulkSkuId: input.bulkSkuId, quantity: input.quantity },
        update: { quantity: input.quantity },
        include: { bulkSku: { select: { id: true, name: true, category: true, unit: true, imageUrl: true } } },
      });

      await createAuditEntryTx(tx, {
        actorId,
        actorRole,
        entityType: "kit",
        entityId: kitId,
        action: "bulk_member_added",
        after: { bulkSkuId: input.bulkSkuId, quantity: input.quantity, bulkSkuName: bulkSku.name },
      });

      return membership;
    }, SERIALIZABLE)
  );
}

export async function removeKitBulkMember(
  kitId: string,
  membershipId: string,
  actorId: string,
  actorRole: Role,
) {
  await withSerializationRetry(() =>
    db.$transaction(async (tx) => {
      const membership = await tx.kitBulkMembership.findUnique({
        where: { id: membershipId },
        include: { bulkSku: { select: { name: true, unit: true } } },
      });
      if (!membership || membership.kitId !== kitId) {
        throw new HttpError(404, "Bulk membership not found");
      }

      await tx.kitBulkMembership.delete({ where: { id: membershipId } });

      await createAuditEntryTx(tx, {
        actorId,
        actorRole,
        entityType: "kit",
        entityId: kitId,
        action: "bulk_member_removed",
        before: {
          membershipId,
          bulkSkuId: membership.bulkSkuId,
          bulkSkuName: membership.bulkSku.name,
          quantity: membership.quantity,
          unit: membership.bulkSku.unit,
        },
      });
    }, SERIALIZABLE)
  );
}

// ── Queries ───────────────────────────────────────────────

export async function getKitDetail(kitId: string) {
  const kit = await db.kit.findUnique({
    where: { id: kitId },
    include: kitDetailInclude,
  });
  if (!kit) throw new HttpError(404, "Kit not found");
  const pickupLocationIds = await resolveKitPickupLocationIds(db, kit.locationId, kit.location.name);
  return { ...kit, pickupLocationIds };
}

export async function loadKitEquipmentPlan(
  tx: Prisma.TransactionClient,
  kitId: string,
  locationId: string,
): Promise<KitEquipmentPlan> {
  const kit = await tx.kit.findUnique({
    where: { id: kitId },
    select: {
      id: true,
      name: true,
      active: true,
      locationId: true,
      location: { select: { name: true } },
      members: { select: { assetId: true }, orderBy: { createdAt: "asc" } },
      bulkMembers: { select: { bulkSkuId: true, quantity: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!kit) throw new HttpError(404, "Kit not found");
  if (!kit.active) {
    throw new HttpError(400, `${kit.name} is archived and cannot be added to a booking`);
  }
  const pickup = await tx.location.findUnique({
    where: { id: locationId },
    select: { name: true },
  });
  if (!pickup || !locationsShareKitPickup(kit.location.name, pickup.name)) {
    throw new HttpError(400, `${kit.name} belongs to ${kit.location.name}, not this pickup location`);
  }
  return {
    kitId: kit.id,
    name: kit.name,
    serializedAssetIds: kit.members.map((member) => member.assetId),
    bulkItems: kit.bulkMembers.map((member) => ({
      bulkSkuId: member.bulkSkuId,
      quantity: member.quantity,
    })),
  };
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
    const locationIds = await resolveKitPickupLocationIds(db, params.locationId);
    baseWhere.locationId = locationIds.length === 1 ? locationIds[0] : { in: locationIds };
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
