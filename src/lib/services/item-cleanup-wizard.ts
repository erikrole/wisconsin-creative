import { Prisma, type Role } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createAuditEntry, createAuditEntryTx } from "@/lib/audit";

export const CLEANUP_WIZARD_KINDS = ["legacy_qr", "missing_serial"] as const;
export type CleanupWizardKind = (typeof CLEANUP_WIZARD_KINDS)[number];

export const DEFERRED_CONFIG_KEY = "item_cleanup_wizard_deferred";

/** Cheqroom-era shelf labels that still sit in QR / primary scan fields. */
export const LEGACY_QR_LABEL_PATTERN = /^[A-Z]\d-\d{3,}$/i;

const QUEUE_DEFAULT_LIMIT = 8;

type DeferredEntry = {
  kinds: CleanupWizardKind[];
  reason: string;
  deferredAt: string;
  actorId: string;
};

type DeferredMap = Record<string, DeferredEntry>;

export type CleanupWizardItem = {
  id: string;
  kind: CleanupWizardKind;
  assetTag: string;
  name: string | null;
  brand: string;
  model: string;
  imageUrl: string | null;
  locationName: string | null;
  qrCodeValue: string;
  primaryScanCode: string | null;
  serialNumber: string | null;
  question: string;
  detail: string;
};

function isCleanupKind(value: string): value is CleanupWizardKind {
  return (CLEANUP_WIZARD_KINDS as readonly string[]).includes(value);
}

function parseDeferredMap(value: unknown): DeferredMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: DeferredMap = {};
  for (const [assetId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const kinds = Array.isArray(entry.kinds)
      ? entry.kinds.filter((kind): kind is CleanupWizardKind => typeof kind === "string" && isCleanupKind(kind))
      : [];
    if (kinds.length === 0) continue;
    if (typeof entry.reason !== "string" || typeof entry.deferredAt !== "string" || typeof entry.actorId !== "string") {
      continue;
    }
    out[assetId] = {
      kinds,
      reason: entry.reason,
      deferredAt: entry.deferredAt,
      actorId: entry.actorId,
    };
  }
  return out;
}

async function readDeferredMap(tx: Prisma.TransactionClient | typeof db = db): Promise<DeferredMap> {
  const row = await tx.systemConfig.findUnique({ where: { key: DEFERRED_CONFIG_KEY } });
  return parseDeferredMap(row?.value);
}

function deferredAssetIds(map: DeferredMap, kind: CleanupWizardKind): string[] {
  return Object.entries(map)
    .filter(([, entry]) => entry.kinds.includes(kind))
    .map(([assetId]) => assetId);
}

function questionFor(kind: CleanupWizardKind): string {
  switch (kind) {
    case "legacy_qr":
      return "Is a QR code printed on this item?";
    case "missing_serial":
      return "Can you read a serial number on this item?";
  }
}

function detailFor(
  kind: CleanupWizardKind,
  asset: { qrCodeValue: string; primaryScanCode: string | null; serialNumber: string | null },
): string {
  switch (kind) {
    case "legacy_qr":
      return `Current label in the system: ${asset.primaryScanCode || asset.qrCodeValue}. If a real QR sticker exists, enter that code. If not, defer so this stops resurfacing.`;
    case "missing_serial":
      return "Enter the serial from the physical plate or packaging, or defer when this gear has no readable serial.";
  }
}

function toItem(
  kind: CleanupWizardKind,
  asset: {
    id: string;
    assetTag: string;
    name: string | null;
    brand: string;
    model: string;
    imageUrl: string | null;
    qrCodeValue: string;
    primaryScanCode: string | null;
    serialNumber: string | null;
    location: { name: string } | null;
  },
): CleanupWizardItem {
  return {
    id: asset.id,
    kind,
    assetTag: asset.assetTag,
    name: asset.name,
    brand: asset.brand,
    model: asset.model,
    imageUrl: asset.imageUrl,
    locationName: asset.location?.name ?? null,
    qrCodeValue: asset.qrCodeValue,
    primaryScanCode: asset.primaryScanCode,
    serialNumber: asset.serialNumber,
    question: questionFor(kind),
    detail: detailFor(kind, asset),
  };
}

const assetSelect = {
  id: true,
  assetTag: true,
  name: true,
  brand: true,
  model: true,
  imageUrl: true,
  qrCodeValue: true,
  primaryScanCode: true,
  serialNumber: true,
  location: { select: { name: true } },
} as const;

