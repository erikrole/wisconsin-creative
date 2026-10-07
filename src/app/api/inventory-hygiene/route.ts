import type { BulkUnitStatus } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { summarizeItemFamilyState } from "@/lib/item-family-state";
import {
  isSerializedSupportPoolCandidate,
  shouldAssignUnitProduct,
} from "@/lib/support-gear-families";

const SAMPLE_LIMIT = 6;
const DEFAULT_BULK_THRESHOLD = 1;

type HygieneSample = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

type DuplicateScanRow = {
  scan_value: string;
  occurrences: bigint;
  examples: Array<{
    id: string;
    label: string;
    source: string;
  }>;
};

function assetLabel(asset: { assetTag: string; name: string | null; brand: string; model: string }) {
  return asset.assetTag;
}

function assetDetail(asset: {
  assetTag: string;
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  location?: { name: string } | null;
  category?: { name: string } | null;
  department?: { name: string } | null;
}) {
  const product = asset.name?.trim() || [asset.brand, asset.model].filter(Boolean).join(" ").trim();
  return [
    product,
    asset.category?.name,
    asset.department?.name,
    asset.location?.name,
  ].filter(Boolean).join(" / ") || "No supporting metadata";
}

function issue(key: string, title: string, description: string, count: number, samples: HygieneSample[]) {
  return { key, title, description, count, samples };
}

function settledValue<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
  label: string,
  partialFailures: string[],
): T {
  if (result.status === "fulfilled") return result.value;
  console.error(`[inventory-hygiene] ${label} failed`, result.reason);
  partialFailures.push(label);
  return fallback;
}

