import { AssetStatus, BookingCustodyScope, CheckinReportType, Prisma, ScanPhase, type Role } from "@prisma/client";
import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createAuditEntryTx } from "@/lib/audit";
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
 * The report commits in one SERIALIZABLE transaction with its
 * consequences: a DAMAGED item is held for staff (asset → MAINTENANCE, audited)
 * and, at the kiosk, a LOST report on the last outstanding item completes the return.
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
  const { bookingId: id, assetId, type } = args;
  const description = args.description?.trim() || undefined;

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
    select: { imageUrl: true, createdAt: true, type: true, description: true, reportedById: true },
  });
  if (existingReport && Date.now() - existingReport.createdAt.getTime() < REPORT_DEDUP_WINDOW_MS) {
    throw new HttpError(409, "A report for this item was just submitted. Wait a moment before updating it.");
  }

  if (type === "DAMAGED" && !description && !args.file && !existingReport?.imageUrl && !existingReport?.description?.trim()) {
    throw new HttpError(400, "Describe the damage or add a photo before submitting the report.");
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
    const kiosk = args.kiosk;
    const source = kiosk ? { source: "KIOSK", kioskDeviceId: kiosk.kioskId } : { source: "WEB" };
    const outcome = await db.$transaction(async (tx) => {
      const currentReport = await tx.checkinItemReport.findUnique({
        where: { bookingId_assetId: { bookingId: id, assetId } },
        select: { imageUrl: true, createdAt: true, type: true, description: true, reportedById: true },
      });
      if (currentReport?.createdAt.getTime() !== existingReport?.createdAt.getTime()
        || currentReport?.type !== existingReport?.type
        || currentReport?.description !== existingReport?.description
        || currentReport?.imageUrl !== existingReport?.imageUrl
        || currentReport?.reportedById !== existingReport?.reportedById) {
        throw new HttpError(409, "This report changed while you were submitting it. Refresh before updating it.");
      }
      // Re-read the precondition inside the custody transaction: another
      // kiosk may have scanned the item back since the checks above.
      if (type === "LOST" && kiosk) {
        const current = await tx.bookingSerializedItem.findUnique({
          where: { bookingId_assetId: { bookingId: id, assetId } },
          select: { allocationStatus: true },
        });
        if (!current) throw new HttpError(404, "Item not found in this checkout");
        if (current.allocationStatus === "returned") {
          throw new HttpError(409, "This item was already scanned back. Report it as damaged instead.");
        }
      } else if (type === "DAMAGED") {
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
        // Touch the version even when already held: a new report invalidates
        // an inspection/release screen that was opened before this evidence.
        if (asset && asset.status !== AssetStatus.RETIRED) {
          await tx.asset.update({ where: { id: assetId }, data: { status: AssetStatus.MAINTENANCE } });
          if (asset.status === AssetStatus.AVAILABLE) {
            await createAuditEntryTx(tx, {
              actorId: args.reporter.id,
              actorRole: args.reporter.role,
              entityType: "asset",
              entityId: assetId,
              action: kiosk ? "kiosk_damage_held_for_staff" : "marked_maintenance",
              before: { status: asset.status },
              after: { status: AssetStatus.MAINTENANCE, bookingId: id, reportId: saved.id, ...source },
            });
          }
        }
        held = Boolean(asset) && asset?.status !== AssetStatus.RETIRED;
      }
      await createAuditEntryTx(tx, {
        actorId: args.reporter.id,
        actorRole: args.reporter.role,
        entityType: "booking",
        entityId: id,
        action: `checkin_report_${type.toLowerCase()}`,
        before: currentReport ? { reported: true, ...currentReport, createdAt: currentReport.createdAt.toISOString() } : { reported: false },
        after: { ...auditAfter(saved.imageUrl), type: saved.type, description: saved.description, reportedById: saved.reportedById, ...source },
      });
      const completedAtTx = type === "LOST" && kiosk
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
  } catch (err) {
    if (imageUrl && isBlobUrl(imageUrl)) {
      await deleteImage(imageUrl).catch(() => {});
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(err.code)) {
      throw new HttpError(409, "This item changed while you were submitting the report. Refresh before trying again.");
    }
    throw err;
  }

  // Replaced evidence remains available through the before/after audit.
  // Only an upload from a failed transaction is cleaned up here.

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
    damageDescription: report.description ?? undefined,
    evidenceImageUrl: report.imageUrl ?? undefined,
    reporterName: args.reporter.name,
  }).catch((err) => {
    console.error("[REPORT] Failed to send supervisor notifications:", err);
  }));

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
