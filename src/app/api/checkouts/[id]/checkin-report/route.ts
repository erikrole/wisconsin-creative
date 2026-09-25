import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { BookingKind, ScanPhase, CheckinReportType } from "@prisma/client";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { createAuditEntry } from "@/lib/audit";
import { checkinReportSchema } from "@/lib/validation";
import { deferPush, notifyItemReport } from "@/lib/services/notifications";
import { deleteImage, imageExtensionForType, isBlobUrl, validateImage, publicBlobAuth } from "@/lib/blob";
import { put } from "@vercel/blob";

const REPORT_DEDUP_WINDOW_MS = 5_000;

async function readReportPayload(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return {
      parsed: checkinReportSchema.safeParse(await req.json()),
      file: null as File | null,
    };
  }

  const formData = await req.formData();
  const rawDescription = formData.get("description");
  const rawFile = formData.get("file");
  return {
    parsed: checkinReportSchema.safeParse({
      assetId: formData.get("assetId"),
      type: formData.get("type"),
      description: typeof rawDescription === "string" && rawDescription.trim()
        ? rawDescription
        : undefined,
    }),
    file: rawFile instanceof File && rawFile.size > 0 ? rawFile : null,
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

/**
 * POST /api/checkouts/[id]/checkin-report
 *
 * Report a serialized item as damaged or lost during check-in scanning.
 * - DAMAGED: item must have been scanned first
 * - LOST: item does not need to be scanned (counts as "accounted for")
 */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  const { id } = params;

  const booking = await requireBookingAction(id, user, "checkin", BookingKind.CHECKOUT);

  const { parsed, file } = await readReportPayload(req);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { assetId, type, description } = parsed.data;

  // Verify the asset belongs to this booking
  const bookingItem = await db.bookingSerializedItem.findUnique({
    where: { bookingId_assetId: { bookingId: id, assetId } },
    include: { asset: { select: { assetTag: true, brand: true, model: true } } },
  });

  if (!bookingItem) {
    throw new HttpError(404, "Item not found in this checkout");
  }

  // For DAMAGED reports, verify the item has been scanned
  if (type === "DAMAGED") {
    const scanEvent = await db.scanEvent.findFirst({
      where: {
        bookingId: id,
        assetId,
        phase: ScanPhase.CHECKIN,
        success: true,
      },
    });

    if (!scanEvent) {
      throw new HttpError(400, "Item must be scanned before reporting damage");
    }
  }

  const existingReport = await db.checkinItemReport.findUnique({
    where: { bookingId_assetId: { bookingId: id, assetId } },
    select: { imageUrl: true, createdAt: true },
  });
  if (existingReport && Date.now() - existingReport.createdAt.getTime() < REPORT_DEDUP_WINDOW_MS) {
    throw new HttpError(409, "A report for this item was just submitted. Wait a moment before updating it.");
  }

  const imageUrl = file ? await uploadReportImage(file, id, assetId) : undefined;

  // Upsert the report (unique on bookingId + assetId)
  let report;
  try {
    report = await db.checkinItemReport.upsert({
      where: { bookingId_assetId: { bookingId: id, assetId } },
      create: {
        bookingId: id,
        assetId,
        type: type as CheckinReportType,
        description,
        imageUrl: imageUrl ?? null,
        reportedById: user.id,
      },
      update: {
        type: type as CheckinReportType,
        description,
        ...(imageUrl ? { imageUrl } : {}),
        reportedById: user.id,
      },
    });
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
    bookingTitle: booking.title,
    assetId,
    assetTag: bookingItem.asset.assetTag,
    itemDescription: itemDesc,
    reportType: type as "DAMAGED" | "LOST",
    damageDescription: description,
    evidenceImageUrl: report.imageUrl ?? undefined,
    reporterName: user.name,
  }).catch((err) => {
    console.error("[REPORT] Failed to send supervisor notifications:", err);
  }));

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "booking",
    entityId: id,
    action: `checkin_report_${type.toLowerCase()}`,
    after: { assetId, assetTag: bookingItem.asset.assetTag, description, imageUrl: report.imageUrl },
  });

  return ok({
    id: report.id,
    type: report.type,
    description: report.description,
    imageUrl: report.imageUrl,
  });
});
