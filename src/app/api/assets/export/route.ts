import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { buildDerivedStatusWhere, enrichAssetsWithStatusFromLoaded } from "@/lib/services/status";
import { enforceRateLimit } from "@/lib/rate-limit";
import { csvField } from "@/lib/csv";
import { buildActiveBulkUnitAllocationMap } from "@/lib/bulk-unit-status";
import { summarizeItemFamilyState } from "@/lib/item-family-state";
import { compareItemAssetTags } from "@/lib/item-asset-tag-sort";
import type { Prisma } from "@prisma/client";

type ItemKindFilter = "all" | "serialized" | "unit-tracked" | "quantity-tracked";

const bulkSkuExportInclude = {
  location: { select: { name: true } },
  categoryRel: { select: { name: true } },
  department: { select: { name: true } },
  balances: { select: { onHandQuantity: true } },
  units: { select: { id: true, status: true } },
};

type BulkSkuExportRow = Prisma.BulkSkuGetPayload<{ include: typeof bulkSkuExportInclude }>;

function readItemKindFilter(value: string | null): ItemKindFilter {
  if (value === "bulk") return "unit-tracked";
  if (value === "serialized" || value === "unit-tracked" || value === "quantity-tracked") return value;
  return "all";
}

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "asset", "export");
  await enforceRateLimit(`asset:export:${user.id}`, { max: 10, windowMs: 60_000 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const showAccessories = searchParams.get("show_accessories") === "true";
  const favoritesOnly = searchParams.get("favorites_only") === "true";
  const statusParams = searchParams.getAll("status").filter(Boolean);
  const locationIds = searchParams.getAll("location_id").filter(Boolean);
  const categoryIds = searchParams.getAll("category_id").filter(Boolean);
  const brandParams = searchParams.getAll("brand").map((b) => b.trim()).filter(Boolean);
  const departmentIds = searchParams.getAll("department_id").filter(Boolean);
  const itemKind = readItemKindFilter(searchParams.get("item_type") ?? searchParams.get("type"));
  const includeSerializedRows = itemKind === "all" || itemKind === "serialized";
  const includeBulkRows = itemKind === "all" || itemKind === "unit-tracked" || itemKind === "quantity-tracked";

  const baseWhere: Prisma.AssetWhereInput = {
    ...(!showAccessories ? { parentAssetId: null } : {}),
    ...(favoritesOnly ? { favoritedBy: { some: { userId: user.id } } } : {}),
    ...(locationIds.length === 1 ? { locationId: locationIds[0] } : {}),
    ...(locationIds.length > 1 ? { locationId: { in: locationIds } } : {}),
    ...(categoryIds.length === 1 ? { categoryId: categoryIds[0] } : {}),
    ...(categoryIds.length > 1 ? { categoryId: { in: categoryIds } } : {}),
    ...(departmentIds.length === 1 ? { departmentId: departmentIds[0] } : {}),
    ...(departmentIds.length > 1 ? { departmentId: { in: departmentIds } } : {}),
    ...(brandParams.length === 1
      ? { brand: { equals: brandParams[0], mode: "insensitive" as const } }
      : brandParams.length > 1
        ? { brand: { in: brandParams, mode: "insensitive" as const } }
        : {}),
    ...(q
      ? {
          OR: [
            { assetTag: { contains: q, mode: "insensitive" as const } },
            { brand: { contains: q, mode: "insensitive" as const } },
            { model: { contains: q, mode: "insensitive" as const } },
            { serialNumber: { contains: q, mode: "insensitive" as const } },
            { name: { contains: q, mode: "insensitive" as const } },
            { notes: { contains: q, mode: "insensitive" as const } },
            { category: { name: { contains: q, mode: "insensitive" as const } } },
            { location: { name: { contains: q, mode: "insensitive" as const } } },
            { department: { name: { contains: q, mode: "insensitive" as const } } },
          ]
        }
      : {})
  };

  let where: Prisma.AssetWhereInput;
  if (statusParams.length > 0) {
    const statusClauses = buildDerivedStatusWhere(statusParams);
    where = { AND: [baseWhere, { OR: statusClauses }] };
  } else {
    where = { AND: [baseWhere, { status: { not: "RETIRED" } }] };
  }

  const EXPORT_LIMIT = 5000;
  const canReturnBulkItems =
    includeBulkRows &&
    !showAccessories &&
    !favoritesOnly &&
    brandParams.length === 0 &&
    (statusParams.length === 0 || statusParams.includes("AVAILABLE"));

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
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { category: { contains: q, mode: "insensitive" as const } },
                { categoryRel: { name: { contains: q, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      }
    : null;

  const [rawAssets, assetCount, bulkSkus, bulkCount] = await Promise.all([
    includeSerializedRows
      ? db.asset.findMany({
          where,
          include: {
            location: { select: { name: true } },
            category: { select: { name: true } },
            department: { select: { name: true } },
          },
          orderBy: { assetTag: "asc" },
          take: EXPORT_LIMIT,
        })
      : Promise.resolve([]),
    includeSerializedRows ? db.asset.count({ where }) : Promise.resolve(0),
    bulkWhere
      ? db.bulkSku.findMany({
          where: bulkWhere,
          include: bulkSkuExportInclude,
          orderBy: { name: "asc" },
          take: EXPORT_LIMIT,
        })
      : Promise.resolve([]),
    bulkWhere ? db.bulkSku.count({ where: bulkWhere }) : Promise.resolve(0),
  ]);
  const totalCount = assetCount + bulkCount;
  const truncated = totalCount > EXPORT_LIMIT;

  const assets = await enrichAssetsWithStatusFromLoaded(rawAssets);
  const bulkRows = await buildBulkExportRows(bulkSkus);

  // Build CSV
  const headers = ["Asset Tag", "Name", "Brand", "Model", "Serial Number", "Status", "Category", "Department", "Location", "Purchase Date", "Purchase Price"];
  const rows = [
    ...assets.map((a) => ({
      sortTag: a.assetTag,
      cells: [
        csvField(a.assetTag),
        csvField(a.name || ""),
        csvField(a.brand),
        csvField(a.model),
        csvField(a.serialNumber || ""),
        csvField(a.computedStatus),
        csvField(a.category?.name || ""),
        csvField(a.department?.name || ""),
        csvField(a.location?.name || ""),
        csvField(a.purchaseDate ? new Date(a.purchaseDate).toISOString().slice(0, 10) : ""),
        csvField(a.purchasePrice != null ? String(a.purchasePrice) : ""),
      ],
    })),
    ...bulkRows.map((b) => ({
      sortTag: b.name,
      cells: [
        csvField(b.name),
        csvField(b.trackByNumber ? "Unit-tracked item family" : "Quantity-tracked item family"),
        csvField(""),
        csvField(""),
        csvField(""),
        csvField(`${b.availableQuantity}/${b.onHandQuantity} available`),
        csvField(b.category),
        csvField(b.departmentName || ""),
        csvField(b.locationName),
        csvField(""),
        csvField(b.purchasePrice != null ? String(b.purchasePrice) : ""),
      ],
    })),
  ]
    .sort((a, b) => compareItemAssetTags(a.sortTag, b.sortTag))
    .slice(0, EXPORT_LIMIT)
    .map((row) => row.cells);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="items-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      ...(truncated ? {
        "X-Total-Count": String(totalCount),
        "X-Truncated": "true",
      } : {}),
    },
  });
});

async function buildBulkExportRows(bulkSkus: BulkSkuExportRow[]) {
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

    return {
      name: sku.name,
      trackByNumber: sku.trackByNumber,
      availableQuantity: state.availableQuantity,
      onHandQuantity: state.onHandQuantity,
      category: sku.categoryRel?.name ?? sku.category,
      departmentName: sku.department?.name ?? null,
      locationName: sku.location.name,
      purchasePrice: sku.purchasePrice,
    };
  });
}
