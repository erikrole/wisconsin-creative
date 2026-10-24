import { SignatureArtifactState, SignatureSaveStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { SIGNATURE_CREATIVE_STAFF_SPORT_CODE } from "@/lib/signatures/types";
import { getPrivateSignatureArtifact } from "@/lib/signatures/storage";
import {
  createStoredZip,
  type SignatureZipFormat,
  type StoredZipEntry,
} from "@/lib/signatures/zip";
import {
  SIGNATURE_ZIP_MAX_ENTRIES,
  SIGNATURE_ZIP_MAX_BYTES,
  SIGNATURE_ZIP_READ_CONCURRENCY,
  visibleSignatureMembers,
  cleanupSignatureRevisions,
} from "./signatures-shared";

export async function getReadySignatureArtifact(revisionId: string, kind: "png" | "svg") {
  const revision = await db.signatureArtifactRevision.findUnique({
    where: { id: revisionId },
    include: { capture: { include: { member: true } } },
  });
  if (!revision || revision.state !== SignatureArtifactState.READY) {
    throw new HttpError(404, "Signature artifact not found");
  }
  return {
    path: kind === "png" ? revision.pngPath : revision.svgPath,
    contentType: kind === "png" ? "image/png" : "image/svg+xml",
    filename: signatureArtifactFilename(
      revision.capture.member.name,
      kind,
      revision.capture.member.jerseyNumber,
      revision.capture.currentRevisionId === revision.id ? undefined : revision.revision,
    ),
  };
}

export function signatureArtifactFilename(name: string, kind: "png" | "svg", jerseyNumber: number | null = null, revision?: number) {
  const signer = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");
  const prefix = jerseyNumber === null || jerseyNumber === undefined ? "" : `${jerseyNumber}_`;
  const version = revision === undefined ? "" : `_v${revision}`;
  return `${prefix}${signer || "signature"}${version}.${kind}`;
}

function signatureCollectionArchiveFilename(sportCode: string, season: string, format: SignatureZipFormat) {
  const name = `${sportCode}-${season}-signatures`
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${name || "signatures"}-${format}.zip`;
}

function uniqueSignatureFilename(name: string, jerseyNumber: number | null, format: SignatureZipFormat, usedNames: Set<string>) {
  const initial = signatureArtifactFilename(name, format, jerseyNumber);
  if (!usedNames.has(initial.toLowerCase())) {
    usedNames.add(initial.toLowerCase());
    return initial;
  }
  const stem = initial.slice(0, -(format.length + 1));
  let suffix = 2;
  let candidate = `${stem}_${suffix}.${format}`;
  while (usedNames.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = `${stem}_${suffix}.${format}`;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

async function readSignatureZipEntry(entry: { name: string; path: string }, reserveBytes: (bytes: number) => void): Promise<StoredZipEntry> {
  const blob = await getPrivateSignatureArtifact(entry.path);
  if (!blob) throw new HttpError(503, "A committed signature file is temporarily unavailable; try again shortly");
  const reader = blob.stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      reserveBytes(value.byteLength);
      chunks.push(value);
    }
    return { name: entry.name, data: Buffer.concat(chunks) };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function getSignatureCollectionZip(collectionId: string, format: SignatureZipFormat = "svg") {
  const collection = await db.signatureCollection.findUnique({
    where: { id: collectionId },
    select: {
      sportCode: true,
      season: true,
      members: {
        where: { active: true },
        orderBy: { name: "asc" },
        select: {
          name: true,
          jerseyNumber: true,
          roleGroup: true,
          linkedUserId: true,
          capture: {
            select: {
              currentRevision: { select: { state: true, pngPath: true, svgPath: true } },
            },
          },
        },
      },
    },
  });
  if (!collection) throw new HttpError(404, "Signature collection not found");

  const members = visibleSignatureMembers(collection.sportCode, collection.members);
  const linkedUserIds = [...new Set(members.map((member) => member.linkedUserId).filter((id): id is string => Boolean(id)))];
  const canonicalCaptures = linkedUserIds.length === 0 ? [] : await db.signatureCapture.findMany({
    where: {
      collection: { sportCode: SIGNATURE_CREATIVE_STAFF_SPORT_CODE, season: collection.season },
      member: { active: true, linkedUserId: { in: linkedUserIds } },
    },
    select: {
      member: { select: { linkedUserId: true } },
      currentRevision: { select: { state: true, pngPath: true, svgPath: true } },
    },
  });
  const canonicalByUserId = new Map(canonicalCaptures
    .filter((capture) => capture.member.linkedUserId)
    .map((capture) => [capture.member.linkedUserId as string, capture.currentRevision]));

  const usedNames = new Set<string>();
  const fileEntries = members
    .map((member) => {
      const revision = member.linkedUserId && canonicalByUserId.has(member.linkedUserId)
        ? canonicalByUserId.get(member.linkedUserId)
        : member.capture?.currentRevision;
      if (!revision || revision.state !== SignatureArtifactState.READY) return null;
      return {
        name: uniqueSignatureFilename(member.name, member.jerseyNumber, format, usedNames),
        path: format === "png" ? revision.pngPath : revision.svgPath,
      };
    })
    .filter((entry): entry is { name: string; path: string } => entry !== null);

  if (fileEntries.length === 0) throw new HttpError(404, `No committed ${format.toUpperCase()} signatures are available for this roster`);
  if (fileEntries.length > SIGNATURE_ZIP_MAX_ENTRIES) throw new HttpError(413, "This roster is too large to export as one ZIP");

  const zipEntries: StoredZipEntry[] = new Array(fileEntries.length);
  let nextIndex = 0;
  let totalBytes = 0;
  let failed = false;
  const reserveBytes = (bytes: number) => {
    totalBytes += bytes;
    if (totalBytes > SIGNATURE_ZIP_MAX_BYTES) {
      failed = true;
      throw new HttpError(413, "The signature export is too large to download as one ZIP");
    }
  };
  const worker = async () => {
    while (!failed) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= fileEntries.length) return;
      const entry = fileEntries[index];
      if (!entry) return;
      try {
        zipEntries[index] = await readSignatureZipEntry(entry, reserveBytes);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SIGNATURE_ZIP_READ_CONCURRENCY, fileEntries.length) }, () => worker()));

  return {
    filename: signatureCollectionArchiveFilename(collection.sportCode, collection.season, format),
    body: createStoredZip(zipEntries),
    fileCount: zipEntries.length,
  };
}

export async function cleanupPendingSignatureArtifacts(limit = 50) {
  const abandoned = await db.signatureSaveOperation.updateMany({
    where: {
      status: { in: [SignatureSaveStatus.UPLOADING, SignatureSaveStatus.FINALIZING] },
      updatedAt: { lte: new Date(Date.now() - 15 * 60_000) },
    },
    data: { status: SignatureSaveStatus.FAILED, errorMessage: "Signature save timed out before completion" },
  });
  const revisions = await db.signatureArtifactRevision.findMany({
    where: {
      state: SignatureArtifactState.PENDING_DELETE,
      // A COMMITTED operation remains as history after explicit erasure.
      // PENDING_DELETE is authoritative; only live uploaders still own files.
      saveOperations: { none: { status: { in: [SignatureSaveStatus.UPLOADING, SignatureSaveStatus.FINALIZING] } } },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, pngPath: true, svgPath: true },
  });
  const cleanup = await cleanupSignatureRevisions(revisions);
  return { abandoned: abandoned.count, attempted: revisions.length, deleted: cleanup.cleaned };
}
