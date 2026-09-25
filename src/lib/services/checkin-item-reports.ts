import { AssetStatus, BookingCustodyScope, CheckinReportType, Prisma, ScanPhase, type Role } from "@prisma/client";
import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createAuditEntry, createAuditEntryTx } from "@/lib/audit";
import { checkinReportSchema } from "@/lib/validation";
import { deferPush, notifyItemReport } from "@/lib/services/notifications";
import { maybeAutoComplete } from "@/lib/services/bookings-checkin";
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
      assetId: formData.get("assetId"),
      type: formData.get("type"),
      description: typeof rawDescription === "string" && rawDescription.trim()
        ? rawDescription
        : undefined,
    }),
    file: rawFile instanceof File && rawFile.size > 0 ? rawFile : null,
    actorId: typeof rawActor === "string" && rawActor ? rawActor : null,
  };
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
  let completed = false;
  try {
    if (args.kiosk) {
      const kiosk = args.kiosk;
      const outcome = await db.$transaction(async (tx) => {
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
        const completedAt = type === "LOST"
          ? await maybeAutoComplete(tx, id, kiosk.booking.locationId, args.reporter.id, {
              auditAction: "auto_completed_by_kiosk_checkin",
              returnedFor: kiosk.booking,
            })
          : null;
        return { saved, held, completed: completedAt !== null };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      report = outcome.saved;
      heldForStaff = outcome.held;
      completed = outcome.completed;
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
    completed,
  };
}
