import { Prisma, type Role } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createAuditEntry, createAuditEntryTx } from "@/lib/audit";

export const CLEANUP_WIZARD_KINDS = ["legacy_qr", "missing_serial", "attachment_candidate"] as const;
export type CleanupWizardKind = (typeof CLEANUP_WIZARD_KINDS)[number];

export const DEFERRED_CONFIG_KEY = "item_cleanup_wizard_deferred";

/** Cheqroom-era shelf labels that still sit in QR / primary scan fields. */
export const LEGACY_QR_LABEL_PATTERN = /^[A-Z]\d-\d{3,}$/i;

/** Terms that mark a standalone row as a likely married accessory (matches cleanup script). */
export const ATTACHMENT_CANDIDATE_TERMS = [
  "handle",
  "cage",
  "top plate",
  "baseplate",
  "lens cap",
  "grip",
] as const;

const ATTACHMENT_SUFFIX_PATTERN = /\s+(handle|cage|top plate|baseplate|lens cap|grip)$/i;

const QUEUE_DEFAULT_LIMIT = 8;
const PARENT_SUGGESTION_LIMIT = 8;

type DeferredEntry = {
  kinds: CleanupWizardKind[];
  reason: string;
  deferredAt: string;
  actorId: string;
};

type DeferredMap = Record<string, DeferredEntry>;

export type CleanupWizardParentSuggestion = {
  id: string;
  assetTag: string;
  brand: string;
  model: string;
  reason: string;
};

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
  suggestedParents?: CleanupWizardParentSuggestion[];
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

