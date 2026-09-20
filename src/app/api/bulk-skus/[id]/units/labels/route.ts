import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { BulkUnitStatus, Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { csvField } from "@/lib/csv";
import { buildDerivedBulkUnitQrValue } from "@/lib/bulk-unit-qr";
import { bulkUnitLabelExportQuerySchema, markBulkUnitLabelsSchema } from "@/lib/validation";
import { createAuditEntry } from "@/lib/audit";
import { unique } from "@/lib/utils";

function fileSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "labels";
}

// GET — Brother P-Touch label CSV for a numbered bulk SKU.
export const GET = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "bulk_sku", "adjust");
  const { id } = params;

  const { searchParams } = new URL(req.url);
  const { scope } = bulkUnitLabelExportQuerySchema.parse({
    scope: searchParams.get("scope") ?? undefined,
  });

  const sku = await db.bulkSku.findUnique({ where: { id } });
  if (!sku) throw new HttpError(404, "Bulk SKU not found");
  if (!sku.trackByNumber) throw new HttpError(400, "This SKU does not track by number");
  if (!sku.binQrCodeValue?.trim()) {
    throw new HttpError(400, "This SKU has no bin QR code, so unit QR values cannot be derived");
  }

  const where: Prisma.BulkSkuUnitWhereInput =
    scope === "all"
      ? { bulkSkuId: id }
      : { bulkSkuId: id, labelPrintedAt: null, status: { not: BulkUnitStatus.RETIRED } };

  const units = await db.bulkSkuUnit.findMany({
    where,
    orderBy: { unitNumber: "asc" },
    select: { unitNumber: true },
  });

  const header = ["item_number", "qr_code"].join(",");
  const rows = units.map((unit) =>
    [
      csvField(unit.unitNumber),
      csvField(buildDerivedBulkUnitQrValue(sku.binQrCodeValue!, unit.unitNumber)),
    ].join(","),
  );
  const csv = [header, ...rows].join("\n");

  const filename = `brother-labels-${fileSlug(sku.name)}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
});

// POST — mark a batch of exported labels as printed.
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "bulk_sku", "adjust");
  const { id } = params;
  const body = markBulkUnitLabelsSchema.parse(await req.json());
  const unitNumbers = unique(body.unitNumbers);
  const batchId = randomUUID();

  const result = await db.$transaction(async (tx) => {
    const sku = await tx.bulkSku.findUnique({ where: { id } });
    if (!sku) throw new HttpError(404, "Bulk SKU not found");
    if (!sku.trackByNumber) throw new HttpError(400, "This SKU does not track by number");

    const units = await tx.bulkSkuUnit.findMany({
      where: { bulkSkuId: id, unitNumber: { in: unitNumbers } },
      select: { id: true, unitNumber: true, status: true, labelPrintedAt: true },
    });

    const foundNumbers = new Set(units.map((u) => u.unitNumber));
    const missing = unitNumbers.filter((n) => !foundNumbers.has(n));
    if (missing.length > 0) {
      throw new HttpError(400, `Unit numbers not found for this SKU: ${missing.join(", ")}`);
    }

    const toMark = units.filter(
      (u) => u.labelPrintedAt === null && u.status !== BulkUnitStatus.RETIRED,
    );
    const alreadyPrinted = units.filter((u) => u.labelPrintedAt !== null).length;
    const skippedRetired = units.filter(
      (u) => u.labelPrintedAt === null && u.status === BulkUnitStatus.RETIRED,
    ).length;

    if (toMark.length > 0) {
      await tx.bulkSkuUnit.updateMany({
        where: { id: { in: toMark.map((u) => u.id) } },
        data: {
          labelPrintedAt: new Date(),
          labelPrintedById: user.id,
          labelPrintBatchId: batchId,
        },
      });
    }

    return {
      updated: toMark.length,
      alreadyPrinted,
      skippedRetired,
      batchId,
      markedUnitNumbers: toMark.map((u) => u.unitNumber).sort((a, b) => a - b),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "bulk_sku",
    entityId: id,
    action: "mark_labels_printed",
    after: {
      requestedUnitNumbers: unitNumbers,
      updated: result.updated,
      alreadyPrinted: result.alreadyPrinted,
      skippedRetired: result.skippedRetired,
      batchId: result.batchId,
    },
  });

  return ok({ data: result });
});
