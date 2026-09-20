import { withAuth } from "@/lib/api";
import { randomHex } from "@/lib/crypto";
import { generateAssetQrCode } from "@/lib/asset-qr-code";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { buildAssetTagSortFields } from "@/lib/item-asset-tag-sort";
import { Prisma } from "@prisma/client";

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "asset", "duplicate");

  const { id } = params;
  const source = await db.asset.findUnique({ where: { id } });
  if (!source) throw new HttpError(404, "Asset not found");

  // Retry on P2002 collision (tag/serial/QR uniqueness)
  let duplicate;
  let attempts = 0;
  let newTag = "";
  while (attempts < 5) {
    const suffix = randomHex(4).toUpperCase();
    newTag = `${source.assetTag}-COPY-${suffix}`;
    const newSerial = source.serialNumber ? `${source.serialNumber}-COPY-${suffix}` : null;
    const newQr = generateAssetQrCode();

    try {
      duplicate = await db.asset.create({
        data: {
          ...buildAssetTagSortFields(newTag),
          name: source.name,
          type: source.type,
          brand: source.brand,
          model: source.model,
          serialNumber: newSerial,
          qrCodeValue: newQr,
          purchaseDate: source.purchaseDate,
          purchasePrice: source.purchasePrice,
          warrantyDate: source.warrantyDate,
          residualValue: source.residualValue,
          locationId: source.locationId,
          departmentId: source.departmentId,
          categoryId: source.categoryId,
          status: "AVAILABLE",
          consumable: source.consumable,
          imageUrl: source.imageUrl,
          notes: source.notes,
          linkUrl: source.linkUrl,
          availableForReservation: source.availableForReservation,
          availableForCheckout: source.availableForCheckout,
          availableForCustody: source.availableForCustody,
        },
        include: { location: true, category: true },
      });
      break;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        attempts++;
        continue;
      }
      throw err;
    }
  }

  if (!duplicate) {
    throw new HttpError(409, "Failed to generate unique asset tag for duplicate");
  }

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "asset",
    entityId: duplicate.id,
    action: "duplicated",
    after: { sourceId: id, assetTag: newTag },
  });

  return ok({ data: duplicate }, 201);
});