export async function getCleanupWizardCounts() {
  const deferred = await readDeferredMap();
  const deferredLegacy = deferredAssetIds(deferred, "legacy_qr");
  const deferredSerial = deferredAssetIds(deferred, "missing_serial");

  const assets = await db.asset.findMany({
    where: { status: { not: "RETIRED" } },
    select: {
      id: true,
      qrCodeValue: true,
      primaryScanCode: true,
      serialNumber: true,
    },
  });

  let legacyQr = 0;
  let missingSerial = 0;
  for (const asset of assets) {
    const legacy =
      LEGACY_QR_LABEL_PATTERN.test(asset.qrCodeValue)
      || (asset.primaryScanCode != null && LEGACY_QR_LABEL_PATTERN.test(asset.primaryScanCode));
    if (legacy && !deferredLegacy.includes(asset.id)) legacyQr += 1;
    if (!asset.serialNumber?.trim() && !deferredSerial.includes(asset.id)) missingSerial += 1;
  }

  return {
    legacy_qr: legacyQr,
    missing_serial: missingSerial,
    deferred: {
      legacy_qr: deferredLegacy.length,
      missing_serial: deferredSerial.length,
    },
  };
}

export async function listCleanupWizardQueue(kind: CleanupWizardKind, limit = QUEUE_DEFAULT_LIMIT) {
  const deferred = await readDeferredMap();
  const excluded = deferredAssetIds(deferred, kind);

  if (kind === "legacy_qr") {
    const candidates = await db.asset.findMany({
      where: {
        status: { not: "RETIRED" },
        ...(excluded.length > 0 ? { id: { notIn: excluded } } : {}),
      },
      orderBy: { assetTag: "asc" },
      select: assetSelect,
      take: 200,
    });
    const rows = candidates
      .filter(
        (asset) =>
          LEGACY_QR_LABEL_PATTERN.test(asset.qrCodeValue)
          || (asset.primaryScanCode != null && LEGACY_QR_LABEL_PATTERN.test(asset.primaryScanCode)),
      )
      .slice(0, limit)
      .map((asset) => toItem(kind, asset));
    return rows;
  }

  const rows = await db.asset.findMany({
    where: {
      status: { not: "RETIRED" },
      OR: [{ serialNumber: null }, { serialNumber: "" }],
      ...(excluded.length > 0 ? { id: { notIn: excluded } } : {}),
    },
    orderBy: { assetTag: "asc" },
    take: limit,
    select: assetSelect,
  });
  return rows.map((asset) => toItem(kind, asset));
}

async function assertScanValueAvailable(code: string, assetId: string) {
  const normalized = code.trim();
  if (!normalized) throw new HttpError(400, "Enter a QR or scan code");

  const [assetHits, bulkHits] = await Promise.all([
    db.asset.findMany({
      where: {
        id: { not: assetId },
        OR: [
          { assetTag: { equals: normalized, mode: "insensitive" } },
          { qrCodeValue: { equals: normalized, mode: "insensitive" } },
          { primaryScanCode: { equals: normalized, mode: "insensitive" } },
        ],
      },
      select: { assetTag: true },
      take: 3,
    }),
    db.bulkSku.findMany({
      where: {
        active: true,
        binQrCodeValue: { equals: normalized, mode: "insensitive" },
      },
      select: { name: true },
      take: 3,
    }),
  ]);

  if (assetHits.length > 0 || bulkHits.length > 0) {
    const owners = [
      ...assetHits.map((row) => row.assetTag),
      ...bulkHits.map((row) => row.name),
    ].join(", ");
    throw new HttpError(409, `That scan code is already used by ${owners}`);
  }

  return normalized;
}

