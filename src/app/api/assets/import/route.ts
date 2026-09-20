import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { isBlobUrl } from "@/lib/blob";
import { buildAssetTagSortFields } from "@/lib/item-asset-tag-sort";

const mappingSchema = z.record(z.string().min(1), z.string().min(1));

// ── CSV parsing ──────────────────────────────────────────

function parseDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

// ── Column mapping ───────────────────────────────────────

type ColumnMapping = Record<string, string>; // csvHeader → fieldName

/** Default Cheqroom preset: maps known Cheqroom headers to our fields */
const CHEQROOM_PRESET: Record<string, string> = {
  "Name": "assetTag",
  "name": "assetTag",
  "Category": "type",
  "Brand": "brand",
  "Model": "model",
  "Serial number": "serialNumber",
  "serial_number": "serialNumber",
  "Quantity": "quantity",
  "Kind": "kind",
  "Warranty Date": "warrantyDate",
  "Purchase Price": "purchasePrice",
  "Purchase Date": "purchaseDate",
  "Residual Value": "residualValue",
  "Location": "locationName",
  "location_name": "locationName",
  "Department": "department",
  "Kit": "kitName",
  "Image Url": "imageUrl",
  "Image URL": "imageUrl",
  "Image url": "imageUrl",
  "Image": "imageUrl",
  "Photo Url": "imageUrl",
  "Photo URL": "imageUrl",
  "Photo": "imageUrl",
  "image_url": "imageUrl",
  "UW Asset Tag": "uwAssetTag",
  "uw_asset_tag": "uwAssetTag",
  "Codes": "codes",
  "Barcodes": "barcodes",
  "Id": "sourceId",
  "Retired": "retired",
  "Link": "link",
  "Description": "description",
  "Owner": "owner",
  "Fiscal Year Purchased": "fiscalYear",
  "Flag": "flag",
  "Geo": "geo",
};

function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const header of headers) {
    if (CHEQROOM_PRESET[header]) {
      mapping[header] = CHEQROOM_PRESET[header];
    }
  }
  return mapping;
}

// ── Row normalization ────────────────────────────────────

type NormalizedRow = {
  line: number;
  assetTag: string;
  assetTagDeduped: boolean;
  name: string;
  type: string;
  brand: string;
  model: string;
  serialNumber: string;
  qrCodeValue: string;
  primaryScanCode: string;
  purchaseDate: string;
  purchasePrice: string;
  warrantyDate: string;
  residualValue: string;
  locationName: string;
  departmentName: string;
  kitName: string;
  imageUrl: string;
  uwAssetTag: string;
  consumable: boolean;
  quantity: number;
  retired: boolean;
  link: string;
  description: string;
  owner: string;
  fiscalYear: string;
  sourcePayload: Record<string, string>;
  warnings: string[];
  errors: string[];
  /** "create" | "update" | "skip" — set during preview with DB lookup */
  action?: string;
};

function getMapped(record: Record<string, string>, mapping: ColumnMapping, field: string): string {
  for (const [csvHeader, targetField] of Object.entries(mapping)) {
    if (targetField === field) {
      const value = record[csvHeader];
      if (value && value.trim()) return value.trim();
    }
  }
  return "";
}

