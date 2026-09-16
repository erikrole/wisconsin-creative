import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const QR_PREFIX = /^bg:\/\/item\/(.+)$/;

export type AssetSelect = Prisma.AssetSelect;

type AssetLookupClient = {
  asset: {
    findUnique: typeof db.asset.findUnique;
    findFirst: typeof db.asset.findFirst;
  };
};

export async function findAssetByScanValue<S extends AssetSelect>(
  scanValue: string,
  select: S,
  client: AssetLookupClient = db,
): Promise<Prisma.AssetGetPayload<{ select: S }> | null> {
  const trimmed = scanValue.trim();
  const qrMatch = trimmed.match(QR_PREFIX);

  if (qrMatch) {
    return client.asset.findUnique({
      where: { id: qrMatch[1] },
      select,
    }) as Promise<Prisma.AssetGetPayload<{ select: S }> | null>;
  }

  return client.asset.findFirst({
    where: {
      OR: [
        { assetTag: { equals: trimmed, mode: "insensitive" } },
        { primaryScanCode: { equals: trimmed, mode: "insensitive" } },
        { primaryScanCode: { equals: `qr-${trimmed}`, mode: "insensitive" } },
        { qrCodeValue: { equals: trimmed, mode: "insensitive" } },
        { qrCodeValue: { equals: `qr-${trimmed}`, mode: "insensitive" } },
        { serialNumber: { equals: trimmed, mode: "insensitive" } },
      ],
    },
    select,
  }) as Promise<Prisma.AssetGetPayload<{ select: S }> | null>;
}
