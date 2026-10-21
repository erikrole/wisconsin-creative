/**
 * Dedicated search endpoint for the equipment picker.
 *
 * Returns paginated assets with computed status, filtered by section and
 * text search. Also returns section counts as metadata so tab badges
 * are always accurate without loading the full asset list.
 */
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok, parsePagination } from "@/lib/http";
import { Prisma } from "@prisma/client";
import { buildDerivedStatusWhere, enrichAssetsWithStatusFromLoaded } from "@/lib/services/status";
import { sectionWhere, ALL_SECTION_KEYS } from "@/lib/equipment-section-filters";
import type { EquipmentSectionKey } from "@/lib/equipment-sections";
import { compareItemAssetTags, getAssetTagSearchAliases } from "@/lib/item-asset-tag-sort";
import { requirePermissionOrCollaboratorCapability } from "@/lib/rbac";
import { sanitizeCollaboratorPickerAsset } from "@/lib/collaborator-gear";
import { displayBookingTitle } from "@/lib/booking-display-title";

const VALID_SECTIONS = new Set<string>(ALL_SECTION_KEYS);
const MAX_PICKER_LIMIT = 100;

const pickerSelect = {
  id: true,
  assetTag: true,
  name: true,
  type: true,
  brand: true,
  model: true,
  serialNumber: true,
  status: true,
  locationId: true,
  qrCodeValue: true,
  primaryScanCode: true,
  imageUrl: true,
  location: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
} satisfies Prisma.AssetSelect;