function parseRows(content: string, userMapping?: ColumnMapping): {
  headers: string[];
  rows: NormalizedRow[];
  mapping: ColumnMapping;
} {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new HttpError(400, "CSV must include a header and at least one data row");
  }

  const delimiter = lines[0]!.includes(";") ? ";" : ","; // guarded by lines.length < 2 check above
  const headers = parseDelimitedLine(lines[0]!, delimiter);
  const mapping = userMapping ?? autoDetectMapping(headers);

  // First pass: collect tags to detect duplicates
  const rawRows: Array<{ record: Record<string, string>; lineNo: number }> = [];
  const tagCounts = new Map<string, number>();

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseDelimitedLine(lines[i]!, delimiter); // in-bounds by loop condition
    const record = Object.fromEntries(
      headers.map((h, idx) => [h, values[idx] ?? ""])
    ) as Record<string, string>;
    rawRows.push({ record, lineNo: i + 1 });

    const name = getMapped(record, mapping, "assetTag");
    const tag = name || `import-${i}`;
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  // Second pass: normalize
  const tagUsed = new Map<string, number>();
  const rows: NormalizedRow[] = [];

  for (const { record, lineNo } of rawRows) {
    const warnings: string[] = [];
    const errors: string[] = [];

    const name = getMapped(record, mapping, "assetTag");
    const baseTag = name || `import-${lineNo - 1}`;

    let assetTag = baseTag;
    let deduped = false;
    if ((tagCounts.get(baseTag) ?? 0) > 1) {
      const count = tagUsed.get(baseTag) ?? 0;
      tagUsed.set(baseTag, count + 1);
      if (count > 0) {
        assetTag = `${baseTag}-${count}`;
        deduped = true;
        warnings.push(`Duplicate name "${baseTag}" → renamed to "${assetTag}"`);
      }
    }

    const kind = getMapped(record, mapping, "kind").toLowerCase();
    const quantity = parseInt(getMapped(record, mapping, "quantity") || "1", 10) || 1;
    const consumable = kind === "bulk";

    const sourceId = getMapped(record, mapping, "sourceId");
    const serialNumber =
      getMapped(record, mapping, "serialNumber") ||
      `auto-${sourceId || assetTag}`;

    const codes = getMapped(record, mapping, "codes");
    const barcodes = getMapped(record, mapping, "barcodes");
    const primaryScanCode = codes || barcodes || "";
    const qrCodeValue = primaryScanCode || `bg://item/${assetTag}`;
    const imageUrl = getMapped(record, mapping, "imageUrl");

    const locationName = getMapped(record, mapping, "locationName");
    if (!locationName) errors.push("Missing location");

    const retiredRaw = getMapped(record, mapping, "retired").toLowerCase();
    const retired = retiredRaw === "true" || retiredRaw === "yes" || retiredRaw === "1";

    // Collect unmapped columns into sourcePayload (D-014 lossless parsing)
    const mappedHeaders = new Set(Object.keys(mapping));
    const sourcePayload: Record<string, string> = {};
    for (const [header, value] of Object.entries(record)) {
      if (!mappedHeaders.has(header) && value.trim()) {
        sourcePayload[header] = value.trim();
      }
    }
    // Also preserve mapped tracking/source fields for traceability.
    if (sourceId) sourcePayload["sourceId"] = sourceId;
    if (codes) sourcePayload["cheqroomCodes"] = codes;
    if (barcodes) sourcePayload["cheqroomBarcodes"] = barcodes;
    if (imageUrl) sourcePayload["cheqroomImageUrl"] = imageUrl;
    const flagVal = getMapped(record, mapping, "flag");
    if (flagVal) sourcePayload["flag"] = flagVal;
    const geoVal = getMapped(record, mapping, "geo");
    if (geoVal) sourcePayload["geo"] = geoVal;

    rows.push({
      line: lineNo,
      assetTag,
      assetTagDeduped: deduped,
      name,
      type: getMapped(record, mapping, "type") || "equipment",
      brand: getMapped(record, mapping, "brand") || "Unknown",
      model: getMapped(record, mapping, "model") || "Unknown",
      serialNumber,
      qrCodeValue,
      primaryScanCode,
      purchaseDate: getMapped(record, mapping, "purchaseDate"),
      purchasePrice: getMapped(record, mapping, "purchasePrice"),
      warrantyDate: getMapped(record, mapping, "warrantyDate"),
      residualValue: getMapped(record, mapping, "residualValue"),
      locationName,
      departmentName: getMapped(record, mapping, "department"),
      kitName: getMapped(record, mapping, "kitName"),
      imageUrl: getMapped(record, mapping, "imageUrl"),
      uwAssetTag: getMapped(record, mapping, "uwAssetTag"),
      consumable,
      quantity,
      retired,
      link: getMapped(record, mapping, "link"),
      description: getMapped(record, mapping, "description"),
      owner: getMapped(record, mapping, "owner"),
      fiscalYear: getMapped(record, mapping, "fiscalYear"),
      sourcePayload,
      warnings,
      errors,
    });
  }

  return { headers, rows, mapping };
}

