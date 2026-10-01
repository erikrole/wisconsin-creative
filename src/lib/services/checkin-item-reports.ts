import { AssetStatus, BookingCustodyScope, BulkMovementKind, BulkUnitStatus, CheckinReportType, Prisma, ScanPhase, type Role } from "@prisma/client";
import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createAuditEntry, createAuditEntryTx } from "@/lib/audit";
import { checkinReportSchema } from "@/lib/validation";
import { deferPush, notifyItemReport } from "@/lib/services/notifications";
import { maybeAutoComplete } from "@/lib/services/bookings-checkin";
import { reportedLostBulkBySku, upsertBulkBalancesAndMovements } from "@/lib/services/bookings-helpers";
import { deleteImage, imageExtensionForType, isBlobUrl, validateImage, publicBlobAuth } from "@/lib/blob";

const REPORT_DEDUP_WINDOW_MS = 5_000;

/**
 * Read a damaged/lost report from JSON or multipart (`file` is the optional
 * photo). `actorId` is read for kiosk callers; the web route ignores it.
 */
export async function readCheckinReportPayload(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    const json = (await req.json()) as Record<string, unknown>;
    return {
      parsed: checkinReportSchema.safeParse(json),
      file: null as File | null,
      actorId: typeof json?.actorId === "string" ? json.actorId : null,
    };
  }

  const formData = await req.formData();
  const rawDescription = formData.get("description");
  const rawFile = formData.get("file");
  const rawActor = formData.get("actorId");
  return {
    parsed: checkinReportSchema.safeParse({
      assetId: optionalField(formData.get("assetId")),
      bulkSkuUnitId: optionalField(formData.get("bulkSkuUnitId")),
      bulkSkuId: optionalField(formData.get("bulkSkuId")),
      quantity: optionalField(formData.get("quantity")),
      type: formData.get("type"),
      description: typeof rawDescription === "string" && rawDescription.trim()
        ? rawDescription
        : undefined,
    }),
    file: rawFile instanceof File && rawFile.size > 0 ? rawFile : null,
    actorId: typeof rawActor === "string" && rawActor ? rawActor : null,
  };
}