export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "asset", "edit");

  const assetSelect = {
    id: true,
    assetTag: true,
    name: true,
    brand: true,
    model: true,
    category: { select: { name: true } },
    department: { select: { name: true } },
    location: { select: { name: true } },
  };

  const [
    missingCategoryCountResult,
    missingCategoryRowsResult,
    missingDepartmentCountResult,
    missingDepartmentRowsResult,
    missingScanCodeCountResult,
    missingScanCodeRowsResult,
    missingImageCountResult,
    missingImageRowsResult,
    retiredInKitCountResult,
    retiredInKitRowsResult,
    cameraWithoutAttachmentCountResult,
    cameraWithoutAttachmentRowsResult,
    duplicateRowsResult,
    bulkRowsResult,
    supportCandidateRowsResult,
  ] = await Promise.allSettled([
    db.asset.count({ where: { categoryId: null } }),
    db.asset.findMany({
      where: { categoryId: null },
      orderBy: { assetTag: "asc" },
      take: SAMPLE_LIMIT,
      select: assetSelect,
    }),
    db.asset.count({ where: { departmentId: null } }),
    db.asset.findMany({
      where: { departmentId: null },
      orderBy: { assetTag: "asc" },
      take: SAMPLE_LIMIT,
      select: assetSelect,
    }),
    db.asset.count({
      where: {
        OR: [
          { primaryScanCode: null },
          { primaryScanCode: "" },
        ],
      },
    }),
    db.asset.findMany({
      where: {
        OR: [
          { primaryScanCode: null },
          { primaryScanCode: "" },
        ],
      },
      orderBy: { assetTag: "asc" },
      take: SAMPLE_LIMIT,
      select: assetSelect,
    }),
    db.asset.count({
      where: {
        OR: [
          { imageUrl: null },
          { imageUrl: "" },
        ],
      },
    }),
    db.asset.findMany({
      where: {
        OR: [
          { imageUrl: null },
          { imageUrl: "" },
        ],
      },
      orderBy: { assetTag: "asc" },
      take: SAMPLE_LIMIT,
      select: assetSelect,
    }),
    db.asset.count({
      where: {
        status: "RETIRED",
        kitMemberships: { some: { kit: { active: true } } },
      },
    }),
    db.asset.findMany({
      where: {
        status: "RETIRED",
        kitMemberships: { some: { kit: { active: true } } },
      },
      orderBy: { assetTag: "asc" },
      take: SAMPLE_LIMIT,
      select: {
        ...assetSelect,
        kitMemberships: {
          where: { kit: { active: true } },
          take: 2,
          select: { kit: { select: { id: true, name: true } } },
        },
      },
    }),
    db.asset.count({
      where: {
        parentAssetId: null,
        accessories: { none: {} },
        OR: [
          { type: { contains: "camera", mode: "insensitive" } },
          { type: { contains: "body", mode: "insensitive" } },
          { category: { name: { contains: "camera", mode: "insensitive" } } },
        ],
      },
    }),
    db.asset.findMany({
      where: {
        parentAssetId: null,
        accessories: { none: {} },
        OR: [
          { type: { contains: "camera", mode: "insensitive" } },
          { type: { contains: "body", mode: "insensitive" } },
          { category: { name: { contains: "camera", mode: "insensitive" } } },
        ],
      },
      orderBy: { assetTag: "asc" },
      take: SAMPLE_LIMIT,
      select: assetSelect,
    }),
    db.$queryRaw<DuplicateScanRow[]>`
      WITH scan_values AS (
        SELECT id, asset_tag AS label, 'asset tag' AS source, lower(asset_tag) AS scan_value
        FROM assets
        WHERE asset_tag IS NOT NULL AND btrim(asset_tag) <> ''
        UNION ALL
        SELECT id, asset_tag AS label, 'QR' AS source, lower(qr_code_value) AS scan_value
        FROM assets
        WHERE qr_code_value IS NOT NULL AND btrim(qr_code_value) <> ''
        UNION ALL
        SELECT id, asset_tag AS label, 'primary scan' AS source, lower(primary_scan_code) AS scan_value
        FROM assets
        WHERE primary_scan_code IS NOT NULL AND btrim(primary_scan_code) <> ''
      ),
      duplicate_values AS (
        SELECT scan_value, count(*) AS occurrences
        FROM scan_values
        GROUP BY scan_value
        HAVING count(DISTINCT id) > 1
      )
      SELECT
        d.scan_value,
        d.occurrences,
        jsonb_agg(
          jsonb_build_object('id', s.id, 'label', s.label, 'source', s.source)
          ORDER BY s.label, s.source
        ) AS examples
      FROM duplicate_values d
      JOIN scan_values s ON s.scan_value = d.scan_value
      GROUP BY d.scan_value, d.occurrences
      ORDER BY d.occurrences DESC, d.scan_value ASC
      LIMIT ${SAMPLE_LIMIT}
    `,
    db.bulkSku.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      include: {
        location: { select: { name: true } },
        categoryRel: { select: { name: true } },
        balances: { select: { onHandQuantity: true } },
        products: {
          where: { active: true },
          select: { id: true },
        },
        units: {
          select: {
            id: true,
            status: true,
            unitNumber: true,
            productId: true,
            allocations: {
              where: {
                checkedOutAt: { not: null },
                checkedInAt: null,
              },
              take: 1,
              select: { bulkSkuUnitId: true },
            },
          },
        },
      },
    }),
    db.asset.findMany({
      where: {
        parentAssetId: null,
        status: { not: "RETIRED" },
        OR: [
          { category: { name: { in: ["Tripods", "Tripod", "Support", "Monopods", "Monopod", "Lighting", "Lights", "Light"] } } },
          { type: { contains: "tripod", mode: "insensitive" } },
          { type: { contains: "monopod", mode: "insensitive" } },
          { type: { contains: "light kit", mode: "insensitive" } },
          { name: { contains: "tripod", mode: "insensitive" } },
          { name: { contains: "monopod", mode: "insensitive" } },
          { name: { contains: "light kit", mode: "insensitive" } },
          { model: { contains: "tripod", mode: "insensitive" } },
          { model: { contains: "light kit", mode: "insensitive" } },
        ],
      },
      orderBy: { assetTag: "asc" },
      take: 200,
      select: {
        ...assetSelect,
        status: true,
        parentAssetId: true,
        type: true,
      },
    }),
  ]);
  const partialFailures: string[] = [];
  const assetRowsFallback: Array<{
    id: string;
    assetTag: string;
    name: string | null;
    brand: string;
    model: string;
    category: { name: string } | null;
    department: { name: string } | null;
    location: { name: string } | null;
  }> = [];
  const retiredRowsFallback: Array<(typeof assetRowsFallback)[number] & {
    kitMemberships: Array<{ kit: { id: string; name: string } }>;
  }> = [];
  const bulkRowsFallback: Array<{
    id: string;
    name: string;
    category: string;
    trackByNumber: boolean;
    minThreshold: number;
    location: { name: string };
    categoryRel: { name: string } | null;
    balances: Array<{ onHandQuantity: number }>;
    products: Array<{ id: string }>;
    units: Array<{
      id: string;
      status: BulkUnitStatus | `${BulkUnitStatus}`;
      unitNumber: number;
      productId: string | null;
      allocations?: Array<{ bulkSkuUnitId: string }>;
    }>;
  }> = [];
  const supportCandidateFallback: Array<(typeof assetRowsFallback)[number] & {
    status: string;
    parentAssetId: string | null;
    type: string;
  }> = [];
  const missingCategoryCount = settledValue(missingCategoryCountResult, 0, "missingCategoryCount", partialFailures);
  const missingCategoryRows = settledValue(missingCategoryRowsResult, assetRowsFallback, "missingCategoryRows", partialFailures);
  const missingDepartmentCount = settledValue(missingDepartmentCountResult, 0, "missingDepartmentCount", partialFailures);
  const missingDepartmentRows = settledValue(missingDepartmentRowsResult, assetRowsFallback, "missingDepartmentRows", partialFailures);
  const missingScanCodeCount = settledValue(missingScanCodeCountResult, 0, "missingScanCodeCount", partialFailures);
  const missingScanCodeRows = settledValue(missingScanCodeRowsResult, assetRowsFallback, "missingScanCodeRows", partialFailures);
  const missingImageCount = settledValue(missingImageCountResult, 0, "missingImageCount", partialFailures);
  const missingImageRows = settledValue(missingImageRowsResult, assetRowsFallback, "missingImageRows", partialFailures);
  const retiredInKitCount = settledValue(retiredInKitCountResult, 0, "retiredInKitCount", partialFailures);
  const retiredInKitRows = settledValue(retiredInKitRowsResult, retiredRowsFallback, "retiredInKitRows", partialFailures);
  const cameraWithoutAttachmentCount = settledValue(cameraWithoutAttachmentCountResult, 0, "cameraWithoutAttachmentCount", partialFailures);
  const cameraWithoutAttachmentRows = settledValue(cameraWithoutAttachmentRowsResult, assetRowsFallback, "cameraWithoutAttachmentRows", partialFailures);
  const duplicateRows = settledValue(duplicateRowsResult, [] as DuplicateScanRow[], "duplicateRows", partialFailures);
  const bulkRows = settledValue(bulkRowsResult, bulkRowsFallback, "bulkRows", partialFailures);
  const supportCandidateRowsFetched = settledValue(
    supportCandidateRowsResult,
    supportCandidateFallback,
    "supportPoolCandidates",
    partialFailures,
  );

  const lowBulkRows = bulkRows
    .map((sku) => {
      const activeAllocationByUnitId = new Map(
        sku.units.flatMap((unit) => (unit.allocations ?? []).map((allocation) => [unit.id, allocation] as const)),
      );
      const state = summarizeItemFamilyState(sku, activeAllocationByUnitId);
      const threshold = Math.max(DEFAULT_BULK_THRESHOLD, sku.minThreshold);
      return { sku, available: state.availableQuantity, threshold };
    })
    .filter((row) => row.available < row.threshold);

  const unassignedProductSamples: HygieneSample[] = [];
  let unassignedProductCount = 0;
  for (const sku of bulkRows) {
    const activeProductCount = sku.products?.length ?? 0;
    for (const unit of sku.units) {
      if (!shouldAssignUnitProduct({
        trackByNumber: sku.trackByNumber,
        activeProductCount,
        productId: unit.productId,
        unitStatus: unit.status,
      })) continue;
      unassignedProductCount += 1;
      if (unassignedProductSamples.length < SAMPLE_LIMIT) {
        unassignedProductSamples.push({
          id: `${sku.id}:${unit.unitNumber}`,
          label: `${sku.name} #${unit.unitNumber}`,
          detail: `${sku.categoryRel?.name ?? sku.category} / ${sku.location.name} / product unassigned`,
          href: `/bulk-inventory/${sku.id}`,
        });
      }
    }
  }

  const supportPoolCandidates = supportCandidateRowsFetched.filter((asset) =>
    isSerializedSupportPoolCandidate({
      status: asset.status,
      parentAssetId: asset.parentAssetId,
      categoryName: asset.category?.name,
      type: asset.type,
      name: asset.name,
      brand: asset.brand,
      model: asset.model,
      assetTag: asset.assetTag,
    }),
  );

  const duplicateCount = duplicateRows.length;

  const issues = [
    issue(
      "missing-category",
      "Missing category",
      "Items without a category are harder to filter, browse, and suggest during booking.",
      missingCategoryCount,
      missingCategoryRows.map((asset) => ({
        id: asset.id,
        label: assetLabel(asset),
        detail: assetDetail(asset),
        href: `/items/${asset.id}`,
      })),
    ),
    issue(
      "missing-department",
      "Missing department",
      "Department gaps weaken ownership, reporting, and cleanup workflows.",
      missingDepartmentCount,
      missingDepartmentRows.map((asset) => ({
        id: asset.id,
        label: assetLabel(asset),
        detail: assetDetail(asset),
        href: `/items/${asset.id}`,
      })),
    ),
    issue(
      "missing-primary-scan",
      "Missing primary scan code",
      "These items do not have a canonical primary scan value for scan-first workflows.",
      missingScanCodeCount,
      missingScanCodeRows.map((asset) => ({
        id: asset.id,
        label: assetLabel(asset),
        detail: assetDetail(asset),
        href: `/items/${asset.id}`,
      })),
    ),
    issue(
      "missing-image",
      "Missing image",
      "Photos make picker, checkout, and item detail confirmation faster.",
      missingImageCount,
      missingImageRows.map((asset) => ({
        id: asset.id,
        label: assetLabel(asset),
        detail: assetDetail(asset),
        href: `/items/${asset.id}`,
      })),
    ),
    issue(
      "duplicate-scan-identity",
      "Duplicate scan identity",
      "The same physical scan value appears across multiple item identities.",
      duplicateCount,
      duplicateRows.map((row) => ({
        id: row.scan_value,
        label: row.scan_value,
        detail: `${Number(row.occurrences)} appearances / ${row.examples.slice(0, 3).map((example) => `${example.label} ${example.source}`).join(", ")}`,
        href: `/items?q=${encodeURIComponent(row.scan_value)}`,
      })),
    ),
    issue(
      "retired-in-kits",
      "Retired items still in active kits",
      "Retired gear should not stay inside active kit presets.",
      retiredInKitCount,
      retiredInKitRows.map((asset) => ({
        id: asset.id,
        label: assetLabel(asset),
        detail: `${assetDetail(asset)} / ${asset.kitMemberships.map((membership) => membership.kit.name).join(", ")}`,
        href: `/items/${asset.id}`,
      })),
    ),
    issue(
      "camera-missing-attachments",
      "Camera bodies with no attachments",
      "Camera systems with no child accessories may be missing cards, cages, or fixed parts.",
      cameraWithoutAttachmentCount,
      cameraWithoutAttachmentRows.map((asset) => ({
        id: asset.id,
        label: assetLabel(asset),
        detail: assetDetail(asset),
        href: `/items/${asset.id}?tab=attachments`,
      })),
    ),
    issue(
      "low-bulk-stock",
      "Item families below threshold",
      "Low stock makes picker guidance and day-of fulfillment less reliable.",
      lowBulkRows.length,
      lowBulkRows.slice(0, SAMPLE_LIMIT).map(({ sku, available, threshold }) => ({
        id: sku.id,
        label: sku.name,
        detail: `${available} available / ${threshold} threshold / ${sku.categoryRel?.name ?? sku.category} / ${sku.location.name}`,
        href: `/bulk-inventory/${sku.id}`,
      })),
    ),
    issue(
      "units-missing-product",
      "Family units missing product",
      "When a unit-tracked family defines products, every active unit should name its brand/model so maintenance stays accurate without splitting the picker.",
      unassignedProductCount,
      unassignedProductSamples,
    ),
    issue(
      "serialized-support-pool-candidates",
      "Serialized support gear to review as families",
      "Tripods and cased light kits should usually be Tripod / Football Tripod or Light Kit / Football Light Kit unit families, with models as products under each unit.",
      supportPoolCandidates.length,
      supportPoolCandidates.slice(0, SAMPLE_LIMIT).map((asset) => ({
        id: asset.id,
        label: assetLabel(asset),
        detail: assetDetail(asset),
        href: `/items/${asset.id}`,
      })),
    ),
  ];

  const totalOpen = issues.reduce((sum, item) => sum + item.count, 0);
  const criticalCount = issues.filter((item) => item.count > 0).length;

  return ok({
    data: {
      generatedAt: new Date().toISOString(),
      totals: {
        openIssues: totalOpen,
        activeChecks: issues.length,
        checksNeedingWork: criticalCount,
      },
      issues,
      partialFailures,
    },
  });
});