// ── Shared helpers ───────────────────────────────────────

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+00:00:00)?$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseCurrency(raw: string): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw.replace(/[^\d.-]+/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function buildAssetData(
  row: NormalizedRow,
  locationId: string,
  departmentId: string | null
) {
  const notesPayload = {
    cheqroomName: row.name || undefined,
    description: row.description || undefined,
    owner: row.owner || undefined,
    fiscalYear: row.fiscalYear || undefined,
    link: row.link || undefined,
  };

  return {
    ...buildAssetTagSortFields(row.assetTag),
    name: row.name || null,
    type: row.type,
    brand: row.brand,
    model: row.model,
    serialNumber: row.serialNumber,
    qrCodeValue: row.qrCodeValue,
    primaryScanCode: row.primaryScanCode || null,
    purchaseDate: parseDate(row.purchaseDate),
    purchasePrice: parseCurrency(row.purchasePrice),
    warrantyDate: parseDate(row.warrantyDate),
    residualValue: parseCurrency(row.residualValue),
    locationId,
    departmentId,
    status: row.retired ? ("RETIRED" as const) : ("AVAILABLE" as const),
    consumable: row.consumable,
    imageUrl: row.imageUrl || null,
    uwAssetTag: row.uwAssetTag || null,
    linkUrl: row.link || null,
    notes: JSON.stringify(notesPayload),
    // D-014: sourcePayload stores unmapped columns plus mapped source identifiers for traceability.
    sourcePayload: Object.keys(row.sourcePayload).length > 0 ? row.sourcePayload : undefined,
  };
}

// ── POST handler ─────────────────────────────────────────

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "asset", "import");
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") || "import";
  const importMode = searchParams.get("importMode") || "upsert";

  if (mode !== "preview" && mode !== "import") {
    throw new HttpError(400, "Import mode must be preview or import");
  }
  if (importMode !== "upsert" && importMode !== "create_only") {
    throw new HttpError(400, "Import write mode must be upsert or create_only");
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const mappingRaw = formData.get("mapping");

  if (!(file instanceof File)) {
    throw new HttpError(400, "Expected multipart file field named 'file'");
  }

  let userMapping: ColumnMapping | undefined;
  if (mappingRaw) {
    if (typeof mappingRaw !== "string") {
      throw new HttpError(400, "Mapping must be a JSON object");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(mappingRaw);
    } catch {
      throw new HttpError(400, "Mapping must be valid JSON");
    }
    userMapping = mappingSchema.parse(parsed);
  }

  const text = await file.text();
  const { headers, rows, mapping } = parseRows(text, userMapping);

  // ── Preview mode (3-4 DB calls) ───────────────────────
  if (mode === "preview") {
    const locationNames = [...new Set(rows.map((r) => r.locationName).filter(Boolean))];
    const departmentNames = [...new Set(rows.map((r) => r.departmentName).filter(Boolean))];
    const kitNames = [...new Set(rows.map((r) => r.kitName).filter(Boolean))];

    // Batch: 2 findMany calls for locations + departments
    const [existingLocations, existingDepartments] = await db.$transaction([
      db.location.findMany({ where: { name: { in: locationNames.length > 0 ? locationNames : ["__none__"] } } }),
      db.department.findMany({ where: { name: { in: departmentNames.length > 0 ? departmentNames : ["__none__"] } } }),
    ]);

    const newLocations = locationNames.filter(
      (n) => !existingLocations.some((l) => l.name === n)
    );
    const newDepartments = departmentNames.filter(
      (n) => !existingDepartments.some((d) => d.name === n)
    );

    // Batch: check for existing assets by serialNumber + assetTag (1 call)
    const allSerials = rows.map((r) => r.serialNumber).filter(Boolean);
    const allTags = rows.map((r) => r.assetTag).filter(Boolean);

    const existingAssets = await db.asset.findMany({
      where: {
        OR: [
          { serialNumber: { in: allSerials.length > 0 ? allSerials : ["__none__"] } },
          { assetTag: { in: allTags.length > 0 ? allTags : ["__none__"] } },
        ],
      },
      select: { id: true, serialNumber: true, assetTag: true },
    });

    const existingBySerial = new Set(existingAssets.map((a) => a.serialNumber));
    const existingByTag = new Set(existingAssets.map((a) => a.assetTag));

    // Mark each row with its action
    let willCreate = 0;
    let willUpdate = 0;
    for (const row of rows) {
      if (row.errors.length > 0) {
        row.action = "skip";
      } else if (existingBySerial.has(row.serialNumber) || existingByTag.has(row.assetTag)) {
        row.action = "update";
        willUpdate += 1;
      } else {
        row.action = "create";
        willCreate += 1;
      }
    }

    return ok({
      headers,
      totalRows: rows.length,
      rows: rows.slice(0, 200),
      mapping,
      summary: {
        totalItems: rows.length,
        willCreate,
        willUpdate,
        withErrors: rows.filter((r) => r.errors.length > 0).length,
        withWarnings: rows.filter((r) => r.warnings.length > 0).length,
        duplicateNames: rows.filter((r) => r.assetTagDeduped).length,
        consumableItems: rows.filter((r) => r.consumable).length,
        retiredItems: rows.filter((r) => r.retired).length,
        locations: locationNames,
        newLocations,
        departments: departmentNames,
        newDepartments,
        kits: kitNames,
      },
    });
  }

  // ── Import mode (batched — target ≤20 DB calls) ───────

  const validRows = rows.filter((r) => r.errors.length === 0);
  const importErrors: Array<{ line: number; assetTag: string; error: string }> = [];
  const skippedCount = rows.length - validRows.length;

  // Collect error rows
  for (const row of rows) {
    if (row.errors.length > 0) {
      importErrors.push({ line: row.line, assetTag: row.assetTag, error: row.errors.join("; ") });
    }
  }

  // 1. Batch: upsert locations + departments via $transaction (1 call)
  const locationNames = [...new Set(validRows.map((r) => r.locationName).filter(Boolean))];
  const deptNames = [...new Set(validRows.map((r) => r.departmentName).filter(Boolean))];

  const locationUpserts = locationNames.map((name) =>
    db.location.upsert({ where: { name }, create: { name }, update: {} })
  );
  const deptUpserts = deptNames.map((name) =>
    db.department.upsert({ where: { name }, create: { name }, update: {} })
  );

  const upsertResults = await db.$transaction([...locationUpserts, ...deptUpserts]);
  const locationMap = new Map<string, string>();
  const deptMap = new Map<string, string>();

  for (let i = 0; i < locationNames.length; i++) {
    const name = locationNames[i]!; // in-bounds by loop condition
    const result = upsertResults[i]!; // parallel array, same length
    locationMap.set(name, result.id);
  }
  for (let i = 0; i < deptNames.length; i++) {
    const name = deptNames[i]!; // in-bounds by loop condition
    const result = upsertResults[locationNames.length + i]!; // parallel array offset by locationNames.length
    deptMap.set(name, result.id);
  }

  // 2. Batch: find existing assets by serialNumber + assetTag (1 call)
  const allSerials = validRows.map((r) => r.serialNumber).filter(Boolean);
  const allTags = validRows.map((r) => r.assetTag).filter(Boolean);
  const allScanValues = [
    ...new Set(
      validRows
        .flatMap((r) => [r.qrCodeValue, r.primaryScanCode])
        .filter((value): value is string => Boolean(value))
    ),
  ];

  const existingAssets = await db.asset.findMany({
    where: {
      OR: [
        { serialNumber: { in: allSerials.length > 0 ? allSerials : ["__none__"] } },
        { assetTag: { in: allTags.length > 0 ? allTags : ["__none__"] } },
        { qrCodeValue: { in: allScanValues.length > 0 ? allScanValues : ["__none__"] } },
        { primaryScanCode: { in: allScanValues.length > 0 ? allScanValues : ["__none__"] } },
      ],
    },
    select: { id: true, serialNumber: true, assetTag: true, qrCodeValue: true, primaryScanCode: true },
  });

  const existingBySerial = new Map(existingAssets.filter((a) => a.serialNumber).map((a) => [a.serialNumber, a]));
  const existingByTag = new Map(existingAssets.map((a) => [a.assetTag, a]));
  const existingByQr = new Map(existingAssets.map((a) => [a.qrCodeValue, a]));
  const existingByPrimaryScan = new Map(
    existingAssets.filter((a) => a.primaryScanCode).map((a) => [a.primaryScanCode!, a])
  );

  // 3. Split rows into creates vs updates, and separate bulk items
  const toCreate: Array<{ row: NormalizedRow; data: ReturnType<typeof buildAssetData> }> = [];
  const toUpdate: Array<{ row: NormalizedRow; id: string; data: Record<string, unknown> }> = [];
  const bulkRows: Array<{ row: NormalizedRow; locationId: string }> = [];
  const seenCreateAssetTags = new Set<string>();
  const seenCreateScanValues = new Set<string>();
  let createdCount = 0;
  let updatedCount = 0;
  let bulkCreatedCount = 0;

  for (const row of validRows) {
    const locationId = locationMap.get(row.locationName);
    if (!locationId) {
      importErrors.push({ line: row.line, assetTag: row.assetTag, error: "Location not resolved" });
      continue;
    }

    // Route bulk items to BulkSku instead of Asset
    if (row.consumable) {
      bulkRows.push({ row, locationId });
      continue;
    }

    const departmentId = row.departmentName ? deptMap.get(row.departmentName) ?? null : null;

    const existing =
      existingBySerial.get(row.serialNumber) ??
      existingByTag.get(row.assetTag) ??
      existingByQr.get(row.qrCodeValue) ??
      existingByPrimaryScan.get(row.primaryScanCode);

    if (existing) {
      if (importMode === "create_only") {
        // Skip existing items in create-only mode
        continue;
      }
      const qrOwner = existingByQr.get(row.qrCodeValue);
      const scanOwner = row.primaryScanCode ? existingByPrimaryScan.get(row.primaryScanCode) : null;
      if ((qrOwner && qrOwner.id !== existing.id) || (scanOwner && scanOwner.id !== existing.id)) {
        importErrors.push({
          line: row.line,
          assetTag: row.assetTag,
          error: "Tracking code already belongs to another asset",
        });
        continue;
      }
      const { serialNumber, ...updateDataWithImage } = buildAssetData(row, locationId, departmentId);
      void serialNumber;
      const updateData = row.imageUrl
        ? updateDataWithImage
        : Object.fromEntries(
            Object.entries(updateDataWithImage).filter(([key]) => key !== "imageUrl"),
          );
      toUpdate.push({ row, id: existing.id, data: updateData });
    } else {
      if (seenCreateAssetTags.has(row.assetTag)) {
        importErrors.push({
          line: row.line,
          assetTag: row.assetTag,
          error: "Duplicate asset tag in import file",
        });
        continue;
      }
      const rowScanValues = [row.qrCodeValue, row.primaryScanCode].filter((value): value is string => Boolean(value));
      const duplicateScanValue = rowScanValues.find((value) => seenCreateScanValues.has(value));
      if (duplicateScanValue) {
        importErrors.push({
          line: row.line,
          assetTag: row.assetTag,
          error: `Duplicate tracking code in import file: ${duplicateScanValue}`,
        });
        continue;
      }
      seenCreateAssetTags.add(row.assetTag);
      for (const value of rowScanValues) seenCreateScanValues.add(value);
      toCreate.push({ row, data: buildAssetData(row, locationId, departmentId) });
    }
  }

  // 4-6. Batched writes.
  //
  // ATOMICITY CHANGE: this phase used to run as one interactive transaction
  // covering the whole file, so a large CSV held a single transaction open for
  // thousands of round trips (and a late failure rolled the entire import
  // back). Writes are now grouped and chunked: atomicity is per batch, not
  // per file. A batch commits or rolls back as a unit, and a failed batch
  // reports every row it contained as "not applied" in `errors` while the
  // remaining batches still run. Callers therefore have to read `errors` to
  // know what landed; `created`/`updated`/`bulkCreated` count applied rows only.
  //
  // 200 rows per batch: Neon round trips dominate here, and at this size a
  // pure-insert batch is one createMany and an all-distinct update batch is
  // 200 updateMany statements — short enough to stay inside the serverless
  // timeout and the transaction timeout budget, while keeping the number of
  // transactions (and their commit overhead) an order of magnitude below the
  // row count.
  const IMPORT_BATCH_SIZE = 200;
  const KIT_BATCH_SIZE = 100;
  const MEMBERSHIP_BATCH_SIZE = 500;

  function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  }

  function recordBatchFailure(rows: NormalizedRow[], stage: string, err: unknown) {
    const message = err instanceof Error ? err.message : "unknown";
    for (const row of rows) {
      importErrors.push({
        line: row.line,
        assetTag: row.assetTag,
        error: `${stage} batch failed, row not applied: ${message}`,
      });
    }
  }

  // 4. Create new assets — one createMany per batch.
  for (const batch of chunk(toCreate, IMPORT_BATCH_SIZE)) {
    try {
      await db.$transaction(async (tx) => {
        await tx.asset.createMany({ data: batch.map((entry) => entry.data) });
      });
      createdCount += batch.length;
    } catch (err) {
      recordBatchFailure(batch.map((entry) => entry.row), "Asset create", err);
    }
  }

  // 5. Update existing assets. Rows whose update payload is byte-identical
  // collapse into a single updateMany; distinct payloads still need their own
  // statement, but they now share a bounded transaction instead of one
  // file-long one.
  type UpdateOp = { data: Record<string, unknown>; ids: string[]; rows: NormalizedRow[] };
  const updateGroups = new Map<string, UpdateOp>();
  for (const entry of toUpdate) {
    const key = JSON.stringify(Object.entries(entry.data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    const group = updateGroups.get(key);
    if (group) {
      group.ids.push(entry.id);
      group.rows.push(entry.row);
    } else {
      updateGroups.set(key, { data: entry.data, ids: [entry.id], rows: [entry.row] });
    }
  }
  const updateOps: UpdateOp[] = [];
  for (const group of updateGroups.values()) {
    for (const idChunk of chunk(group.ids.map((id, index) => ({ id, row: group.rows[index]! })), IMPORT_BATCH_SIZE)) {
      updateOps.push({
        data: group.data,
        ids: idChunk.map((item) => item.id),
        rows: idChunk.map((item) => item.row),
      });
    }
  }
  const updateBatches: UpdateOp[][] = [];
  let pendingUpdates: UpdateOp[] = [];
  let pendingUpdateRows = 0;
  for (const op of updateOps) {
    if (pendingUpdates.length > 0 && pendingUpdateRows + op.ids.length > IMPORT_BATCH_SIZE) {
      updateBatches.push(pendingUpdates);
      pendingUpdates = [];
      pendingUpdateRows = 0;
    }
    pendingUpdates.push(op);
    pendingUpdateRows += op.ids.length;
  }
  if (pendingUpdates.length > 0) updateBatches.push(pendingUpdates);

  for (const batch of updateBatches) {
    try {
      await db.$transaction(async (tx) => {
        for (const op of batch) {
          await tx.asset.updateMany({ where: { id: { in: op.ids } }, data: op.data });
        }
      });
      updatedCount += batch.reduce((total, op) => total + op.ids.length, 0);
    } catch (err) {
      recordBatchFailure(batch.flatMap((op) => op.rows), "Asset update", err);
    }
  }

  // 5b. Create BulkSku + BulkStockBalance for bulk rows. Prisma has no batched
  // upsert, so these stay two statements per row; chunking keeps any one
  // transaction bounded.
  for (const batch of chunk(bulkRows, IMPORT_BATCH_SIZE)) {
    let batchCreated = 0;
    try {
      await db.$transaction(async (tx) => {
        batchCreated = 0;
        for (const { row, locationId } of batch) {
          const binQr = row.primaryScanCode || `bg://bulk/${row.assetTag}`;
          const sku = await tx.bulkSku.upsert({
            where: { locationId_binQrCodeValue: { locationId, binQrCodeValue: binQr } },
            create: {
              name: row.name || row.assetTag,
              category: row.type || "consumable",
              unit: "each",
              locationId,
              binQrCodeValue: binQr,
              imageUrl: row.imageUrl || null,
            },
            update: {
              name: row.name || row.assetTag,
              category: row.type || "consumable",
              ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}),
            },
          });
          await tx.bulkStockBalance.upsert({
            where: { bulkSkuId_locationId: { bulkSkuId: sku.id, locationId } },
            create: { bulkSkuId: sku.id, locationId, onHandQuantity: row.quantity },
            update: { onHandQuantity: { increment: row.quantity } },
          });
          batchCreated += 1;
        }
      });
      bulkCreatedCount += batchCreated;
    } catch (err) {
      recordBatchFailure(batch.map((entry) => entry.row), "Bulk SKU", err);
    }
  }

  // 6. Kit creation + membership. Kit rows are pre-indexed by kit name, so
  // resolving a kit's location is a Map hit instead of a scan of every valid
  // row (this loop used to be O(rows x kits)).
  const kitRowByName = new Map<string, NormalizedRow>();
  for (const row of validRows) {
    if (!row.kitName || !row.locationName) continue;
    if (!kitRowByName.has(row.kitName)) kitRowByName.set(row.kitName, row);
  }
  const kitEntries = [...kitRowByName.entries()].flatMap(([kitName, row]) => {
    const kitLocationId = locationMap.get(row.locationName);
    return kitLocationId ? [{ kitName, kitLocationId, row }] : [];
  });
  let kitsCreated = 0;
  const kitMap = new Map<string, string>();

  for (const batch of chunk(kitEntries, KIT_BATCH_SIZE)) {
    try {
      const upserted = await db.$transaction(async (tx) => {
        const results: Array<{ kitName: string; id: string }> = [];
        for (const { kitName, kitLocationId } of batch) {
          const kit = await tx.kit.upsert({
            where: { name_locationId: { name: kitName, locationId: kitLocationId } },
            create: { name: kitName, locationId: kitLocationId },
            update: {},
          });
          results.push({ kitName, id: kit.id });
        }
        return results;
      });
      for (const result of upserted) kitMap.set(result.kitName, result.id);
      kitsCreated += upserted.length;
    } catch (err) {
      recordBatchFailure(batch.map((entry) => entry.row), "Kit", err);
    }
  }

  if (kitMap.size > 0) {
    // Look up all assets that belong to kits
    const kitRowSerials = validRows.filter((r) => r.kitName).map((r) => r.serialNumber);
    const kitAssets = await db.asset.findMany({
      where: { serialNumber: { in: kitRowSerials } },
      select: { id: true, serialNumber: true },
    });
    const assetBySerial = new Map(kitAssets.map((a) => [a.serialNumber, a.id]));

    // Create all kit memberships
    const memberships: Array<{ kitId: string; assetId: string; row: NormalizedRow }> = [];
    for (const row of validRows) {
      if (!row.kitName) continue;
      const kitId = kitMap.get(row.kitName);
      const assetId = assetBySerial.get(row.serialNumber);
      if (kitId && assetId) {
        memberships.push({ kitId, assetId, row });
      }
    }

    for (const batch of chunk(memberships, MEMBERSHIP_BATCH_SIZE)) {
      try {
        await db.kitMembership.createMany({
          data: batch.map(({ kitId, assetId }) => ({ kitId, assetId })),
          skipDuplicates: true,
        });
      } catch (err) {
        recordBatchFailure(batch.map((entry) => entry.row), "Kit membership", err);
      }
    }
  }

  // 7. Defer image re-hosting to the rehost-images cron.
  // Re-hosting external CDN images to Blob inline used to run here in batches,
  // but with large imports it blew the serverless timeout, leaving most assets
  // on fragile third-party URLs. Imported assets keep whatever URL the CSV
  // carried; the cron picks up any non-blob `imageUrl` (attempts default to 0)
  // and mirrors it to Blob in small batches. See /api/cron/rehost-images.
  const imagesQueued = validRows.filter(
    (r) => r.imageUrl && !isBlobUrl(r.imageUrl)
  ).length;

  // 8. Audit log (1 call)
  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "import",
    entityId: "cheqroom",
    action: "csv_import",
    after: {
      created: createdCount,
      updated: updatedCount,
      bulkCreated: bulkCreatedCount,
      skipped: skippedCount,
      kitsCreated,
      imagesQueued,
      errorCount: importErrors.length,
    },
  });

  return ok({
    created: createdCount,
    updated: updatedCount,
    bulkCreated: bulkCreatedCount,
    skipped: skippedCount,
    kitsCreated,
    imagesQueued,
    errors: importErrors,
  });
});