export const GET = withAuth(async (req, { user }) => {
  requirePermissionOrCollaboratorCapability(user, "asset", "view", "GEAR_CATALOG_VIEW");
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || undefined;
  const searchAliases = q ? getAssetTagSearchAliases(q) : [];
  const qr = searchParams.get("qr")?.trim() || undefined;
  if (user.role === "COLLABORATOR" && qr) {
    throw new HttpError(403, "Custody scanning is available at a kiosk");
  }
  const sectionParam = searchParams.get("section")?.trim();
  const onlyAvailable = searchParams.get("only_available") === "true";
  const idsParam = searchParams.get("ids")?.trim();

  const section = sectionParam && VALID_SECTIONS.has(sectionParam)
    ? (sectionParam as EquipmentSectionKey)
    : undefined;

  const ids = idsParam ? idsParam.split(",").filter(Boolean) : undefined;

  const parsed = parsePagination(searchParams);
  const limit = Math.min(parsed.limit, MAX_PICKER_LIMIT);
  const offset = parsed.offset;

  // Build WHERE clause
  const conditions: Prisma.AssetWhereInput[] = [
    { parentAssetId: null }, // exclude accessories
  ];

  // Exclude retired unless specifically fetching by IDs
  if (!ids) {
    conditions.push({ status: { not: "RETIRED" } });
  }

  // "Available only" must reflect derived availability (D-001), not just the
  // stored AVAILABLE row: an asset can be stored AVAILABLE while it has an
  // active OPEN/PENDING_PICKUP checkout or a started BOOKED reservation.
  // Skip for ids hydration and exact qr lookup so stale/scanned-but-unavailable
  // assets can still surface for their dedicated UI messaging.
  const derivedAvailableClauses = buildDerivedStatusWhere(["AVAILABLE"]);
  if (onlyAvailable && !ids && !qr) {
    conditions.push({ OR: derivedAvailableClauses });
  }

  if (section) {
    conditions.push(sectionWhere(section));
  }

  // Exact QR/scan code lookup (for scan-to-add).
  // Keep QR-{value} fallback so older generated labels continue to scan.
  if (qr) {
    const qrPrefixed = `QR-${qr}`;
    conditions.push({
      OR: [
        { qrCodeValue: { equals: qr, mode: "insensitive" } },
        { qrCodeValue: { equals: qrPrefixed, mode: "insensitive" } },
        { primaryScanCode: { equals: qr, mode: "insensitive" } },
        { primaryScanCode: { equals: qrPrefixed, mode: "insensitive" } },
        { assetTag: { equals: qr, mode: "insensitive" } },
      ],
    });
  }

  // Fetch by specific IDs (for hydrating selected items)
  if (ids && ids.length > 0) {
    conditions.push({ id: { in: ids } });
  }

  // Text search across key fields
  if (q) {
    conditions.push({
      OR: [
        ...searchAliases.flatMap((term) => [
          { assetTag: { contains: term, mode: "insensitive" as const } },
          { model: { contains: term, mode: "insensitive" as const } },
          { name: { contains: term, mode: "insensitive" as const } },
        ]),
        { brand: { contains: q, mode: "insensitive" } },
        ...(user.role === "COLLABORATOR"
          ? []
          : [{ serialNumber: { contains: q, mode: "insensitive" as const } }]),
        { type: { contains: q, mode: "insensitive" } },
        { category: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }

  const where: Prisma.AssetWhereInput = { AND: conditions };

  // Section counts must use the same derived availability filter as the rows
  // so tab badges never claim more "available" items than the list shows.
  const baseCountConditions: Prisma.AssetWhereInput[] = [
    { parentAssetId: null },
    { status: { not: "RETIRED" } },
    ...(onlyAvailable ? [{ OR: derivedAvailableClauses }] : []),
  ];

  // Run favorites, assets+count, and section counts all in parallel
  const [favRows, [rawAssets, total], sectionCountResults] = await Promise.all([
    db.favoriteItem.findMany({
      where: { userId: user.id },
      select: { assetId: true },
    }),
    Promise.all([
      db.asset.findMany({
        where,
        select: pickerSelect,
        // Base deterministic order from the DB; the picker applies the same
        // family-aware asset-tag comparator as `/items` before returning rows.
        orderBy: { assetTag: "asc" },
        take: limit,
        skip: offset,
      }),
      db.asset.count({ where }),
    ]),
    !ids && !qr
      ? Promise.all(
          ALL_SECTION_KEYS.map((key) =>
            db.asset.count({
              where: { AND: [...baseCountConditions, sectionWhere(key)] },
            })
          )
        )
      : Promise.resolve(null),
  ]);

  const favoriteAssetIds = new Set(favRows.map((f) => f.assetId));

  // Sort by the visible asset identity. Hidden popularity/favorite priority made
  // category lists feel random because rows like `FB FX3 2` separated from `FX3 1`.
  const sorted = [...rawAssets].sort((a, b) => {
    return compareItemAssetTags(a.assetTag, b.assetTag);
  });

  // Enrich with computed status (CHECKED_OUT, RESERVED, etc.)
  const assets = await enrichAssetsWithStatusFromLoaded(sorted);

  // For non-available assets, fetch current holder info (who has it + which booking)
  const unavailableIds = assets
    .filter((a) => a.computedStatus !== "AVAILABLE")
    .map((a) => a.id);

  const holderMap = new Map<string, { bookingId: string; bookingTitle: string; holderName: string; endsAt: string }>();
  if (unavailableIds.length > 0) {
    const activeAllocs = await db.assetAllocation.findMany({
      where: {
        assetId: { in: unavailableIds },
        active: true,
        // Same blocking statuses as derived availability — a staged
        // PENDING_PICKUP checkout has a holder worth showing too.
        booking: { status: { in: ["BOOKED", "PENDING_PICKUP", "OPEN"] } },
      },
      select: {
        assetId: true,
        booking: {
          select: {
            id: true,
            title: true,
            endsAt: true,
            requester: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    for (const alloc of activeAllocs) {
      if (!holderMap.has(alloc.assetId)) {
        holderMap.set(alloc.assetId, {
          bookingId: alloc.booking.id,
          bookingTitle: displayBookingTitle(alloc.booking.title),
          holderName: alloc.booking.requester.name,
          endsAt: alloc.booking.endsAt.toISOString(),
        });
      }
    }
  }

  // Flatten category name for client-side section classification
  const assetsWithCategory = assets.map((a) => {
    const holder = holderMap.get(a.id);
    return {
      ...a,
      isFavorited: favoriteAssetIds.has(a.id),
      categoryName: a.category?.name ?? null,
      currentHolder: holder ?? null,
    };
  });

  // Section counts were fetched in the initial parallel stage
  const sectionCounts: Record<string, number> | undefined = sectionCountResults
    ? Object.fromEntries(ALL_SECTION_KEYS.map((key, i) => [key, sectionCountResults[i] ?? 0]))
    : undefined;

  return ok({
    data: {
      assets: user.role === "COLLABORATOR"
        ? assetsWithCategory.map(sanitizeCollaboratorPickerAsset)
        : assetsWithCategory,
      total,
      sectionCounts: sectionCounts ?? null,
    },
  });
});
