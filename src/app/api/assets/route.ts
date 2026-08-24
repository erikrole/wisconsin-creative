import { z } from "zod";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError, ok, parsePagination } from "@/lib/http";
import { requirePermission, requirePermissionOrCollaboratorCapability } from "@/lib/rbac";
import { buildDerivedStatusWhere, enrichAssetsWithStatusFromLoaded } from "@/lib/services/status";
import { buildActiveBulkUnitAllocationMap } from "@/lib/bulk-unit-status";
import { summarizeItemFamilyState } from "@/lib/item-family-state";
import { parseDerivedBulkUnitQr } from "@/lib/bulk-unit-qr";
import { compareItemAssetTags, getAssetTagSearchAliases } from "@/lib/item-asset-tag-sort";
import { databaseIdSchema, moneyDecimalSchema, nullableHttpUrlSchema } from "@/lib/validation";
import { AssetStatus, BookingKind, BookingStatus, Prisma } from "@prisma/client";
import {
  sanitizeCollaboratorBulkItem,
  sanitizeCollaboratorPickerAsset,
} from "@/lib/collaborator-gear";

const GAP_SUGGESTION_SOURCE_LIMIT = 5000;

const createAssetSchema = z.object({
  assetTag: z.string().min(1),
  name: z.string().max(500).optional(),
  type: z.string().min(1),
  brand: z.string().min(1),
  model: z.string().min(1),
  serialNumber: z.string().optional(),
  qrCodeValue: z.string().min(1),
  purchaseDate: z.string().date().optional(),
  purchasePrice: moneyDecimalSchema.optional(),
  warrantyDate: z.string().date().optional(),
  residualValue: moneyDecimalSchema.optional(),
  locationId: databaseIdSchema,
  categoryId: databaseIdSchema.optional(),
  departmentId: databaseIdSchema.optional(),
  linkUrl: nullableHttpUrlSchema.optional(),
  uwAssetTag: z.string().max(200).optional(),
  parentAssetId: z.string().cuid().optional(),
  availableForReservation: z.boolean().optional(),
  availableForCheckout: z.boolean().optional(),
  availableForCustody: z.boolean().optional(),
  status: z.enum(["AVAILABLE", "MAINTENANCE", "RETIRED"]).default("AVAILABLE"),
  notes: z.string().max(10000).optional()
});

const assetInclude = {
  location: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  _count: { select: { accessories: true } },
};

const bulkSkuInclude = {
  location: { select: { name: true } },
  categoryRel: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  balances: { select: { onHandQuantity: true } },
  units: { select: { id: true, unitNumber: true, status: true } },
};

type AssetListRow = Prisma.AssetGetPayload<{ include: typeof assetInclude }>;
type BulkSkuListRow = Prisma.BulkSkuGetPayload<{ include: typeof bulkSkuInclude }>;
type DerivedBulkUnitQr = ReturnType<typeof parseDerivedBulkUnitQr>;
type ItemKindFilter = "all" | "serialized" | "unit-tracked" | "quantity-tracked";
type PopularityKind = "asset" | "bulk";

type PopularityKey = `${PopularityKind}:${string}`;

type PopularityScore = {
  score: number;
  lastActivityAt: number;
};

type BulkListItem = {
  id: string;
  kind: "bulk";
  name: string;
  category: string;
  unit: string;
  trackByNumber: boolean;
  onHandQuantity: number;
  availableQuantity: number;
  checkedOutQuantity: number;
  lostQuantity: number;
  retiredQuantity: number;
  matchedUnitNumber?: number;
  matchedUnitStatus?: string;
  matchedUnitHolder?: string | null;
  matchedUnitHolderAvatarUrl?: string | null;
  matchedUnitDueAt?: string | null;
  matchedUnitBookingTitle?: string | null;
  matchedUnitBookingId?: string | null;
  units?: Array<{ unitNumber: number; status: string }>;
  imageUrl: string | null;
  locationName: string;
  locationId: string;
  categoryId: string | null;
  departmentId: string | null;
  departmentName: string | null;
  binQrCodeValue: string;
  isFavorited?: boolean;
};

async function loadOperationallySortedAssets(
  where: Prisma.AssetWhereInput,
  descending: boolean,
  offset: number,
  limit: number
): Promise<[AssetListRow[], number]> {
  const [rows, total] = await Promise.all([
    db.asset.findMany({
      where,
      include: assetInclude,
      orderBy: { assetTag: "asc" },
    }),
    db.asset.count({ where }),
  ]);

  rows.sort((a, b) => compareItemAssetTags(a.assetTag, b.assetTag));
  if (descending) rows.reverse();

  return [rows.slice(offset, offset + limit), total];
}

function readItemKindFilter(value: string | null): ItemKindFilter {
  if (value === "bulk") return "unit-tracked";
  if (value === "serialized" || value === "unit-tracked" || value === "quantity-tracked") return value;
  return "all";
}