function optionalField(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function uploadReportImage(file: File, bookingId: string, assetId: string) {
  const validationError = await validateImage(file);
  if (validationError) throw new HttpError(400, validationError);

  const ext = imageExtensionForType(file.type);
  const blob = await put(
    `checkin-reports/${bookingId}/${assetId}/${Date.now()}.${ext}`,
    file.stream(),
    {
      ...publicBlobAuth(),
      access: "public",
      contentType: file.type,
    },
  );
  return blob.url;
}

type KioskReportContext = {
  kioskId: string;
  locationId: string;
  booking: { requesterUserId: string | null; custodyScope: BookingCustodyScope; locationId: string };
};

/**
 * Record a damaged or lost report for one serialized item on a checkout.
 * Shared by the web check-in and the kiosk return.
 *
 * - DAMAGED: the item must have been scanned back first.
 * - LOST: no scan needed; the report counts the item as accounted for, so the
 *   return can finish (web semantics, confirmed for the kiosk by Erik
 *   2026-09-25).
 *
 * With `kiosk`, the report commits in one SERIALIZABLE transaction with its
 * consequences: a DAMAGED item is held for staff (asset → MAINTENANCE, audited)
 * and a LOST report on the last outstanding item completes the return.
 */
export async function submitCheckinItemReport(args: {
  bookingId: string;
  bookingTitle: string;
  assetId: string;
  type: "DAMAGED" | "LOST";
  description?: string;
  file: File | null;
  reporter: { id: string; role: Role; name: string };
  kiosk?: KioskReportContext;
}) {
  const { bookingId: id, assetId, type, description } = args;

  const bookingItem = await db.bookingSerializedItem.findUnique({
    where: { bookingId_assetId: { bookingId: id, assetId } },
    include: { asset: { select: { assetTag: true, brand: true, model: true, name: true } } },
  });
  if (!bookingItem) {
    throw new HttpError(404, "Item not found in this checkout");
  }

  if (type === "DAMAGED") {
    const scanEvent = await db.scanEvent.findFirst({
      where: { bookingId: id, assetId, phase: ScanPhase.CHECKIN, success: true },
    });
    if (!scanEvent) {
      throw new HttpError(400, "Item must be scanned before reporting damage");
    }
  } else if (args.kiosk && bookingItem.allocationStatus === "returned") {
    throw new HttpError(409, "This item was already scanned back. Report it as damaged instead.");
  }

  const existingReport = await db.checkinItemReport.findUnique({
    where: { bookingId_assetId: { bookingId: id, assetId } },
    select: { imageUrl: true, createdAt: true },
  });
  if (existingReport && Date.now() - existingReport.createdAt.getTime() < REPORT_DEDUP_WINDOW_MS) {
    throw new HttpError(409, "A report for this item was just submitted. Wait a moment before updating it.");
  }

  const imageUrl = args.file ? await uploadReportImage(args.file, id, assetId) : undefined;
  const upsertArgs = {
    where: { bookingId_assetId: { bookingId: id, assetId } },
    create: {
      bookingId: id,
      assetId,
      type: type as CheckinReportType,
      description,
      imageUrl: imageUrl ?? null,
      reportedById: args.reporter.id,
    },
    update: {
      type: type as CheckinReportType,
      description,
      ...(imageUrl ? { imageUrl } : {}),
      reportedById: args.reporter.id,
    },
  };
  const auditAfter = (reportImageUrl: string | null) => ({
    assetId,
    assetTag: bookingItem.asset.assetTag,
    description,
    imageUrl: reportImageUrl,
  });

  let report;
  let heldForStaff = false;
  let completedAt: Date | null = null;
  try {
    if (args.kiosk) {
      const kiosk = args.kiosk;
      const outcome = await db.$transaction(async (tx) => {
        // Re-read the precondition inside the custody transaction: another
        // kiosk may have scanned the item back since the checks above.
        if (type === "LOST") {
          const current = await tx.bookingSerializedItem.findUnique({
            where: { bookingId_assetId: { bookingId: id, assetId } },
            select: { allocationStatus: true },
          });
          if (!current) throw new HttpError(404, "Item not found in this checkout");
          if (current.allocationStatus === "returned") {
            throw new HttpError(409, "This item was already scanned back. Report it as damaged instead.");
          }
        } else {
          const scanned = await tx.scanEvent.findFirst({
            where: { bookingId: id, assetId, phase: ScanPhase.CHECKIN, success: true },
            select: { id: true },
          });
          if (!scanned) throw new HttpError(400, "Item must be scanned before reporting damage");
        }
        const saved = await tx.checkinItemReport.upsert(upsertArgs);
        let held = false;
        if (type === "DAMAGED") {
          const asset = await tx.asset.findUnique({ where: { id: assetId }, select: { status: true } });
          if (asset && asset.status === AssetStatus.AVAILABLE) {
            await tx.asset.update({ where: { id: assetId }, data: { status: AssetStatus.MAINTENANCE } });
            await createAuditEntryTx(tx, {
              actorId: args.reporter.id,
              actorRole: args.reporter.role,
              entityType: "asset",
              entityId: assetId,
              action: "kiosk_damage_held_for_staff",
              before: { status: asset.status },
              after: { status: AssetStatus.MAINTENANCE, bookingId: id, reportId: saved.id, source: "KIOSK", kioskDeviceId: kiosk.kioskId },
            });
          }
          held = Boolean(asset) && asset?.status !== AssetStatus.RETIRED;
        }
        await createAuditEntryTx(tx, {
          actorId: args.reporter.id,
          actorRole: args.reporter.role,
          entityType: "booking",
          entityId: id,
          action: `checkin_report_${type.toLowerCase()}`,
          before: existingReport ? { reported: true } : { reported: false },
          after: { ...auditAfter(saved.imageUrl), source: "KIOSK", kioskDeviceId: kiosk.kioskId },
        });
        const completedAtTx = type === "LOST"
          ? await maybeAutoComplete(tx, id, kiosk.booking.locationId, args.reporter.id, {
              auditAction: "auto_completed_by_kiosk_checkin",
              returnedFor: kiosk.booking,
            })
          : null;
        return { saved, held, completedAt: completedAtTx };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      report = outcome.saved;
      heldForStaff = outcome.held;
      completedAt = outcome.completedAt;
    } else {
      report = await db.checkinItemReport.upsert(upsertArgs);
    }
  } catch (err) {
    if (imageUrl && isBlobUrl(imageUrl)) {
      await deleteImage(imageUrl).catch(() => {});
    }
    throw err;
  }

  if (imageUrl && existingReport?.imageUrl && isBlobUrl(existingReport.imageUrl)) {
    await deleteImage(existingReport.imageUrl).catch(() => {});
  }

  // Notify supervisors after the response; `deferPush` keeps the function
  // alive until the emails settle instead of letting it freeze mid-send.
  const itemDesc = `${bookingItem.asset.brand} ${bookingItem.asset.model}`;
  deferPush(notifyItemReport({
    bookingId: id,
    bookingTitle: args.bookingTitle,
    assetId,
    assetTag: bookingItem.asset.assetTag,
    itemDescription: itemDesc,
    reportType: type,
    damageDescription: description,
    evidenceImageUrl: report.imageUrl ?? undefined,
    reporterName: args.reporter.name,
  }).catch((err) => {
    console.error("[REPORT] Failed to send supervisor notifications:", err);
  }));

  if (!args.kiosk) {
    await createAuditEntry({
      actorId: args.reporter.id,
      actorRole: args.reporter.role,
      entityType: "booking",
      entityId: id,
      action: `checkin_report_${type.toLowerCase()}`,
      after: auditAfter(report.imageUrl),
    });
  }

  return {
    report,
    asset: {
      id: assetId,
      assetTag: bookingItem.asset.assetTag,
      name: bookingItem.asset.name || bookingItem.asset.assetTag,
    },
    heldForStaff,
    completed: completedAt !== null,
    completedAt,
  };
}

type BulkReportTarget =
  | { kind: "unit"; bulkSkuUnitId: string }
  | { kind: "counted"; bulkSkuId: string; quantity: number };

/**
 * Record a damaged or missing report for bulk gear on a checkout. Shared by
 * the web check-in and the kiosk return, with one rule for both surfaces.
 *
 * Numbered unit (battery #7):
 * - LOST: the unit must still be out. It is accounted for (decision 4): the
 *   unit is marked LOST, its custody episode is closed, and it is never
 *   restocked. The return can finish without it.
 * - DAMAGED: the unit must have been scanned back. There is no maintenance
 *   status for bulk units, so the unit stays in stock and the report flags it
 *   for staff (notified).
 *
 * Counted stock: `quantity` of what is still owed.
 * - LOST: reduces what is owed back; never restocked.
 * - DAMAGED: counts as returned (the same ledger return as the quantity
 *   route) and is flagged for staff.
 *
 * Everything commits in one SERIALIZABLE transaction that re-reads custody
 * state, writes before/after audit, and completes the return when nothing is
 * left owed.
 */
export async function submitBulkCheckinReport(args: {
  bookingId: string;
  bookingTitle: string;
  target: BulkReportTarget;
  type: "DAMAGED" | "LOST";
  description?: string;
  file: File | null;
  reporter: { id: string; role: Role; name: string };
  /** Where returned stock is restocked (counted DAMAGED) and completion runs. */
  locationId: string;
  returnedFor: { requesterUserId: string | null; custodyScope: BookingCustodyScope };
  kiosk?: { kioskId: string };
}) {
  const { bookingId: id, target, type, description } = args;
  const source = args.kiosk ? { source: "KIOSK", kioskDeviceId: args.kiosk.kioskId } : { source: "WEB" };
  const targetKey = target.kind === "unit" ? target.bulkSkuUnitId : target.bulkSkuId;

  const existing = target.kind === "unit"
    ? await db.checkinItemReport.findUnique({
        where: { bookingId_bulkSkuUnitId: { bookingId: id, bulkSkuUnitId: target.bulkSkuUnitId } },
        select: { imageUrl: true, createdAt: true },
      })
    : await db.checkinItemReport.findUnique({
        where: { bookingId_bulkSkuId_type: { bookingId: id, bulkSkuId: target.bulkSkuId, type } },
        select: { imageUrl: true, createdAt: true },
      });
  if (existing && Date.now() - existing.createdAt.getTime() < REPORT_DEDUP_WINDOW_MS) {
    throw new HttpError(409, "A report for this item was just submitted. Wait a moment before updating it.");
  }

  const imageUrl = args.file ? await uploadReportImage(args.file, id, targetKey) : undefined;

  let outcome;
  try {
    outcome = await db.$transaction(async (tx) => {
      let label: { id: string; tag: string; name: string; skuName: string; imageUrl: string | null };
      let saved;
      if (target.kind === "unit") {
        const allocation = await tx.bookingBulkUnitAllocation.findFirst({
          where: {
            bulkSkuUnitId: target.bulkSkuUnitId,
            checkedOutAt: { not: null },
            bookingBulkItem: { bookingId: id },
          },
          include: {
            bulkSkuUnit: { select: { id: true, unitNumber: true, status: true, notes: true, bulkSku: { select: { id: true, name: true, imageUrl: true } } } },
          },
        });
        if (!allocation) throw new HttpError(404, "Item not found in this checkout");
        const unit = allocation.bulkSkuUnit;
        label = {
          id: unit.id,
          tag: `#${unit.unitNumber}`,
          name: `${unit.bulkSku.name} #${unit.unitNumber}`,
          skuName: unit.bulkSku.name,
          imageUrl: unit.bulkSku.imageUrl,
        };
        const prior = await tx.checkinItemReport.findUnique({
          where: { bookingId_bulkSkuUnitId: { bookingId: id, bulkSkuUnitId: unit.id } },
          select: { type: true },
        });
        if (prior?.type === CheckinReportType.LOST) {
          throw new HttpError(409, "This unit was already reported missing.");
        }
        if (type === "LOST") {
          if (allocation.checkedInAt) {
            throw new HttpError(409, "This item was already scanned back. Report it as damaged instead.");
          }
          const now = new Date();
          await tx.bulkSkuUnit.update({
            where: { id: unit.id },
            data: { status: BulkUnitStatus.LOST, notes: `Reported missing at check-in (${id})` },
          });
          await tx.bookingBulkUnitAllocation.update({ where: { id: allocation.id }, data: { checkedInAt: now } });
          await createAuditEntryTx(tx, {
            actorId: args.reporter.id,
            actorRole: args.reporter.role,
            entityType: "bulk_sku_unit",
            entityId: unit.id,
            action: "checkin_report_unit_lost",
            before: { status: unit.status, checkedInAt: null },
            after: { status: BulkUnitStatus.LOST, checkedInAt: now.toISOString(), bookingId: id, ...source },
          });
        } else if (!allocation.checkedInAt) {
          throw new HttpError(400, "Item must be scanned before reporting damage");
        }
        const data = { type: type as CheckinReportType, description, reportedById: args.reporter.id };
        saved = await tx.checkinItemReport.upsert({
          where: { bookingId_bulkSkuUnitId: { bookingId: id, bulkSkuUnitId: unit.id } },
          create: { ...data, bookingId: id, bulkSkuUnitId: unit.id, imageUrl: imageUrl ?? null },
          update: { ...data, ...(imageUrl ? { imageUrl } : {}) },
        });
      } else {
        const item = await tx.bookingBulkItem.findUnique({
          where: { bookingId_bulkSkuId: { bookingId: id, bulkSkuId: target.bulkSkuId } },
          include: { bulkSku: { select: { id: true, name: true, imageUrl: true, trackByNumber: true, binQrCodeValue: true } } },
        });
        if (!item) throw new HttpError(404, "Item not found in this checkout");
        if (item.bulkSku.trackByNumber) throw new HttpError(400, "Report a numbered unit by its number");
        const reportedLost = (await reportedLostBulkBySku(tx, id)).get(item.bulkSkuId) ?? 0;
        const owed = item.checkedOutQuantity - item.checkedInQuantity - reportedLost;
        if (target.quantity > owed) {
          throw new HttpError(409, owed > 0
            ? `Only ${owed} ${item.bulkSku.name} still out. Refresh and try again.`
            : `No ${item.bulkSku.name} still out.`);
        }
        label = {
          id: item.bulkSkuId,
          tag: `x${target.quantity}`,
          name: target.quantity === 1 ? item.bulkSku.name : `${item.bulkSku.name} x${target.quantity}`,
          skuName: item.bulkSku.name,
          imageUrl: item.bulkSku.imageUrl,
        };
        if (type === "DAMAGED") {
          // Damaged counts as returned: the same ledger return as the
          // quantity route, then the report flags it for staff.
          await tx.bookingBulkItem.update({ where: { id: item.id }, data: { checkedInQuantity: { increment: target.quantity } } });
          await upsertBulkBalancesAndMovements(tx, {
            bookingId: id,
            locationId: args.locationId,
            actorUserId: args.reporter.id,
            kind: BulkMovementKind.CHECKIN,
            items: [{ bulkSkuId: item.bulkSkuId, quantity: target.quantity }],
          });
          await tx.scanEvent.create({
            data: {
              bookingId: id,
              actorUserId: args.reporter.id,
              scanType: "BULK_BIN",
              scanValue: item.bulkSku.binQrCodeValue ?? item.bulkSkuId,
              bulkSkuId: item.bulkSkuId,
              quantity: target.quantity,
              success: true,
              phase: ScanPhase.CHECKIN,
              actualLocationId: args.locationId,
              deviceContext: args.kiosk ? `kiosk:${args.kiosk.kioskId}:damaged-return` : "web:damaged-return",
            },
          });
        }
        saved = await tx.checkinItemReport.upsert({
          where: { bookingId_bulkSkuId_type: { bookingId: id, bulkSkuId: item.bulkSkuId, type: type as CheckinReportType } },
          create: {
            bookingId: id,
            bulkSkuId: item.bulkSkuId,
            quantity: target.quantity,
            type: type as CheckinReportType,
            description,
            imageUrl: imageUrl ?? null,
            reportedById: args.reporter.id,
          },
          update: {
            quantity: { increment: target.quantity },
            description,
            ...(imageUrl ? { imageUrl } : {}),
            reportedById: args.reporter.id,
          },
        });
        await createAuditEntryTx(tx, {
          actorId: args.reporter.id,
          actorRole: args.reporter.role,
          entityType: "booking",
          entityId: id,
          action: type === "DAMAGED" ? "checkin_report_bulk_damaged_returned" : "checkin_report_bulk_lost",
          before: { owed },
          after: { owed: owed - target.quantity, quantity: target.quantity, bulkSkuId: item.bulkSkuId, ...source },
        });
      }

      await createAuditEntryTx(tx, {
        actorId: args.reporter.id,
        actorRole: args.reporter.role,
        entityType: "booking",
        entityId: id,
        action: `checkin_report_${type.toLowerCase()}`,
        before: existing ? { reported: true } : { reported: false },
        after: {
          ...(target.kind === "unit" ? { bulkSkuUnitId: target.bulkSkuUnitId } : { bulkSkuId: target.bulkSkuId, quantity: target.quantity }),
          label: label.name,
          description,
          imageUrl: saved.imageUrl,
          ...source,
        },
      });

      const booking = await tx.booking.findUnique({ where: { id }, select: { status: true } });
      const completedAt = booking?.status === "OPEN"
        ? await maybeAutoComplete(tx, id, args.locationId, args.reporter.id, {
            auditAction: args.kiosk ? "auto_completed_by_kiosk_checkin" : "auto_completed_by_checkin_report",
            returnedFor: args.returnedFor,
          })
        : null;
      return { saved, label, completedAt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (err) {
    if (imageUrl && isBlobUrl(imageUrl)) await deleteImage(imageUrl).catch(() => {});
    throw err;
  }

  if (imageUrl && existing?.imageUrl && isBlobUrl(existing.imageUrl)) {
    await deleteImage(existing.imageUrl).catch(() => {});
  }

  deferPush(notifyItemReport({
    bookingId: id,
    bookingTitle: args.bookingTitle,
    assetId: targetKey,
    assetTag: outcome.label.tag,
    itemDescription: outcome.label.skuName,
    reportType: type,
    damageDescription: description,
    evidenceImageUrl: outcome.saved.imageUrl ?? undefined,
    reporterName: args.reporter.name,
  }).catch((err) => {
    console.error("[REPORT] Failed to send supervisor notifications:", err);
  }));

  return {
    report: outcome.saved,
    item: { id: outcome.label.id, assetTag: outcome.label.tag, name: outcome.label.name },
    // Damaged bulk is flagged for staff (notified); the unit/stock stays in inventory.
    heldForStaff: type === "DAMAGED",
    completed: outcome.completedAt !== null,
    completedAt: outcome.completedAt,
  };
}
