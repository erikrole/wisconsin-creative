/**
 * Operator maintenance: read-only item catalog quality audit.
 * Not a daily product path. Pair with cleanup:item-data dry-run after physical
 * review queues in tasks/item-data-hygiene-status-2026-10-07.md.
 */
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is required for the item data audit.");
  process.exit(1);
}

const db = new PrismaClient({
  adapter: new PrismaNeon({ connectionString }),
});

const SAMPLE_LIMIT = 10;

function printSection(title) {
  console.log(`\n## ${title}`);
}

function printRows(rows, formatter) {
  if (rows.length === 0) {
    console.log("- none");
    return;
  }

  for (const row of rows) {
    console.log(`- ${formatter(row)}`);
  }
}

async function main() {
  const [
    assetCount,
    bulkCount,
    activeBulkCount,
    missingCategory,
    missingDepartment,
    missingPrimaryScan,
    missingImage,
    missingSerial,
    unknownBrand,
    unknownModel,
    attachmentCount,
    retiredCount,
    maintenanceCount,
    policyDisabledAssets,
    bulkMissingCategory,
    bulkMissingDepartment,
    bulkMissingImage,
    cameraNoAttachmentsCount,
  ] = await Promise.all([
    db.asset.count(),
    db.bulkSku.count(),
    db.bulkSku.count({ where: { active: true } }),
    db.asset.count({ where: { categoryId: null } }),
    db.asset.count({ where: { departmentId: null } }),
    db.asset.count({
      where: {
        OR: [
          { primaryScanCode: null },
          { primaryScanCode: "" },
        ],
      },
    }),
    db.asset.count({
      where: {
        OR: [
          { imageUrl: null },
          { imageUrl: "" },
        ],
      },
    }),
    db.asset.count({ where: { serialNumber: null } }),
    db.asset.count({
      where: {
        OR: [
          { brand: "" },
          { brand: { equals: "Unknown", mode: "insensitive" } },
        ],
      },
    }),
    db.asset.count({
      where: {
        OR: [
          { model: "" },
          { model: { equals: "Unknown", mode: "insensitive" } },
        ],
      },
    }),
    db.asset.count({ where: { parentAssetId: { not: null } } }),
    db.asset.count({ where: { status: "RETIRED" } }),
    db.asset.count({ where: { status: "MAINTENANCE" } }),
    db.asset.count({
      where: {
        OR: [
          { availableForCheckout: false },
          { availableForReservation: false },
          { availableForCustody: false },
        ],
      },
    }),
    db.bulkSku.count({ where: { active: true, categoryId: null } }),
    db.bulkSku.count({ where: { active: true, departmentId: null } }),
    db.bulkSku.count({
      where: {
        active: true,
        OR: [
          { imageUrl: null },
          { imageUrl: "" },
        ],
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
  ]);

  const duplicateScanValues = await db.$queryRaw`
    WITH scan_values AS (
      SELECT id, asset_tag AS label, 'assetTag' AS source, lower(asset_tag) AS scan_value, '/items/' || id AS href
      FROM assets
      WHERE btrim(asset_tag) <> ''
      UNION ALL
      SELECT id, asset_tag AS label, 'qrCodeValue' AS source, lower(qr_code_value) AS scan_value, '/items/' || id AS href
      FROM assets
      WHERE btrim(qr_code_value) <> ''
      UNION ALL
      SELECT id, asset_tag AS label, 'primaryScanCode' AS source, lower(primary_scan_code) AS scan_value, '/items/' || id AS href
      FROM assets
      WHERE primary_scan_code IS NOT NULL AND btrim(primary_scan_code) <> ''
      UNION ALL
      SELECT id, name AS label, 'bulkBinQr' AS source, lower(bin_qr_code_value) AS scan_value, '/items/bulk-' || id AS href
      FROM bulk_skus
      WHERE active = true AND btrim(bin_qr_code_value) <> ''
    ),
    dupes AS (
      SELECT scan_value
      FROM scan_values
      GROUP BY scan_value
      HAVING count(DISTINCT id) > 1
    )
    SELECT
      s.scan_value,
      jsonb_agg(
        jsonb_build_object('label', s.label, 'source', s.source, 'href', s.href)
        ORDER BY s.label, s.source
      ) AS examples
    FROM scan_values s
    JOIN dupes d ON d.scan_value = s.scan_value
    GROUP BY s.scan_value
    ORDER BY s.scan_value ASC;
  `;

  const duplicateProductRows = await db.$queryRaw`
    SELECT coalesce(name, '') AS name, brand, model, count(*)::int AS count
    FROM assets
    WHERE status <> 'RETIRED' AND parent_asset_id IS NULL
    GROUP BY coalesce(name, ''), brand, model
    HAVING count(*) > 1
    ORDER BY count DESC, name ASC, brand ASC, model ASC
    LIMIT ${SAMPLE_LIMIT};
  `;

  const possibleAttachmentRows = await db.asset.findMany({
    where: {
      parentAssetId: null,
      status: { not: "RETIRED" },
      OR: [
        { assetTag: { contains: "cap", mode: "insensitive" } },
        { name: { contains: "cap", mode: "insensitive" } },
        { assetTag: { contains: "plate", mode: "insensitive" } },
        { name: { contains: "plate", mode: "insensitive" } },
        { assetTag: { contains: "cage", mode: "insensitive" } },
        { name: { contains: "cage", mode: "insensitive" } },
        { type: { contains: "accessories", mode: "insensitive" } },
      ],
    },
    take: SAMPLE_LIMIT,
    orderBy: { assetTag: "asc" },
    select: {
      assetTag: true,
      name: true,
      brand: true,
      model: true,
      type: true,
      availableForCheckout: true,
      availableForReservation: true,
    },
  });

  const missingCategorySamples = await db.asset.findMany({
    where: { categoryId: null },
    take: SAMPLE_LIMIT,
    orderBy: { assetTag: "asc" },
    select: { assetTag: true, name: true, brand: true, model: true, type: true },
  });

  const activeBulkNoDepartmentSamples = await db.bulkSku.findMany({
    where: { active: true, departmentId: null },
    take: SAMPLE_LIMIT,
    orderBy: { name: "asc" },
    select: {
      name: true,
      category: true,
      trackByNumber: true,
      binQrCodeValue: true,
    },
  });

  printSection("Item Data Audit");
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Serialized assets: ${assetCount}`);
  console.log(`Item families: ${bulkCount} (${activeBulkCount} active)`);

  printSection("Counts");
  console.log(`Serialized missing category: ${missingCategory}`);
  console.log(`Serialized missing department: ${missingDepartment}`);
  console.log(`Serialized missing primary scan code: ${missingPrimaryScan}`);
  console.log(`Serialized missing image: ${missingImage}`);
  console.log(`Serialized missing serial number: ${missingSerial}`);
  console.log(`Serialized unknown brand: ${unknownBrand}`);
  console.log(`Serialized unknown model: ${unknownModel}`);
  console.log(`Serialized attachments: ${attachmentCount}`);
  console.log(`Serialized retired: ${retiredCount}`);
  console.log(`Serialized maintenance: ${maintenanceCount}`);
  console.log(`Serialized policy-disabled assets: ${policyDisabledAssets}`);
  console.log(`Active item families missing category: ${bulkMissingCategory}`);
  console.log(`Active item families missing department: ${bulkMissingDepartment}`);
  console.log(`Active item families missing image: ${bulkMissingImage}`);
  console.log(`Camera/body rows with no attachments: ${cameraNoAttachmentsCount}`);
  console.log(`Cross-table duplicate scan values: ${duplicateScanValues.length}`);

  printSection("Duplicate Scan Values");
  printRows(duplicateScanValues, (row) => {
    const examples = row.examples
      .map((example) => `${example.label} [${example.source}] ${example.href}`)
      .join("; ");
    return `${row.scan_value}: ${examples}`;
  });

  printSection("Likely Repeated Product Rows");
  printRows(duplicateProductRows, (row) => {
    const label = row.name || "(blank name)";
    return `${row.count}x ${label} / ${row.brand} / ${row.model}`;
  });

  printSection("Possible Attachment Candidates");
  printRows(possibleAttachmentRows, (row) => {
    const flags = [
      row.availableForCheckout ? "checkout" : null,
      row.availableForReservation ? "reservation" : null,
    ].filter(Boolean).join("+") || "not bookable";
    return `${row.assetTag} / ${row.name || row.brand + " " + row.model} / ${row.type} / ${flags}`;
  });

  printSection("Missing Category Samples");
  printRows(missingCategorySamples, (row) => {
    return `${row.assetTag} / ${row.name || row.brand + " " + row.model} / ${row.type}`;
  });

  printSection("Active Item Families Missing Department Samples");
  printRows(activeBulkNoDepartmentSamples, (row) => {
    const mode = row.trackByNumber ? "Units" : "Quantity";
    return `${row.name} / ${row.category} / ${mode} / ${row.binQrCodeValue}`;
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