async function buildBulkListItems(
  bulkSkus: BulkSkuListRow[],
  derivedBulkUnitQr: DerivedBulkUnitQr
): Promise<BulkListItem[]> {
  const bulkUnitIds = bulkSkus.flatMap((sku) => sku.units.map((unit) => unit.id));
  const activeUnitAllocations = bulkUnitIds.length > 0
    ? await db.bookingBulkUnitAllocation.findMany({
        where: {
          bulkSkuUnitId: { in: bulkUnitIds },
          checkedOutAt: { not: null },
          checkedInAt: null,
        },
        select: {
          bulkSkuUnitId: true,
          bookingBulkItem: {
            select: {
              booking: {
                select: {
                  id: true,
                  title: true,
                  endsAt: true,
                  requester: { select: { name: true, avatarUrl: true } },
                },
              },
            },
          },
        },
        orderBy: { checkedOutAt: "desc" },
      })
    : [];
  const activeAllocationByUnitId = buildActiveBulkUnitAllocationMap(activeUnitAllocations);

  return bulkSkus.map((sku) => {
    const state = summarizeItemFamilyState(sku, activeAllocationByUnitId);
    const matchedUnit = derivedBulkUnitQr?.bulkSkuId === sku.id
      ? state.effectiveUnits.find((unit) => unit.unitNumber === derivedBulkUnitQr.unitNumber)
      : null;
    const matchedUnitAllocation = matchedUnit ? activeAllocationByUnitId.get(matchedUnit.id) : null;
    const matchedUnitBooking = matchedUnitAllocation?.bookingBulkItem.booking;
    const matchedUnitCustody = matchedUnit && matchedUnitBooking
      ? {
          matchedUnitHolder: matchedUnitBooking.requester.name,
          matchedUnitHolderAvatarUrl: matchedUnitBooking.requester.avatarUrl,
          matchedUnitDueAt: matchedUnitBooking.endsAt.toISOString(),
          matchedUnitBookingTitle: matchedUnitBooking.title,
          matchedUnitBookingId: matchedUnitBooking.id,
        }
      : {};

    return {
      id: sku.id,
      kind: "bulk" as const,
      name: sku.name,
      category: sku.categoryRel?.name ?? sku.category,
      unit: sku.unit,
      trackByNumber: sku.trackByNumber,
      onHandQuantity: state.onHandQuantity,
      availableQuantity: state.availableQuantity,
      checkedOutQuantity: state.checkedOutQuantity,
      lostQuantity: state.lostQuantity,
      retiredQuantity: state.retiredQuantity,
      ...(matchedUnit
        ? {
            matchedUnitNumber: matchedUnit.unitNumber,
            matchedUnitStatus: matchedUnit.status,
            ...matchedUnitCustody,
            // Per-unit roster, only on the exact-unit scan path so list
            // searches don't ship every unit of every SKU.
            units: state.effectiveUnits
              .slice()
              .sort((a, b) => a.unitNumber - b.unitNumber)
              .map((u) => ({ unitNumber: u.unitNumber, status: u.status })),
          }
        : {}),
      imageUrl: sku.imageUrl,
      locationName: sku.location.name,
      locationId: sku.locationId,
      categoryId: sku.categoryId,
      departmentId: sku.departmentId,
      departmentName: sku.department?.name ?? null,
      binQrCodeValue: sku.binQrCodeValue,
    };
  });
}

function popularityKey(kind: PopularityKind, id: string): PopularityKey {
  return `${kind}:${id}`;
}

function addPopularity(
  scores: Map<PopularityKey, PopularityScore>,
  key: PopularityKey,
  amount: number,
  activityAt?: Date | null
) {
  const current = scores.get(key) ?? { score: 0, lastActivityAt: 0 };
  const activityTime = activityAt?.getTime() ?? 0;
  scores.set(key, {
    score: current.score + amount,
    lastActivityAt: Math.max(current.lastActivityAt, activityTime),
  });
}

function popularityScore(scores: Map<PopularityKey, PopularityScore>, key: PopularityKey, recentCutoff: Date) {
  const score = scores.get(key);
  if (!score) return 0;
  return score.score + (score.lastActivityAt >= recentCutoff.getTime() ? 2 : 0);
}