function searchableText(asset: {
  assetTag: string;
  name: string | null;
  brand: string;
  model: string;
  type?: string | null;
}): string {
  return [asset.assetTag, asset.name, asset.brand, asset.model, asset.type]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function isAttachmentCandidateText(text: string): boolean {
  const normalized = text.toLowerCase();
  return ATTACHMENT_CANDIDATE_TERMS.some((term) => normalized.includes(term));
}

export function stripAccessoryParentTag(assetTag: string): string | null {
  const stripped = assetTag.trim().replace(ATTACHMENT_SUFFIX_PATTERN, "").trim();
  if (!stripped || stripped.toLowerCase() === assetTag.trim().toLowerCase()) return null;
  return stripped;
}

function extractFilterMm(text: string): string | null {
  const match = text.match(/(\d{2,3})\s*mm/i);
  return match?.[1] ?? null;
}

function questionFor(kind: CleanupWizardKind): string {
  switch (kind) {
    case "legacy_qr":
      return "Is a QR code printed on this item?";
    case "missing_serial":
      return "Can you read a serial number on this item?";
    case "attachment_candidate":
      return "Does this accessory stay married to a specific parent item?";
  }
}

function detailFor(
  kind: CleanupWizardKind,
  asset: { qrCodeValue: string; primaryScanCode: string | null; serialNumber: string | null; assetTag: string },
): string {
  switch (kind) {
    case "legacy_qr":
      return `Current label in the system: ${asset.primaryScanCode || asset.qrCodeValue}. If a real QR sticker exists, enter that code. If not, defer so this stops resurfacing.`;
    case "missing_serial":
      return "Enter the serial from the physical plate or packaging, or defer when this gear has no readable serial.";
    case "attachment_candidate":
      return `Pick the parent this travels with (checkout, reservation, and custody turn off on ${asset.assetTag}), or keep it standalone when staff checks it out on its own.`;
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
  suggestedParents?: CleanupWizardParentSuggestion[],
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
    ...(suggestedParents ? { suggestedParents } : {}),
  };
}

const assetSelect = {
  id: true,
  assetTag: true,
  name: true,
  brand: true,
  model: true,
  type: true,
  imageUrl: true,
  qrCodeValue: true,
  primaryScanCode: true,
  serialNumber: true,
  location: { select: { name: true } },
} as const;

async function clearDeferralKind(
  tx: Prisma.TransactionClient,
  assetId: string,
  kind: CleanupWizardKind,
) {
  const deferred = await readDeferredMap(tx);
  const existing = deferred[assetId];
  if (!existing) return;
  const kinds = existing.kinds.filter((entry) => entry !== kind);
  if (kinds.length === 0) delete deferred[assetId];
  else deferred[assetId] = { ...existing, kinds };
  await tx.systemConfig.upsert({
    where: { key: DEFERRED_CONFIG_KEY },
    create: { key: DEFERRED_CONFIG_KEY, value: deferred },
    update: { value: deferred },
  });
}

function rankParentPool(
  child: { id: string; assetTag: string; name: string | null; brand: string; model: string; type?: string | null },
  pool: Array<{ id: string; assetTag: string; brand: string; model: string; name: string | null; type: string | null }>,
): CleanupWizardParentSuggestion[] {
  const childText = searchableText(child);
  const exactTag = stripAccessoryParentTag(child.assetTag);
  const filterMm = extractFilterMm(childText);
  const wantsLens = childText.includes("lens cap") || childText.includes("front cap") || childText.includes("rear cap");
  const wantsCamera =
    childText.includes("cage")
    || childText.includes("plate")
    || childText.includes("baseplate")
    || childText.includes("handle")
    || childText.includes("grip");

  const suggestions: CleanupWizardParentSuggestion[] = [];
  const seen = new Set<string>();

  const push = (parent: { id: string; assetTag: string; brand: string; model: string }, reason: string) => {
    if (parent.id === child.id || seen.has(parent.id)) return;
    seen.add(parent.id);
    suggestions.push({
      id: parent.id,
      assetTag: parent.assetTag,
      brand: parent.brand,
      model: parent.model,
      reason,
    });
  };

  if (exactTag) {
    const exact = pool.find((row) => row.assetTag.toLowerCase() === exactTag.toLowerCase());
    if (exact) push(exact, "Exact tag prefix match");
  }

  for (const parent of pool) {
    if (suggestions.length >= PARENT_SUGGESTION_LIMIT) break;
    if (isAttachmentCandidateText(searchableText(parent))) continue;
    const parentText = searchableText(parent);

    if (wantsLens) {
      if (!parentText.includes("lens")) continue;
      if (filterMm && parentText.includes(`${filterMm}mm`)) {
        push(parent, `Matching ${filterMm}mm lens`);
      } else if (!filterMm) {
        push(parent, "Lens candidate");
      }
      continue;
    }

    if (wantsCamera) {
      const looksLikeBody =
        /\b(fx3|fx3a|a7|a1|a9|camera|body)\b/i.test(parentText)
        || parent.type?.toLowerCase().includes("camera");
      if (!looksLikeBody) continue;
      push(parent, "Camera body candidate");
    }
  }

  return suggestions.slice(0, PARENT_SUGGESTION_LIMIT);
}

async function buildAttachmentSuggestions(
  children: Array<{
    id: string;
    assetTag: string;
    name: string | null;
    brand: string;
    model: string;
    type: string | null;
  }>,
): Promise<Map<string, CleanupWizardParentSuggestion[]>> {
  const parentPool = await db.asset.findMany({
    where: {
      status: { not: "RETIRED" },
      parentAssetId: null,
    },
    select: {
      id: true,
      assetTag: true,
      brand: true,
      model: true,
      name: true,
      type: true,
    },
    orderBy: { assetTag: "asc" },
    take: 500,
  });

  const map = new Map<string, CleanupWizardParentSuggestion[]>();
  for (const child of children) {
    map.set(child.id, rankParentPool(child, parentPool));
  }
  return map;
}

export async function getCleanupWizardCounts() {
  const deferred = await readDeferredMap();
  const deferredLegacy = deferredAssetIds(deferred, "legacy_qr");
  const deferredSerial = deferredAssetIds(deferred, "missing_serial");
  const deferredAttachment = deferredAssetIds(deferred, "attachment_candidate");

  const assets = await db.asset.findMany({
    where: { status: { not: "RETIRED" } },
    select: {
      id: true,
      assetTag: true,
      name: true,
      brand: true,
      model: true,
      type: true,
      qrCodeValue: true,
      primaryScanCode: true,
      serialNumber: true,
      parentAssetId: true,
    },
  });

  let legacyQr = 0;
  let missingSerial = 0;
  let attachmentCandidate = 0;
  for (const asset of assets) {
    const legacy =
      LEGACY_QR_LABEL_PATTERN.test(asset.qrCodeValue)
      || (asset.primaryScanCode != null && LEGACY_QR_LABEL_PATTERN.test(asset.primaryScanCode));
    if (legacy && !deferredLegacy.includes(asset.id)) legacyQr += 1;
    if (!asset.serialNumber?.trim() && !deferredSerial.includes(asset.id)) missingSerial += 1;
    if (
      !asset.parentAssetId
      && isAttachmentCandidateText(searchableText(asset))
      && !deferredAttachment.includes(asset.id)
    ) {
      attachmentCandidate += 1;
    }
  }

  return {
    legacy_qr: legacyQr,
    missing_serial: missingSerial,
    attachment_candidate: attachmentCandidate,
    deferred: {
      legacy_qr: deferredLegacy.length,
      missing_serial: deferredSerial.length,
      attachment_candidate: deferredAttachment.length,
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
    return candidates
      .filter(
        (asset) =>
          LEGACY_QR_LABEL_PATTERN.test(asset.qrCodeValue)
          || (asset.primaryScanCode != null && LEGACY_QR_LABEL_PATTERN.test(asset.primaryScanCode)),
      )
      .slice(0, limit)
      .map((asset) => toItem(kind, asset));
  }

  if (kind === "attachment_candidate") {
    const candidates = await db.asset.findMany({
      where: {
        status: { not: "RETIRED" },
        parentAssetId: null,
        ...(excluded.length > 0 ? { id: { notIn: excluded } } : {}),
      },
      orderBy: { assetTag: "asc" },
      select: assetSelect,
      take: 200,
    });
    const rows = candidates
      .filter((asset) => isAttachmentCandidateText(searchableText(asset)))
      .slice(0, limit);
    const suggestions = await buildAttachmentSuggestions(rows);
    return rows.map((asset) => toItem(kind, asset, suggestions.get(asset.id) ?? []));
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

    await clearDeferralKind(tx, args.assetId, "legacy_qr");
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

    await clearDeferralKind(tx, args.assetId, "missing_serial");
    return toItem("missing_serial", updated);
  });
}

export async function applyCleanupWizardAttach(args: {
  assetId: string;
  parentAssetId: string;
  actor: { id: string; role: Role };
}) {
  if (args.assetId === args.parentAssetId) {
    throw new HttpError(400, "Cannot attach an item to itself");
  }

  return db.$transaction(async (tx) => {
    const [child, parent, activeCustody] = await Promise.all([
      tx.asset.findUnique({
        where: { id: args.assetId },
        select: {
          id: true,
          status: true,
          parentAssetId: true,
          assetTag: true,
          availableForCheckout: true,
          availableForReservation: true,
          availableForCustody: true,
          name: true,
          brand: true,
          model: true,
          type: true,
          imageUrl: true,
          qrCodeValue: true,
          primaryScanCode: true,
          serialNumber: true,
          location: { select: { name: true } },
        },
      }),
      tx.asset.findUnique({
        where: { id: args.parentAssetId },
        select: {
          id: true,
          status: true,
          parentAssetId: true,
          assetTag: true,
        },
      }),
      tx.assetAllocation.findFirst({
        where: { assetId: args.assetId, active: true },
        select: { id: true, bookingId: true },
      }),
    ]);

    if (!child || child.status === "RETIRED") throw new HttpError(404, "Item not found");
    if (!parent || parent.status === "RETIRED") throw new HttpError(404, "Parent item not found");
    if (parent.parentAssetId) throw new HttpError(400, "Cannot attach accessories to a child item");
    if (child.parentAssetId) {
      throw new HttpError(409, "This item is already an accessory of another item. Detach it first.");
    }
    if (activeCustody) {
      throw new HttpError(409, "This item has active custody. Return it before attaching.");
    }

    const updated = await tx.asset.update({
      where: { id: args.assetId },
      data: {
        parentAssetId: args.parentAssetId,
        availableForCheckout: false,
        availableForReservation: false,
        availableForCustody: false,
      },
      select: assetSelect,
    });

    await createAuditEntryTx(tx, {
      actorId: args.actor.id,
      actorRole: args.actor.role,
      entityType: "asset",
      entityId: args.assetId,
      action: "cleanup_wizard_attach",
      before: {
        parentAssetId: child.parentAssetId,
        availableForCheckout: child.availableForCheckout,
        availableForReservation: child.availableForReservation,
        availableForCustody: child.availableForCustody,
      },
      after: {
        parentAssetId: args.parentAssetId,
        parentAssetTag: parent.assetTag,
        availableForCheckout: false,
        availableForReservation: false,
        availableForCustody: false,
      },
    });

    await clearDeferralKind(tx, args.assetId, "attachment_candidate");
    return toItem("attachment_candidate", updated, []);
  });
}

export async function deferCleanupWizardItem(args: {
  assetId: string;
  kind: CleanupWizardKind;
  reason: "no_printed_qr" | "no_serial" | "keep_standalone" | "needs_shelf_check" | "other";
  actor: { id: string; role: Role };
}) {
  const before = await db.asset.findUnique({
    where: { id: args.assetId },
    select: { id: true, assetTag: true, status: true },
  });
  if (!before || before.status === "RETIRED") {
    throw new HttpError(404, "Item not found");
  }

  if (args.kind === "attachment_candidate" && args.reason !== "keep_standalone" && args.reason !== "needs_shelf_check" && args.reason !== "other") {
    throw new HttpError(400, "Use keep_standalone when this accessory stays independent");
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
