import { Prisma, Role, ScanPhase, ScanSessionStatus, ScanType } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createAuditEntry } from "@/lib/audit";

type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function buildScanCompletionState(tx: TxClient, bookingId: string, phase: ScanPhase) {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: {
      serializedItems: true,
      bulkItems: {
        include: {
          bulkSku: true,
          unitAllocations: {
            include: { bulkSkuUnit: true }
          }
        }
      },
      scanEvents: {
        where: {
          phase,
          success: true
        }
      }
    }
  });

  if (!booking) {
    throw new HttpError(404, "Checkout not found");
  }

  // Load checkin item reports (damaged/lost) — these count as "accounted for"
  const checkinReports = phase === ScanPhase.CHECKIN
    ? await tx.checkinItemReport.findMany({ where: { bookingId } })
    : [];
  const reportedAssetIds = new Set(checkinReports.map((r) => r.assetId));

  const requiredSerialized = new Set(booking.serializedItems.map((item) => item.assetId));
  const scannedSerialized = new Set(
    booking.scanEvents.filter((event) => event.scanType === ScanType.SERIALIZED && event.assetId).map((e) => e.assetId!)
  );

  // Items that are scanned OR reported (damaged/lost) are not considered "missing"
  const missingSerialized = [...requiredSerialized].filter(
    (assetId) => !scannedSerialized.has(assetId) && !reportedAssetIds.has(assetId)
  );

  const requiredBulk = new Map(booking.bulkItems.map((item) => [item.bulkSkuId, item.plannedQuantity]));
  const scannedBulk = new Map<string, number>();

  for (const event of booking.scanEvents) {
    if (event.scanType !== ScanType.BULK_BIN || !event.bulkSkuId) {
      continue;
    }

    const current = scannedBulk.get(event.bulkSkuId) ?? 0;
    scannedBulk.set(event.bulkSkuId, current + (event.quantity ?? 0));
  }

  const missingBulk = [...requiredBulk.entries()]
    .filter(([skuId, qty]) => (scannedBulk.get(skuId) ?? 0) < qty)
    .map(([skuId, qty]) => ({
      bulkSkuId: skuId,
      required: qty,
      scanned: scannedBulk.get(skuId) ?? 0
    }));

  // For numbered bulk items during check-in, report which specific units are outstanding
  const missingUnits: Array<{ bulkSkuId: string; unitNumbers: number[] }> = [];

  if (phase === ScanPhase.CHECKIN) {
    for (const bulkItem of booking.bulkItems) {
      if (!bulkItem.bulkSku.trackByNumber) continue;

      const outstanding = bulkItem.unitAllocations
        .filter((a) => a.checkedOutAt && !a.checkedInAt)
        .map((a) => a.bulkSkuUnit.unitNumber)
        .sort((a, b) => a - b);

      if (outstanding.length > 0) {
        missingUnits.push({
          bulkSkuId: bulkItem.bulkSkuId,
          unitNumbers: outstanding
        });
      }
    }
  }

  return {
    booking,
    missingSerialized,
    missingBulk,
    missingUnits
  };
}

export async function createAdminOverride(args: {
  bookingId: string;
  actorUserId: string;
  actorRole: Role;
  reason: string;
  details?: Record<string, unknown>;
}) {
  if (args.actorRole !== Role.ADMIN) {
    throw new HttpError(403, "Only admins can create overrides");
  }

  const booking = await db.booking.findUnique({ where: { id: args.bookingId } });
  if (!booking) {
    throw new HttpError(404, "Checkout not found");
  }

  // Compute which items are being bypassed from the active scan session
  const activeSession = await db.scanSession.findFirst({
    where: { bookingId: args.bookingId, status: ScanSessionStatus.OPEN },
    orderBy: { startedAt: "desc" },
  });

  let bypassed: Record<string, unknown> | undefined;
  if (activeSession) {
    try {
      const state = await db.$transaction(
        (tx) => buildScanCompletionState(tx, args.bookingId, activeSession.phase),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      bypassed = {
        phase: activeSession.phase,
        missingSerialized: state.missingSerialized,
        missingBulk: state.missingBulk,
        missingUnits: state.missingUnits,
      };
    } catch (err) {
      console.error("[SCAN] Failed to compute bypassed state for audit override:", err);
    }
  }

  // Caller-supplied details take precedence over computed bypassed data on key collision
  const mergedDetails: Record<string, unknown> | undefined =
    bypassed || args.details
      ? { ...(bypassed ?? {}), ...(args.details ?? {}) }
      : undefined;

  const event = await db.overrideEvent.create({
    data: {
      bookingId: args.bookingId,
      actorUserId: args.actorUserId,
      reason: args.reason,
      details: (mergedDetails ?? undefined) as never
    }
  });

  await createAuditEntry({
    actorId: args.actorUserId,
    actorRole: args.actorRole,
    entityType: "booking",
    entityId: args.bookingId,
    action: "admin_override",
    after: {
      reason: args.reason,
      details: mergedDetails ?? null,
    },
  });

  return event;
}