async function loadPopularityScores(assetIds: string[], bulkSkuIds: string[]) {
  const scores = new Map<PopularityKey, PopularityScore>();
  const usedSince = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const bookingStatuses = [
    BookingStatus.BOOKED,
    BookingStatus.PENDING_PICKUP,
    BookingStatus.OPEN,
    BookingStatus.COMPLETED,
  ];

  const [serializedBookings, bulkBookings, assetScans, bulkScans] = await Promise.all([
    assetIds.length > 0
      ? db.bookingSerializedItem.findMany({
          where: {
            assetId: { in: assetIds },
            booking: {
              startsAt: { gte: usedSince },
              status: { in: bookingStatuses },
            },
          },
          select: {
            assetId: true,
            createdAt: true,
            booking: {
              select: {
                kind: true,
                startsAt: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    bulkSkuIds.length > 0
      ? db.bookingBulkItem.findMany({
          where: {
            bulkSkuId: { in: bulkSkuIds },
            booking: {
              startsAt: { gte: usedSince },
              status: { in: bookingStatuses },
            },
          },
          select: {
            bulkSkuId: true,
            plannedQuantity: true,
            createdAt: true,
            booking: {
              select: {
                kind: true,
                startsAt: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    assetIds.length > 0
      ? db.scanEvent.findMany({
          where: {
            assetId: { in: assetIds },
            success: true,
            createdAt: { gte: usedSince },
          },
          select: {
            assetId: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    bulkSkuIds.length > 0
      ? db.scanEvent.findMany({
          where: {
            bulkSkuId: { in: bulkSkuIds },
            success: true,
            createdAt: { gte: usedSince },
          },
          select: {
            bulkSkuId: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
  ]);

  for (const row of serializedBookings) {
    const weight = row.booking.kind === BookingKind.CHECKOUT ? 5 : 3;
    addPopularity(scores, popularityKey("asset", row.assetId), weight, row.booking.startsAt ?? row.createdAt);
  }
  for (const row of bulkBookings) {
    const weight = row.booking.kind === BookingKind.CHECKOUT ? 5 : 3;
    addPopularity(
      scores,
      popularityKey("bulk", row.bulkSkuId),
      weight * Math.max(1, row.plannedQuantity),
      row.booking.startsAt ?? row.createdAt
    );
  }
  for (const row of assetScans) {
    if (!row.assetId) continue;
    addPopularity(scores, popularityKey("asset", row.assetId), 1, row.createdAt);
  }
  for (const row of bulkScans) {
    if (!row.bulkSkuId) continue;
    addPopularity(scores, popularityKey("bulk", row.bulkSkuId), 1, row.createdAt);
  }

  return scores;
}

/** Map sort param to Prisma orderBy clause. */
const SORT_MAP: Record<
  string,
  Prisma.AssetOrderByWithRelationInput | Prisma.AssetOrderByWithRelationInput[]
> = {
  name: [{ brand: "asc" }, { model: "asc" }, { assetTag: "asc" }],
  "-name": [{ brand: "desc" }, { model: "desc" }, { assetTag: "desc" }],
  assetTag: { assetTag: "asc" },
  "-assetTag": { assetTag: "desc" },
  brand: { brand: "asc" },
  "-brand": { brand: "desc" },
  model: { model: "asc" },
  "-model": { model: "desc" },
  createdAt: { createdAt: "asc" },
  "-createdAt": { createdAt: "desc" },
  category: { category: { name: "asc" } },
  "-category": { category: { name: "desc" } },
  location: { location: { name: "asc" } },
  "-location": { location: { name: "desc" } },
  department: { department: { name: "asc" } },
  "-department": { department: { name: "desc" } },
};

export const GET = withAuth(async (req, { user }) => {
  requirePermissionOrCollaboratorCapability(user, "asset", "view", "GEAR_CATALOG_VIEW");
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const qr = searchParams.get("qr")?.trim(); // exact QR code value for scan lookup
  const showAccessories = searchParams.get("show_accessories") === "true";
  const includeAccessories = searchParams.get("include_accessories") === "true";
  const favoritesOnly = searchParams.get("favorites_only") === "true";
  const searchAliases = q ? getAssetTagSearchAliases(q) : [];
  const itemKind = readItemKindFilter(searchParams.get("item_type") ?? searchParams.get("type"));
  const includeSerializedRows = itemKind === "all" || itemKind === "serialized";
  const includeBulkRows = itemKind === "all" || itemKind === "unit-tracked" || itemKind === "quantity-tracked";

  if (
    user.role === "COLLABORATOR" &&
    (qr || showAccessories || includeAccessories || searchParams.has("missing") || searchParams.get("ids_only") === "true")
  ) {
    throw new HttpError(403, "This inventory operation is not available to collaborators");
  }

  // Support multi-value filters: ?status=A&status=B or single ?status=A
  const statusParams = searchParams.getAll("status").filter(Boolean);
  const locationIds = searchParams.getAll("location_id").filter(Boolean);
  const categoryIds = searchParams.getAll("category_id").filter(Boolean);
  const brandParams = searchParams.getAll("brand").map((b) => b.trim()).filter(Boolean);
  const departmentIds = searchParams.getAll("department_id").filter(Boolean);
  const missingField = searchParams.get("missing"); // "category" | "department"
  const { limit, offset } = parsePagination(searchParams);

  // Server-side sorting: ?sort=brand&order=desc or ?sort=-brand.
  // Omitted sort matches the Items list: Most popular, with asset-tag tie-breaks.
  const sortParam = searchParams.get("sort") ?? "";
  const orderParam = searchParams.get("order") ?? "";
  const sortKey = orderParam === "desc" && sortParam && !sortParam.startsWith("-")
    ? `-${sortParam}`
    : sortParam || "popular";
  const orderBy = SORT_MAP[sortKey] ?? SORT_MAP["assetTag"];
  const shouldUsePopularitySort = sortKey === "popular" || sortKey === "-popular";

  const derivedBulkUnitQr = qr
    ? parseDerivedBulkUnitQr(
        qr,
        await db.bulkSku.findMany({
          where: { active: true, trackByNumber: true },
          select: { id: true, binQrCodeValue: true, trackByNumber: true },
        }),
      )
    : null;

  // Build base where clause (non-status filters)
  // QR scan lookup (?qr=) must find accessories too, so skip the parentAssetId filter
  // Attachment candidate search also needs all rows so the UI can explain blocked children.
  const baseWhere: Prisma.AssetWhereInput = {
    ...(qr || includeAccessories ? {} : showAccessories ? { parentAssetId: { not: null } } : { parentAssetId: null }),
    ...(favoritesOnly ? { favoritedBy: { some: { userId: user.id } } } : {}),
    ...(user.role === "COLLABORATOR" ? { availableForReservation: true } : {}),
    ...(locationIds.length === 1 ? { locationId: locationIds[0] } : {}),
    ...(locationIds.length > 1 ? { locationId: { in: locationIds } } : {}),
    ...(missingField === "category" ? { categoryId: null } : categoryIds.length === 1 ? { categoryId: categoryIds[0] } : categoryIds.length > 1 ? { categoryId: { in: categoryIds } } : {}),
    ...(missingField === "department" ? { departmentId: null } : departmentIds.length === 1 ? { departmentId: departmentIds[0] } : departmentIds.length > 1 ? { departmentId: { in: departmentIds } } : {}),
    ...(brandParams.length === 1
      ? { brand: { equals: brandParams[0], mode: "insensitive" as const } }
      : brandParams.length > 1
        ? { brand: { in: brandParams, mode: "insensitive" as const } }
        : {}),
    ...(q || qr
      ? {
          OR: [
            ...(qr ? [
              { qrCodeValue: { equals: qr, mode: "insensitive" as const } },
              { qrCodeValue: { equals: `QR-${qr}`, mode: "insensitive" as const } },
              { primaryScanCode: { equals: qr, mode: "insensitive" as const } },
              { primaryScanCode: { equals: `QR-${qr}`, mode: "insensitive" as const } },
              { assetTag: { equals: qr, mode: "insensitive" as const } },
            ] : []),
            ...(q ? [
              ...searchAliases.flatMap((term) => [
                { assetTag: { contains: term, mode: "insensitive" as const } },
                { model: { contains: term, mode: "insensitive" as const } },
                { name: { contains: term, mode: "insensitive" as const } },
              ]),
              { brand: { contains: q, mode: "insensitive" as const } },
              ...(user.role === "COLLABORATOR"
                ? []
                : [
                    { serialNumber: { contains: q, mode: "insensitive" as const } },
                    { notes: { contains: q, mode: "insensitive" as const } },
                  ]),
              { category: { name: { contains: q, mode: "insensitive" as const } } },
              { location: { name: { contains: q, mode: "insensitive" as const } } },
              ...(user.role === "COLLABORATOR"
                ? []
                : [{ department: { name: { contains: q, mode: "insensitive" as const } } }]),
            ] : []),
          ]
        }
      : {})
  };

  // Build status filter using DB-level derived status clauses
  let where: Prisma.AssetWhereInput;
  const hasStatusFilter = statusParams.length > 0;
  if (hasStatusFilter) {
    const statusClauses = buildDerivedStatusWhere(statusParams);
    where = {
      AND: [
        baseWhere,
        { OR: statusClauses },
      ],
    };
  } else if (qr) {
    where = baseWhere;
  } else {
    where = {
      AND: [
        baseWhere,
        { status: { not: AssetStatus.RETIRED } },
      ],
    };
  }

  if (missingField === "category" || missingField === "department") {
    const bulkGapWhere: Prisma.BulkSkuWhereInput = {
      active: true,
      ...(locationIds.length === 1 ? { locationId: locationIds[0] } : {}),
      ...(locationIds.length > 1 ? { locationId: { in: locationIds } } : {}),
      ...(missingField === "category" ? { categoryId: null } : {}),
      ...(missingField === "department" ? { departmentId: null } : {}),
      ...(q ? {
        OR: [
          ...searchAliases.flatMap((term) => [
            { name: { contains: term, mode: "insensitive" as const } },
            { category: { contains: term, mode: "insensitive" as const } },
          ]),
          { category: { contains: q, mode: "insensitive" as const } },
        ],
      } : {}),
    };

    const [assetGapTotal, bulkGapTotal] = await Promise.all([
      db.asset.count({ where }),
      db.bulkSku.count({ where: bulkGapWhere }),
    ]);
    const total = assetGapTotal + bulkGapTotal;

    const assetSkip = Math.min(offset, assetGapTotal);
    const assetTake = Math.min(limit, Math.max(0, assetGapTotal - assetSkip));
    const bulkSkip = Math.max(0, offset - assetGapTotal);
    const bulkTake = limit - assetTake;

    const [assetGaps, bulkGaps] = await Promise.all([
      assetTake > 0
        ? db.asset.findMany({
            where,
            orderBy,
            skip: assetSkip,
            take: assetTake,
            select: {
              id: true,
              assetTag: true,
              name: true,
              brand: true,
              model: true,
              categoryId: true,
              category: { select: { name: true } },
              imageUrl: true,
            },
          })
        : Promise.resolve([]),
      bulkTake > 0
        ? db.bulkSku.findMany({
            where: bulkGapWhere,
            orderBy: { name: "asc" },
            skip: bulkSkip,
            take: bulkTake,
            select: {
              id: true,
              name: true,
              category: true,
              categoryId: true,
              imageUrl: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const departmentSuggestionByCategory = new Map<string, string>();
    let suggestionsLimited = false;
    if (missingField === "department") {
      const categoryIds = [
        ...new Set(
          [
            ...assetGaps.map((asset) => asset.categoryId),
            ...bulkGaps.map((sku) => sku.categoryId),
          ].filter((id): id is string => Boolean(id))
        ),
      ];
      const categoryNames = [
        ...new Set(
          bulkGaps
            .map((sku) => sku.category)
            .filter((name): name is string => Boolean(name?.trim()))
        ),
      ];

      if (categoryIds.length > 0 || categoryNames.length > 0) {
        const assetSourceWhere: Prisma.AssetWhereInput = {
          departmentId: { not: null },
          OR: [
            ...(categoryIds.length > 0 ? [{ categoryId: { in: categoryIds } }] : []),
            ...(categoryNames.length > 0
              ? [{ category: { name: { in: categoryNames, mode: "insensitive" as const } } }]
              : []),
          ],
        };
        const bulkSourceWhere: Prisma.BulkSkuWhereInput = {
          departmentId: { not: null },
          OR: [
            ...(categoryIds.length > 0 ? [{ categoryId: { in: categoryIds } }] : []),
            ...(categoryNames.length > 0
              ? [{ category: { in: categoryNames, mode: "insensitive" as const } }]
              : []),
          ],
        };
        const [assetSources, bulkSources] = await Promise.all([
          db.asset.findMany({
            where: assetSourceWhere,
            take: GAP_SUGGESTION_SOURCE_LIMIT + 1,
            select: { categoryId: true, category: { select: { name: true } }, departmentId: true },
          }),
          db.bulkSku.findMany({
            where: bulkSourceWhere,
            take: GAP_SUGGESTION_SOURCE_LIMIT + 1,
            select: { categoryId: true, category: true, departmentId: true },
          }),
        ]);
        suggestionsLimited = assetSources.length > GAP_SUGGESTION_SOURCE_LIMIT || bulkSources.length > GAP_SUGGESTION_SOURCE_LIMIT;
        const cappedAssetSources = assetSources.slice(0, GAP_SUGGESTION_SOURCE_LIMIT);
        const cappedBulkSources = bulkSources.slice(0, GAP_SUGGESTION_SOURCE_LIMIT);

        const counts = new Map<string, Map<string, number>>();
        for (const source of cappedAssetSources) {
          if (!source.departmentId) continue;
          for (const key of getCategorySuggestionKeys(source.categoryId, source.category?.name ?? null)) {
            const categoryCounts = counts.get(key) ?? new Map<string, number>();
            categoryCounts.set(source.departmentId, (categoryCounts.get(source.departmentId) ?? 0) + 1);
            counts.set(key, categoryCounts);
          }
        }
        for (const source of cappedBulkSources) {
          if (!source.departmentId) continue;
          for (const key of getCategorySuggestionKeys(source.categoryId, source.category)) {
            const categoryCounts = counts.get(key) ?? new Map<string, number>();
            categoryCounts.set(source.departmentId, (categoryCounts.get(source.departmentId) ?? 0) + 1);
            counts.set(key, categoryCounts);
          }
        }

        for (const [categoryKey, categoryCounts] of counts) {
          const [departmentId] = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
          if (departmentId) departmentSuggestionByCategory.set(categoryKey, departmentId);
        }
      }
    }

    const gapItems = [
      ...assetGaps.map((asset) => ({
        kind: "asset" as const,
        id: asset.id,
        assetTag: asset.assetTag,
        name: asset.name,
        brand: asset.brand,
        model: asset.model,
        imageUrl: asset.imageUrl,
        suggestedCategoryId: null as string | null,
        suggestedDepartmentId: departmentSuggestionByCategory.get(getCategorySuggestionKey(asset.categoryId, asset.category?.name ?? null) ?? "") ?? null,
      })),
      ...bulkGaps.map((sku) => ({
        kind: "bulk" as const,
        id: sku.id,
        assetTag: sku.name,
        name: sku.category,
        brand: "Bulk",
        model: "SKU",
        imageUrl: sku.imageUrl,
        suggestedCategoryId: null as string | null,
        suggestedDepartmentId: departmentSuggestionByCategory.get(getCategorySuggestionKey(sku.categoryId, sku.category) ?? "") ?? null,
      })),
    ].sort((a, b) => a.assetTag.localeCompare(b.assetTag, undefined, { numeric: true, sensitivity: "base" }));

    if (missingField === "category" && gapItems.length > 0) {
      const categorySuggestionResult = await buildCategorySuggestions(gapItems);
      suggestionsLimited = categorySuggestionResult.limited;
      for (const item of gapItems) {
        item.suggestedCategoryId = categorySuggestionResult.suggestions.get(item.id) ?? null;
      }
    }

    return ok({
      data: gapItems,
      bulkItems: [],
      total,
      limit,
      offset,
      truncated: total > offset + gapItems.length,
      suggestionsLimited,
      statusBreakdown: {
        available: 0,
        checkedOut: 0,
        pendingPickup: 0,
        reserved: 0,
        maintenance: 0,
        retired: 0,
      },
    });
  }

  const canReturnBulkItems =
    includeBulkRows &&
    !showAccessories &&
    !includeAccessories &&
    brandParams.length === 0 &&
    (!hasStatusFilter || statusParams.includes("AVAILABLE"));

  const bulkWhere: Prisma.BulkSkuWhereInput | null = canReturnBulkItems
    ? {
        active: true,
        ...(itemKind === "unit-tracked" ? { trackByNumber: true } : {}),
        ...(itemKind === "quantity-tracked" ? { trackByNumber: false } : {}),
        ...(locationIds.length === 1 ? { locationId: locationIds[0] } : {}),
        ...(locationIds.length > 1 ? { locationId: { in: locationIds } } : {}),
        ...(categoryIds.length === 1 ? { categoryId: categoryIds[0] } : {}),
        ...(categoryIds.length > 1 ? { categoryId: { in: categoryIds } } : {}),
        ...(departmentIds.length === 1 ? { departmentId: departmentIds[0] } : {}),
        ...(departmentIds.length > 1 ? { departmentId: { in: departmentIds } } : {}),
        ...(favoritesOnly ? { favoritedBy: { some: { userId: user.id } } } : {}),
        ...(q ? {
          OR: [
            ...searchAliases.flatMap((term) => [
              { name: { contains: term, mode: "insensitive" as const } },
              { category: { contains: term, mode: "insensitive" as const } },
              { categoryRel: { name: { contains: term, mode: "insensitive" as const } } },
            ]),
            { category: { contains: q, mode: "insensitive" as const } },
          ],
        } : {}),
        ...(qr ? {
          OR: [
            { binQrCodeValue: { equals: qr, mode: "insensitive" as const } },
            { binQrCodeValue: { equals: `QR-${qr}`, mode: "insensitive" as const } },
            ...(derivedBulkUnitQr ? [{ id: derivedBulkUnitQr.bulkSkuId }] : []),
          ],
        } : {}),
      }
    : null;

  if (searchParams.get("ids_only") === "true") {
    const cap = 5000;
    const ids: string[] = [];

    if (includeSerializedRows) {
      const rows = await db.asset.findMany({
        where,
        orderBy,
        take: cap + 1,
        select: { id: true },
      });
      ids.push(...rows.map((row) => row.id));
    }

    if (bulkWhere && ids.length <= cap) {
      const bulkRows = await db.bulkSku.findMany({
        where: bulkWhere,
        take: cap + 1 - ids.length,
        select: { id: true },
        orderBy: { name: "asc" },
      });
      ids.push(...bulkRows.map((row) => `bulk-${row.id}`));
    }

    const truncated = ids.length > cap;
    return ok({
      ids: ids.slice(0, cap),
      truncated,
    });
  }

  let rawData: AssetListRow[] = [];
  let bulkItems: BulkListItem[] = [];
  let itemOrder: string[] = [];
  let total = 0;
  let matchingBulkTotal = 0;
  const shouldUseOperationalAssetTagSort = sortKey === "assetTag" || sortKey === "-assetTag";
  const shouldUseUnifiedAssetTagPagination = (shouldUseOperationalAssetTagSort || shouldUsePopularitySort) && bulkWhere !== null;

  if (shouldUseUnifiedAssetTagPagination) {
    const [allAssets, assetTotal, bulkSkus] = await Promise.all([
      includeSerializedRows
        ? db.asset.findMany({
            where,
            include: assetInclude,
            orderBy: { assetTag: "asc" },
          })
        : Promise.resolve([]),
      includeSerializedRows ? db.asset.count({ where }) : Promise.resolve(0),
      db.bulkSku.findMany({
        where: bulkWhere,
        include: bulkSkuInclude,
        orderBy: { name: "asc" },
      }),
    ]);
    const allBulkItems = await buildBulkListItems(bulkSkus, derivedBulkUnitQr);
    matchingBulkTotal = allBulkItems.length;
    const recentCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const popularityScores = shouldUsePopularitySort
      ? await loadPopularityScores(
          allAssets.map((asset) => asset.id),
          allBulkItems.map((bulk) => bulk.id)
        )
      : new Map<PopularityKey, PopularityScore>();
    const combinedRows = [
      ...allAssets.map((asset) => ({
        kind: "asset" as const,
        id: asset.id,
        sortTag: asset.assetTag,
        popularity: popularityScore(popularityScores, popularityKey("asset", asset.id), recentCutoff),
        asset,
      })),
      ...allBulkItems.map((bulk) => ({
        kind: "bulk" as const,
        id: bulk.id,
        sortTag: bulk.name,
        popularity: popularityScore(popularityScores, popularityKey("bulk", bulk.id), recentCutoff),
        bulk,
      })),
    ].sort((a, b) => {
      if (shouldUsePopularitySort && a.popularity !== b.popularity) return b.popularity - a.popularity;
      return compareItemAssetTags(a.sortTag, b.sortTag);
    });

    if (sortKey === "-assetTag" || sortKey === "-popular") combinedRows.reverse();

    const pageRows = combinedRows.slice(offset, offset + limit);
    rawData = pageRows.flatMap((row) => row.kind === "asset" ? [row.asset] : []);
    bulkItems = pageRows.flatMap((row) => row.kind === "bulk" ? [row.bulk] : []);
    itemOrder = pageRows.map((row) => row.kind === "asset" ? row.asset.id : `bulk-${row.bulk.id}`);
    total = assetTotal + allBulkItems.length;
  } else {
    if (includeSerializedRows) {
      if (shouldUsePopularitySort) {
        const [allAssets, assetTotal] = await Promise.all([
          db.asset.findMany({
            where,
            include: assetInclude,
            orderBy: { assetTag: "asc" },
          }),
          db.asset.count({ where }),
        ]);
        const recentCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        const popularityScores = await loadPopularityScores(allAssets.map((asset) => asset.id), []);
        const sortedAssets = allAssets.sort((a, b) => {
          const popularityDiff = popularityScore(popularityScores, popularityKey("asset", b.id), recentCutoff)
            - popularityScore(popularityScores, popularityKey("asset", a.id), recentCutoff);
          if (popularityDiff !== 0) return popularityDiff;
          return compareItemAssetTags(a.assetTag, b.assetTag);
        });
        if (sortKey === "-popular") sortedAssets.reverse();
        rawData = sortedAssets.slice(offset, offset + limit);
        total = assetTotal;
      } else {
        [rawData, total] = shouldUseOperationalAssetTagSort
          ? await loadOperationallySortedAssets(where, sortKey === "-assetTag", offset, limit)
          : await Promise.all([
              db.asset.findMany({
                where,
                include: assetInclude,
                orderBy,
                take: limit,
                skip: offset,
              }),
              db.asset.count({ where }),
            ]);
      }
    }

    if (bulkWhere && !includeSerializedRows) {
      const bulkSkus = await db.bulkSku.findMany({
        where: bulkWhere,
        include: bulkSkuInclude,
        orderBy: { name: "asc" },
      });
      const allBulkItems = await buildBulkListItems(bulkSkus, derivedBulkUnitQr);
      matchingBulkTotal = allBulkItems.length;
      const recentCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const popularityScores = shouldUsePopularitySort
        ? await loadPopularityScores([], allBulkItems.map((bulk) => bulk.id))
        : new Map<PopularityKey, PopularityScore>();
      const sortedBulkItems = allBulkItems.sort((a, b) => {
        if (shouldUsePopularitySort) {
          const popularityDiff = popularityScore(popularityScores, popularityKey("bulk", b.id), recentCutoff)
            - popularityScore(popularityScores, popularityKey("bulk", a.id), recentCutoff);
          if (popularityDiff !== 0) return popularityDiff;
        }
        return compareItemAssetTags(a.name, b.name);
      });
      if (sortKey === "-assetTag" || sortKey === "-popular") sortedBulkItems.reverse();
      bulkItems = sortedBulkItems.slice(offset, offset + limit);
      total = allBulkItems.length;
    }
  }

  const data = await enrichAssetsWithStatusFromLoaded(rawData);

  const [enrichedWithBookings, favoriteItems, favoriteItemFamilies] = await Promise.all([
    user.role === "COLLABORATOR"
      ? Promise.resolve(data.map((asset) => ({ ...asset, activeBooking: null })))
      : attachActiveBookings(data),
    db.favoriteItem.findMany({
      where: { userId: user.id, assetId: { in: data.map((a) => a.id) } },
      select: { assetId: true },
    }),
    db.favoriteItemFamily.findMany({
      where: { userId: user.id, bulkSkuId: { in: bulkItems.map((b) => b.id) } },
      select: { bulkSkuId: true },
    }),
  ]);

  // Attach isFavorited for current user
  const favoriteAssetIds = new Set(favoriteItems.map((f) => f.assetId));
  const enrichedWithFavorites = enrichedWithBookings.map((a) => ({
    ...a,
    isFavorited: favoriteAssetIds.has(a.id),
  }));
  const favoriteBulkSkuIds = new Set(favoriteItemFamilies.map((f) => f.bulkSkuId));
  bulkItems = bulkItems.map((b) => ({
    ...b,
    isFavorited: favoriteBulkSkuIds.has(b.id),
  }));

  // Status breakdown counts using derived status logic
  const statusKeys = ["AVAILABLE", "CHECKED_OUT", "PENDING_PICKUP", "RESERVED", "MAINTENANCE", "RETIRED"] as const;
  const assetBreakdownCounts: [number, number, number, number, number, number] = includeSerializedRows
    ? await Promise.all(
        statusKeys.map((s) => {
          const clauses = buildDerivedStatusWhere([s]);
          return db.asset.count({ where: { AND: [baseWhere, { OR: clauses }] } });
        })
      ) as [number, number, number, number, number, number]
    : [0, 0, 0, 0, 0, 0];
  const breakdownCounts = [
    assetBreakdownCounts[0] + matchingBulkTotal,
    ...assetBreakdownCounts.slice(1),
  ];

  if (user.role === "COLLABORATOR") {
    const collaboratorAssets = enrichedWithFavorites.map(sanitizeCollaboratorPickerAsset);
    const collaboratorBulkItems = bulkItems.map(sanitizeCollaboratorBulkItem);
    const available = collaboratorAssets.filter((asset) => asset.availability === "AVAILABLE").length
      + collaboratorBulkItems.filter((item) => item.availability === "AVAILABLE").length;
    return ok({
      data: collaboratorAssets,
      bulkItems: collaboratorBulkItems,
      itemOrder,
      total,
      limit,
      offset,
      availabilityBreakdown: {
        available,
        unavailable: Math.max(0, collaboratorAssets.length + collaboratorBulkItems.length - available),
      },
    });
  }

  return ok({
    data: enrichedWithFavorites,
    bulkItems,
    itemOrder,
    total,
    limit,
    offset,
    statusBreakdown: {
      available: breakdownCounts[0],
      checkedOut: breakdownCounts[1],
      pendingPickup: breakdownCounts[2],
      reserved: breakdownCounts[3],
      maintenance: breakdownCounts[4],
      retired: breakdownCounts[5],
    },
  });
});

/** Attach activeBooking (id, kind, title, requester) for active derived booking states. */
async function attachActiveBookings<T extends { id: string; computedStatus: string }>(
  assets: T[]
): Promise<Array<T & { activeBooking: { id: string; kind: string; status: string; title: string; requesterName: string; requesterAvatarUrl: string | null; isOverdue: boolean; endsAt: string } | null }>> {
  const needsBooking = assets.filter(
    (a) => a.computedStatus === "CHECKED_OUT" || a.computedStatus === "PENDING_PICKUP" || a.computedStatus === "RESERVED"
  );

  if (needsBooking.length === 0) {
    return assets.map((a) => ({ ...a, activeBooking: null }));
  }

  const allocations = await db.assetAllocation.findMany({
    where: {
      assetId: { in: needsBooking.map((a) => a.id) },
      active: true,
      booking: { status: { in: [BookingStatus.OPEN, BookingStatus.PENDING_PICKUP, BookingStatus.BOOKED] } },
    },
    select: {
      assetId: true,
      startsAt: true,
      booking: {
        select: { id: true, kind: true, title: true, status: true, endsAt: true, requester: { select: { name: true, avatarUrl: true } } },
      },
    },
  });

  const now = new Date();
  const statusByAssetId = new Map(needsBooking.map((asset) => [asset.id, asset.computedStatus]));
  const bookingByAsset = new Map<string, { id: string; kind: string; status: string; title: string; requesterName: string; requesterAvatarUrl: string | null; isOverdue: boolean; endsAt: string }>();
  for (const alloc of allocations) {
    const computedStatus = statusByAssetId.get(alloc.assetId);
    const matchesDerivedStatus =
      (computedStatus === "CHECKED_OUT" && alloc.booking.kind === BookingKind.CHECKOUT && alloc.booking.status === BookingStatus.OPEN) ||
      (computedStatus === "PENDING_PICKUP" && alloc.booking.kind === BookingKind.CHECKOUT && alloc.booking.status === BookingStatus.PENDING_PICKUP) ||
      (computedStatus === "RESERVED" && alloc.booking.kind === BookingKind.RESERVATION && alloc.booking.status === BookingStatus.BOOKED && alloc.startsAt <= now);

    if (matchesDerivedStatus && !bookingByAsset.has(alloc.assetId)) {
      bookingByAsset.set(alloc.assetId, {
        id: alloc.booking.id,
        kind: alloc.booking.kind,
        status: alloc.booking.status,
        title: alloc.booking.title,
        requesterName: alloc.booking.requester.name,
        requesterAvatarUrl: alloc.booking.requester.avatarUrl ?? null,
        isOverdue: alloc.booking.status === "OPEN" && alloc.booking.endsAt < now,
        endsAt: alloc.booking.endsAt.toISOString(),
      });
    }
  }

  return assets.map((a) => ({ ...a, activeBooking: bookingByAsset.get(a.id) ?? null }));
}

function getCategorySuggestionKey(categoryId: string | null, categoryName: string | null) {
  return getCategorySuggestionKeys(categoryId, categoryName)[0] ?? null;
}

function getCategorySuggestionKeys(categoryId: string | null, categoryName: string | null) {
  const keys: string[] = [];
  if (categoryId) keys.push(`id:${categoryId}`);
  const normalizedName = categoryName?.trim().toLowerCase();
  if (normalizedName) keys.push(`name:${normalizedName}`);
  return keys;
}

type CategoryGapItem = {
  kind: "asset" | "bulk";
  id: string;
  assetTag: string;
  name: string | null;
  brand: string;
  model: string;
};

async function buildCategorySuggestions(items: CategoryGapItem[]) {
  const [categories, assetSources, bulkSources] = await Promise.all([
    db.category.findMany({ select: { id: true, name: true } }),
    db.asset.findMany({
      where: { categoryId: { not: null } },
      take: GAP_SUGGESTION_SOURCE_LIMIT + 1,
      select: { assetTag: true, name: true, brand: true, model: true, categoryId: true },
    }),
    db.bulkSku.findMany({
      where: { active: true, categoryId: { not: null } },
      take: GAP_SUGGESTION_SOURCE_LIMIT + 1,
      select: { name: true, category: true, categoryId: true },
    }),
  ]);
  const limited = assetSources.length > GAP_SUGGESTION_SOURCE_LIMIT || bulkSources.length > GAP_SUGGESTION_SOURCE_LIMIT;
  const cappedAssetSources = assetSources.slice(0, GAP_SUGGESTION_SOURCE_LIMIT);
  const cappedBulkSources = bulkSources.slice(0, GAP_SUGGESTION_SOURCE_LIMIT);

  const categoryIdByLegacyName = new Map(
    categories.map((category) => [normalizeSuggestionKey(category.name), category.id])
  );
  const categoryCountsByKey = new Map<string, Map<string, number>>();

  function addSource(keys: string[], categoryId: string | null) {
    if (!categoryId) return;
    for (const key of keys) {
      const counts = categoryCountsByKey.get(key) ?? new Map<string, number>();
      counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
      categoryCountsByKey.set(key, counts);
    }
  }

  for (const source of cappedAssetSources) {
    addSource(identitySuggestionKeys(source), source.categoryId);
  }
  for (const source of cappedBulkSources) {
    addSource(bulkSuggestionKeys(source), source.categoryId);
  }

  function bestCategoryId(keys: string[]) {
    for (const key of keys) {
      const exactLegacyMatch = categoryIdByLegacyName.get(key);
      if (exactLegacyMatch) return exactLegacyMatch;

      const counts = categoryCountsByKey.get(key);
      if (!counts) continue;
      const [categoryId] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
      if (categoryId) return categoryId;
    }
    return null;
  }

  return {
    limited,
    suggestions: new Map(
      items
        .map((item) => [item.id, bestCategoryId(item.kind === "bulk" ? bulkSuggestionKeys(item) : identitySuggestionKeys(item))] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    ),
  };
}

function identitySuggestionKeys(item: { assetTag?: string | null; name?: string | null; brand?: string | null; model?: string | null }) {
  const brand = normalizeSuggestionKey(item.brand);
  const model = normalizeSuggestionKey(item.model);
  return [
    brand && model ? `${brand} ${model}` : "",
    model,
    normalizeSuggestionKey(item.name),
    normalizeSuggestionKey(item.assetTag),
  ].filter(Boolean);
}

function bulkSuggestionKeys(item: { name?: string | null; category?: string | null }) {
  return [
    normalizeSuggestionKey(item.category),
    normalizeSuggestionKey(item.name),
  ].filter(Boolean);
}

function normalizeSuggestionKey(value?: string | null) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function assetCreateConflictMessage(
  error: Prisma.PrismaClientKnownRequestError,
  body: z.infer<typeof createAssetSchema>,
) {
  const rawTarget = error.meta?.target;
  const targets = (Array.isArray(rawTarget) ? rawTarget : [rawTarget])
    .filter((target): target is string | number => target !== null && target !== undefined)
    .map((target) => String(target).toLowerCase());
  const matches = (...aliases: string[]) =>
    targets.some((target) => aliases.some((alias) => target.includes(alias.toLowerCase())));

  if (matches("tagName", "tag_name", "assetTag", "asset_tag")) {
    return `Asset tag "${body.assetTag}" is already in use`;
  }
  if (matches("serialNumber", "serial_number")) {
    const serialNumber = body.serialNumber?.trim();
    return serialNumber
      ? `Serial number "${serialNumber}" is already in use`
      : "Serial number is already in use";
  }
  if (matches("qrCodeValue", "qr_code_value")) {
    return `QR code "${body.qrCodeValue}" is already in use`;
  }
  if (matches("primaryScanCode", "primary_scan_code")) {
    return "Primary scan code is already in use";
  }
  return "A unique asset identity is already in use";
}

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "asset", "create");
  const body = createAssetSchema.parse(await req.json());
  await validateCreateAssetReferences(body);

  let asset;
  try {
    asset = await db.asset.create({
      data: {
        assetTag: body.assetTag,
        name: body.name ?? null,
        type: body.type,
        brand: body.brand,
        model: body.model,
        serialNumber: body.serialNumber?.trim() || null,
        qrCodeValue: body.qrCodeValue,
        purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : null,
        purchasePrice: body.purchasePrice,
        warrantyDate: body.warrantyDate ? new Date(body.warrantyDate) : null,
        residualValue: body.residualValue,
        locationId: body.locationId,
        categoryId: body.categoryId ?? null,
        departmentId: body.departmentId ?? null,
        linkUrl: body.linkUrl ?? null,
        uwAssetTag: body.uwAssetTag ?? null,
        parentAssetId: body.parentAssetId ?? null,
        availableForReservation: body.availableForReservation ?? true,
        availableForCheckout: body.availableForCheckout ?? true,
        availableForCustody: body.availableForCustody ?? true,
        status: body.status,
        notes: body.notes
      },
      include: {
        location: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
      }
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: assetCreateConflictMessage(error, body) },
        { status: 409 }
      );
    }
    throw error;
  }

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "asset",
    entityId: asset.id,
    action: "asset_created",
    after: { assetTag: asset.assetTag, brand: asset.brand, model: asset.model, locationId: asset.locationId },
  });

  return ok({ data: asset }, 201);
});

async function validateCreateAssetReferences(body: z.infer<typeof createAssetSchema>) {
  const [location, category, department] = await Promise.all([
    db.location.findUnique({ where: { id: body.locationId }, select: { id: true } }),
    body.categoryId
      ? db.category.findUnique({ where: { id: body.categoryId }, select: { id: true } })
      : Promise.resolve({ id: null }),
    body.departmentId
      ? db.department.findUnique({ where: { id: body.departmentId }, select: { id: true } })
      : Promise.resolve({ id: null }),
  ]);

  if (!location) throw new HttpError(400, "Location not found");
  if (body.categoryId && !category) throw new HttpError(400, "Category not found");
  if (body.departmentId && !department) throw new HttpError(400, "Department not found");
}
