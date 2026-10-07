import type { BulkUnitStatus } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { summarizeItemFamilyState } from "@/lib/item-family-state";
import {
  getCleanupWizardCounts,
  listCleanupWizardQueue,
} from "@/lib/services/item-cleanup-wizard";

const SAMPLE_LIMIT = 6;
const DEFAULT_BULK_THRESHOLD = 1;

/** Operational hygiene ignores retired rows so smoke/test leftovers do not inflate the queue. */
const activeSerializedWhere = { status: { not: "RETIRED" as const } };

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
    familyMissingCategoryCountResult,
    familyMissingCategoryRowsResult,
    familyMissingDepartmentCountResult,
    familyMissingDepartmentRowsResult,
    familyMissingImageCountResult,
    familyMissingImageRowsResult,
    retiredInKitCountResult,
    retiredInKitRowsResult,
    cameraWithoutAttachmentCountResult,
    cameraWithoutAttachmentRowsResult,
    duplicateCountResult,
    duplicateRowsResult,
    cleanupWizardCountsResult,
    legacyQrSamplesResult,
    attachmentCandidateSamplesResult,
    bulkRowsResult,
  ] = await Promise.allSettled([
    db.asset.count({ where: { ...activeSerializedWhere, categoryId: null } }),
    db.asset.findMany({
      where: { ...activeSerializedWhere, categoryId: null },
      orderBy: { assetTag: "asc" },
      take: SAMPLE_LIMIT,
      select: assetSelect,
    }),
    db.asset.count({ where: { ...activeSerializedWhere, departmentId: null } }),
    db.asset.findMany({
      where: { ...activeSerializedWhere, departmentId: null },
      orderBy: { assetTag: "asc" },
      take: SAMPLE_LIMIT,
      select: assetSelect,
    }),
    db.asset.count({
      where: {
        ...activeSerializedWhere,
        OR: [
          { primaryScanCode: null },
          { primaryScanCode: "" },
        ],
      },
    }),
    db.asset.findMany({
      where: {
        ...activeSerializedWhere,
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
        ...activeSerializedWhere,
        OR: [
          { imageUrl: null },
          { imageUrl: "" },
        ],
      },
    }),
    db.asset.findMany({
      where: {
        ...activeSerializedWhere,
        OR: [
          { imageUrl: null },
          { imageUrl: "" },
        ],
      },
      orderBy: { assetTag: "asc" },
      take: SAMPLE_LIMIT,
      select: assetSelect,
    }),
    db.bulkSku.count({ where: { active: true, categoryId: null } }),
    db.bulkSku.findMany({
      where: { active: true, categoryId: null },
      orderBy: { name: "asc" },
      take: SAMPLE_LIMIT,
      select: {
        id: true,
        name: true,
        category: true,
        location: { select: { name: true } },
        categoryRel: { select: { name: true } },
        department: { select: { name: true } },
      },
    }),
    db.bulkSku.count({ where: { active: true, departmentId: null } }),
    db.bulkSku.findMany({
      where: { active: true, departmentId: null },
      orderBy: { name: "asc" },
      take: SAMPLE_LIMIT,
      select: {
        id: true,
        name: true,
        category: true,
        location: { select: { name: true } },
        categoryRel: { select: { name: true } },
        department: { select: { name: true } },
      },
    }),
    db.bulkSku.count({
      where: {
        active: true,
        OR: [
          { imageUrl: null },
          { imageUrl: "" },
        ],
      },
    }),
    db.bulkSku.findMany({
      where: {
        active: true,
        OR: [
          { imageUrl: null },
          { imageUrl: "" },
        ],
      },
      orderBy: { name: "asc" },
      take: SAMPLE_LIMIT,
      select: {
        id: true,
        name: true,
        category: true,
        location: { select: { name: true } },
        categoryRel: { select: { name: true } },
        department: { select: { name: true } },
      },
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
        ...activeSerializedWhere,
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
        ...activeSerializedWhere,
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
    // Total distinct colliding scan values across assets and active family bin QR
    // (parity with scripts/audit-item-data.mjs). Count is not capped by SAMPLE_LIMIT.
    db.$queryRaw<Array<{ count: bigint }>>`
      WITH scan_values AS (
        SELECT id, lower(asset_tag) AS scan_value
        FROM assets
        WHERE asset_tag IS NOT NULL AND btrim(asset_tag) <> ''
        UNION ALL
        SELECT id, lower(qr_code_value) AS scan_value
        FROM assets
        WHERE qr_code_value IS NOT NULL AND btrim(qr_code_value) <> ''
        UNION ALL
        SELECT id, lower(primary_scan_code) AS scan_value
        FROM assets
        WHERE primary_scan_code IS NOT NULL AND btrim(primary_scan_code) <> ''
        UNION ALL
        SELECT id, lower(bin_qr_code_value) AS scan_value
        FROM bulk_skus
        WHERE active = true AND bin_qr_code_value IS NOT NULL AND btrim(bin_qr_code_value) <> ''
      ),
      duplicate_values AS (
        SELECT scan_value
        FROM scan_values
        GROUP BY scan_value
        HAVING count(DISTINCT id) > 1
      )
      SELECT count(*)::bigint AS count FROM duplicate_values
    `,
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
        UNION ALL
        SELECT id, name AS label, 'family bin QR' AS source, lower(bin_qr_code_value) AS scan_value
        FROM bulk_skus
        WHERE active = true AND bin_qr_code_value IS NOT NULL AND btrim(bin_qr_code_value) <> ''
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
    getCleanupWizardCounts(),
    listCleanupWizardQueue("legacy_qr", SAMPLE_LIMIT),
    listCleanupWizardQueue("attachment_candidate", SAMPLE_LIMIT),
    db.bulkSku.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      include: {
        location: { select: { name: true } },
        categoryRel: { select: { name: true } },
        balances: { select: { onHandQuantity: true } },
        units: {
          select: {
            id: true,
            status: true,
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
  const familyRowsFallback: Array<{
    id: string;
    name: string;
    category: string;
    location: { name: string };
    categoryRel: { name: string } | null;
    department: { name: string } | null;
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
    units: Array<{
      id: string;
      status: BulkUnitStatus | `${BulkUnitStatus}`;
      allocations?: Array<{ bulkSkuUnitId: string }>;
    }>;
  }> = [];
  const missingCategoryCount = settledValue(missingCategoryCountResult, 0, "missingCategoryCount", partialFailures);
  const missingCategoryRows = settledValue(missingCategoryRowsResult, assetRowsFallback, "missingCategoryRows", partialFailures);
  const missingDepartmentCount = settledValue(missingDepartmentCountResult, 0, "missingDepartmentCount", partialFailures);
  const missingDepartmentRows = settledValue(missingDepartmentRowsResult, assetRowsFallback, "missingDepartmentRows", partialFailures);
  const missingScanCodeCount = settledValue(missingScanCodeCountResult, 0, "missingScanCodeCount", partialFailures);
  const missingScanCodeRows = settledValue(missingScanCodeRowsResult, assetRowsFallback, "missingScanCodeRows", partialFailures);
  const missingImageCount = settledValue(missingImageCountResult, 0, "missingImageCount", partialFailures);
  const missingImageRows = settledValue(missingImageRowsResult, assetRowsFallback, "missingImageRows", partialFailures);
  const familyMissingCategoryCount = settledValue(familyMissingCategoryCountResult, 0, "familyMissingCategoryCount", partialFailures);
  const familyMissingCategoryRows = settledValue(familyMissingCategoryRowsResult, familyRowsFallback, "familyMissingCategoryRows", partialFailures);
  const familyMissingDepartmentCount = settledValue(familyMissingDepartmentCountResult, 0, "familyMissingDepartmentCount", partialFailures);
  const familyMissingDepartmentRows = settledValue(familyMissingDepartmentRowsResult, familyRowsFallback, "familyMissingDepartmentRows", partialFailures);
  const familyMissingImageCount = settledValue(familyMissingImageCountResult, 0, "familyMissingImageCount", partialFailures);
  const familyMissingImageRows = settledValue(familyMissingImageRowsResult, familyRowsFallback, "familyMissingImageRows", partialFailures);
  const retiredInKitCount = settledValue(retiredInKitCountResult, 0, "retiredInKitCount", partialFailures);
  const retiredInKitRows = settledValue(retiredInKitRowsResult, retiredRowsFallback, "retiredInKitRows", partialFailures);
  const cameraWithoutAttachmentCount = settledValue(cameraWithoutAttachmentCountResult, 0, "cameraWithoutAttachmentCount", partialFailures);
  const cameraWithoutAttachmentRows = settledValue(cameraWithoutAttachmentRowsResult, assetRowsFallback, "cameraWithoutAttachmentRows", partialFailures);
  const duplicateCountRows = settledValue(duplicateCountResult, [{ count: 0n }], "duplicateCount", partialFailures);
  const duplicateCount = Number(duplicateCountRows[0]?.count ?? 0);
  const duplicateRows = settledValue(duplicateRowsResult, [] as DuplicateScanRow[], "duplicateRows", partialFailures);
  const cleanupWizardCounts = settledValue(
    cleanupWizardCountsResult,
    {
      legacy_qr: 0,
      missing_serial: 0,
      attachment_candidate: 0,
      deferred: { legacy_qr: 0, missing_serial: 0, attachment_candidate: 0 },
    },
    "cleanupWizardCounts",
    partialFailures,
  );
  const legacyQrSamples = settledValue(legacyQrSamplesResult, [], "legacyQrSamples", partialFailures);
  const attachmentCandidateSamples = settledValue(
    attachmentCandidateSamplesResult,
    [],
    "attachmentCandidateSamples",
    partialFailures,
  );
  const bulkRows = settledValue(bulkRowsResult, bulkRowsFallback, "bulkRows", partialFailures);

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

  function familyDetail(family: (typeof familyRowsFallback)[number]) {
    return [
      family.categoryRel?.name ?? family.category,
      family.department?.name,
      family.location.name,
    ].filter(Boolean).join(" / ") || "No supporting metadata";
  }

  const issues = [
    issue(
      "missing-category",
      "Missing category",
      "Active items without a category are harder to filter, browse, and suggest during booking. Use Fill gaps on Items.",
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
      "Active items without a department weaken ownership, reporting, and cleanup workflows. Use Fill gaps on Items.",
      missingDepartmentCount,
      missingDepartmentRows.map((asset) => ({
        id: asset.id,
        label: assetLabel(asset),
        detail: assetDetail(asset),
        href: `/items/${asset.id}`,
      })),
    ),
    issue(
      "family-missing-category",
      "Item families missing category",
      "Active unit/quantity families without a category drift out of Filters and Fill gaps suggestions.",
      familyMissingCategoryCount,
      familyMissingCategoryRows.map((family) => ({
        id: family.id,
        label: family.name,
        detail: familyDetail(family),
        href: `/bulk-inventory/${family.id}`,
      })),
    ),
    issue(
      "family-missing-department",
      "Item families missing department",
      "Active unit/quantity families without a department weaken ownership and reporting.",
      familyMissingDepartmentCount,
      familyMissingDepartmentRows.map((family) => ({
        id: family.id,
        label: family.name,
        detail: familyDetail(family),
        href: `/bulk-inventory/${family.id}`,
      })),
    ),
    issue(
      "missing-primary-scan",
      "Missing primary scan code",
      "These active items do not have a canonical primary scan value for scan-first workflows.",
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
      "family-missing-image",
      "Item families missing image",
      "Active unit/quantity families without a photo are harder to recognize in the picker.",
      familyMissingImageCount,
      familyMissingImageRows.map((family) => ({
        id: family.id,
        label: family.name,
        detail: familyDetail(family),
        href: `/bulk-inventory/${family.id}`,
      })),
    ),
    issue(
      "duplicate-scan-identity",
      "Duplicate scan identity",
      "The same physical scan value appears across multiple serialized items or active family bin QR codes.",
      duplicateCount,
      duplicateRows.map((row) => ({
        id: row.scan_value,
        label: row.scan_value,
        detail: `${Number(row.occurrences)} appearances / ${row.examples.slice(0, 3).map((example) => `${example.label} ${example.source}`).join(", ")}`,
        href: `/items?q=${encodeURIComponent(row.scan_value)}`,
      })),
    ),
    issue(
      "legacy-qr-labels",
      "Legacy QR labels",
      "Active items still use Cheqroom-era shelf labels in scan fields. Confirm whether a printed QR exists.",
      cleanupWizardCounts.legacy_qr,
      legacyQrSamples.map((asset) => ({
        id: asset.id,
        label: asset.assetTag,
        detail: asset.primaryScanCode || asset.qrCodeValue,
        href: `/items/${asset.id}`,
      })),
    ),
    issue(
      "missing-serial",
      "Missing serial numbers",
      "Active items with no serial on file. Use the Cleanup wizard when you have the gear in hand.",
      cleanupWizardCounts.missing_serial,
      [],
    ),
    issue(
      "attachment-candidates",
      "Attachment parent mapping",
      "Standalone cages, plates, caps, and grips that may belong under a parent camera or lens. Confirm on the shelf before attaching.",
      cleanupWizardCounts.attachment_candidate,
      attachmentCandidateSamples.map((asset) => ({
        id: asset.id,
        label: asset.assetTag,
        detail: [asset.brand, asset.model].filter(Boolean).join(" ") || asset.name || "Accessory candidate",
        href: `/items/${asset.id}?tab=attachments`,
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
      "Advisory only: many bodies correctly have no child accessories. Use this when a cage, grip, or cap should be married to a specific body.",
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