export async function applyCleanupWizardQr(args: {
  assetId: string;
  code: string;
  actor: { id: string; role: Role };
}) {
  const code = await assertScanValueAvailable(args.code, args.assetId);

  return db.$transaction(async (tx) => {
    const before = await tx.asset.findUnique({ where: { id: args.assetId } });
    if (!before || before.status === "RETIRED") {
      throw new HttpError(404, "Item not found");
    }

    let updated;
    try {
      updated = await tx.asset.update({
        where: { id: args.assetId },
        data: {
          qrCodeValue: code,
          primaryScanCode: code,
        },
        select: assetSelect,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new HttpError(409, "That scan code is already in use");
      }
      throw err;
    }

    await createAuditEntryTx(tx, {
      actorId: args.actor.id,
      actorRole: args.actor.role,
      entityType: "asset",
      entityId: args.assetId,
      action: "cleanup_wizard_qr",
      before: {
        qrCodeValue: before.qrCodeValue,
        primaryScanCode: before.primaryScanCode,
      },
      after: {
        qrCodeValue: updated.qrCodeValue,
        primaryScanCode: updated.primaryScanCode,
      },
    });

    // Clear any deferral for this kind now that it is fixed.
    const deferred = await readDeferredMap(tx);
    const existing = deferred[args.assetId];
    if (existing) {
      const kinds = existing.kinds.filter((kind) => kind !== "legacy_qr");
      if (kinds.length === 0) delete deferred[args.assetId];
      else deferred[args.assetId] = { ...existing, kinds };
      await tx.systemConfig.upsert({
        where: { key: DEFERRED_CONFIG_KEY },
        create: { key: DEFERRED_CONFIG_KEY, value: deferred },
        update: { value: deferred },
      });
    }

    return toItem("legacy_qr", updated);
  });
}

export async function applyCleanupWizardSerial(args: {
  assetId: string;
  serialNumber: string;
  actor: { id: string; role: Role };
}) {
  const serial = args.serialNumber.trim();
  if (!serial) throw new HttpError(400, "Enter a serial number");

  return db.$transaction(async (tx) => {
    const before = await tx.asset.findUnique({ where: { id: args.assetId } });
    if (!before || before.status === "RETIRED") {
      throw new HttpError(404, "Item not found");
    }

    let updated;
    try {
      updated = await tx.asset.update({
        where: { id: args.assetId },
        data: { serialNumber: serial },
        select: assetSelect,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new HttpError(409, "Serial number already in use by another asset");
      }
      throw err;
    }

    await createAuditEntryTx(tx, {
      actorId: args.actor.id,
      actorRole: args.actor.role,
      entityType: "asset",
      entityId: args.assetId,
      action: "cleanup_wizard_serial",
      before: { serialNumber: before.serialNumber },
      after: { serialNumber: updated.serialNumber },
    });

    const deferred = await readDeferredMap(tx);
    const existing = deferred[args.assetId];
    if (existing) {
      const kinds = existing.kinds.filter((kind) => kind !== "missing_serial");
      if (kinds.length === 0) delete deferred[args.assetId];
      else deferred[args.assetId] = { ...existing, kinds };
      await tx.systemConfig.upsert({
        where: { key: DEFERRED_CONFIG_KEY },
        create: { key: DEFERRED_CONFIG_KEY, value: deferred },
        update: { value: deferred },
      });
    }

    return toItem("missing_serial", updated);
  });
}

export async function deferCleanupWizardItem(args: {
  assetId: string;
  kind: CleanupWizardKind;
  reason: "no_printed_qr" | "no_serial" | "needs_shelf_check" | "other";
  actor: { id: string; role: Role };
}) {
  const before = await db.asset.findUnique({
    where: { id: args.assetId },
    select: { id: true, assetTag: true, status: true },
  });
  if (!before || before.status === "RETIRED") {
    throw new HttpError(404, "Item not found");
  }

  const deferred = await readDeferredMap();
  const existing = deferred[args.assetId];
  const kinds = new Set(existing?.kinds ?? []);
  kinds.add(args.kind);
  deferred[args.assetId] = {
    kinds: [...kinds],
    reason: args.reason,
    deferredAt: new Date().toISOString(),
    actorId: args.actor.id,
  };

  await db.systemConfig.upsert({
    where: { key: DEFERRED_CONFIG_KEY },
    create: { key: DEFERRED_CONFIG_KEY, value: deferred },
    update: { value: deferred },
  });

  await createAuditEntry({
    actorId: args.actor.id,
    actorRole: args.actor.role,
    entityType: "asset",
    entityId: args.assetId,
    action: "cleanup_wizard_deferred",
    after: {
      kind: args.kind,
      reason: args.reason,
      assetTag: before.assetTag,
    },
  });

  return { success: true as const, assetId: args.assetId, kind: args.kind, reason: args.reason };
}

export function parseCleanupWizardKind(value: unknown): CleanupWizardKind {
  if (typeof value !== "string" || !isCleanupKind(value)) {
    throw new HttpError(400, "Unknown cleanup queue");
  }
  return value;
}
