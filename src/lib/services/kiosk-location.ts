import type { Prisma } from "@prisma/client";

export type KioskLocationEvidence = {
  locationMismatch: boolean;
  expectedLocationId: string | null;
  actualLocationId: string | null;
  expectedLocationName?: string | null;
  actualLocationName?: string | null;
  message?: string;
};

function locationEvidenceMessage(evidence: KioskLocationEvidence) {
  if (!evidence.locationMismatch) return undefined;
  const expected = evidence.expectedLocationName ?? "this kiosk";
  const actual = evidence.actualLocationName ?? "no saved location";
  return `Location mismatch: expected ${expected}, was ${actual}. Updated to this kiosk.`;
}

export async function assetLocationEvidence(
  tx: Prisma.TransactionClient,
  args: {
    assetId: string;
    expectedLocationId: string;
  },
): Promise<KioskLocationEvidence> {
  const asset = await tx.asset.findUnique({
    where: { id: args.assetId },
    select: {
      locationId: true,
      location: { select: { name: true } },
    },
  });
  const expected = await tx.location.findUnique({
    where: { id: args.expectedLocationId },
    select: { name: true },
  });

  const evidence: KioskLocationEvidence = {
    locationMismatch: asset?.locationId !== args.expectedLocationId,
    expectedLocationId: args.expectedLocationId,
    actualLocationId: asset?.locationId ?? null,
    expectedLocationName: expected?.name ?? null,
    actualLocationName: asset?.location?.name ?? null,
  };
  evidence.message = locationEvidenceMessage(evidence);
  return evidence;
}

export async function reconcileAssetLocationToKiosk(
  tx: Prisma.TransactionClient,
  args: {
    assetId: string;
    kioskLocationId: string;
  },
) {
  await tx.asset.update({
    where: { id: args.assetId },
    data: { locationId: args.kioskLocationId },
  });
}

export function locationEvidencePayload(evidence: KioskLocationEvidence) {
  return {
    locationMismatch: evidence.locationMismatch,
    expectedLocationId: evidence.expectedLocationId,
    actualLocationId: evidence.actualLocationId,
    expectedLocationName: evidence.expectedLocationName ?? null,
    actualLocationName: evidence.actualLocationName ?? null,
    locationMessage: evidence.message,
  };
}
