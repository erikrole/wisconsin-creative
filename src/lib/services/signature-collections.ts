import {
  Prisma,
  SignatureArtifactState,
  SignatureCollectionStatus,
  SignatureMemberGroup,
  SignatureSaveStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { HttpError } from "@/lib/http";
import { withSerializationRetry } from "@/lib/serialization";
import {
  SIGNATURE_CREATIVE_STAFF_SPORT_CODE,
  isStandaloneStaffSignatureCollection,
  penSettingsSchema,
  signatureRosterEntrySchema,
} from "@/lib/signatures/types";
import { compareSignatureRosterMembers } from "@/lib/signatures/roster";
import {
  SIGNATURE_DETAIL_PRIOR_REVISION_LIMIT,
  publicArtifact,
  collectionCompleteness,
  collectionInclude,
  canonicalDetailCaptureInclude,
  visibleSignatureMembers,
  isTeamSignatureCollection,
  primarySignatureMembers,
  staffSignatureMembers,
  cleanupSignatureRevisions,
  Actor,
  PublicSignatureArtifact,
  CanonicalSignatureDetailCapture,
} from "./signatures-shared";

export async function listSignatureCollections(options: { includeArchived?: boolean } = {}) {
  const collections = await db.signatureCollection.findMany({
    where: options.includeArchived ? undefined : { status: SignatureCollectionStatus.OPEN },
    orderBy: [{ status: "asc" }, { season: "desc" }],
    include: {
      _count: { select: { captures: { where: { revisions: { some: { state: { not: SignatureArtifactState.DELETED } } } } } } },
      members: { select: { id: true, active: true, required: true, roleGroup: true, linkedUserId: true } },
      captures: {
        where: {
          currentRevision: { is: { state: SignatureArtifactState.READY } },
          member: { active: true },
        },
        select: { memberId: true },
      },
    },
  });

  const linkedUserIds = [...new Set(collections.flatMap((collection) => collection.members
    .map((member) => member.linkedUserId)
    .filter((id): id is string => Boolean(id))))];
  const seasons = [...new Set(collections.map((collection) => collection.season))];
  const canonicalCaptures = linkedUserIds.length === 0 || seasons.length === 0 ? [] : await db.signatureCapture.findMany({
    where: {
      collection: { sportCode: SIGNATURE_CREATIVE_STAFF_SPORT_CODE, season: { in: seasons } },
      member: { active: true, linkedUserId: { in: linkedUserIds } },
    },
    select: {
      collection: { select: { season: true } },
      member: { select: { linkedUserId: true } },
      currentRevision: { select: { state: true } },
    },
  });
  const canonicalReadiness = new Map(canonicalCaptures
    .filter((capture) => capture.member.linkedUserId)
    .map((capture) => [`${capture.collection.season}:${capture.member.linkedUserId}`, capture.currentRevision?.state === SignatureArtifactState.READY]));

  return collections.map((collection) => {
    const members = visibleSignatureMembers(collection.sportCode, collection.members);
    const readyMemberIds = new Set(collection.captures.map((capture) => capture.memberId));
    const hasReadyArtifact = (member: typeof members[number]) => {
      const canonicalKey = `${collection.season}:${member.linkedUserId}`;
      return member.linkedUserId && canonicalReadiness.has(canonicalKey)
        ? canonicalReadiness.get(canonicalKey) === true
        : readyMemberIds.has(member.id);
    };
    const primaryMembers = primarySignatureMembers(collection.sportCode, members);
    const staffMembers = staffSignatureMembers(collection.sportCode, members);
    const completeness = collectionCompleteness(
      primaryMembers.map((member) => ({ active: member.active, artifactReady: hasReadyArtifact(member) })),
      isStandaloneStaffSignatureCollection(collection.sportCode) && members.every((member) => !member.active) ? 0 : 100,
    );
    return {
      id: collection.id,
      sportCode: collection.sportCode,
      season: collection.season,
      status: collection.status,
      collectionVersion: collection.collectionVersion,
      settingsVersion: collection.settingsVersion,
      activeMemberCount: members.filter((member) => member.active).length,
      completeness,
      staffCompleteness: {
        complete: staffMembers.filter(hasReadyArtifact).length,
        total: staffMembers.length,
      },
      downloadableCount: members.filter((member) => member.active && hasReadyArtifact(member)).length,
      hasRetainedSignatures: collection._count.captures > 0,
      updatedAt: collection.updatedAt.toISOString(),
    };
  });
}

export async function getSignatureCollection(collectionId: string) {
  const collection = await db.signatureCollection.findUnique({
    where: { id: collectionId },
    include: collectionInclude,
  });
  if (!collection) throw new HttpError(404, "Signature collection not found");
  const linkedUserIds = [...new Set(collection.members.map((member) => member.linkedUserId).filter((id): id is string => Boolean(id)))];
  const canonicalCaptures = linkedUserIds.length === 0 ? [] : await db.signatureCapture.findMany({
    where: {
      collection: { sportCode: SIGNATURE_CREATIVE_STAFF_SPORT_CODE, season: collection.season },
      member: { active: true, linkedUserId: { in: linkedUserIds } },
    },
    include: canonicalDetailCaptureInclude,
  });
  const canonicalByUserId = new Map(canonicalCaptures
    .filter((capture) => capture.member.linkedUserId)
    .map((capture) => [capture.member.linkedUserId as string, capture]));
  // Erased or failed revisions are not READY, so the detail counts above miss
  // them; Move signature must still refuse a target that has any history.
  const nonReadyHistory = await db.signatureArtifactRevision.findMany({
    where: { capture: { collectionId: collection.id }, state: { not: SignatureArtifactState.READY } },
    select: { captureId: true },
    distinct: ["captureId"],
  });
  return serializeSignatureCollection(collection, canonicalByUserId, new Set(nonReadyHistory.map((revision) => revision.captureId)));
}

function serializeSignatureCollection(
  collection: Prisma.SignatureCollectionGetPayload<{ include: typeof collectionInclude }>,
  canonicalByUserId: Map<string, CanonicalSignatureDetailCapture>,
  capturesWithNonReadyHistory: Set<string> = new Set(),
) {
  const members = visibleSignatureMembers(collection.sportCode, collection.members);
  const sourceOrderByExternalId = new Map<string, number>();
  const latestSnapshotEntries = signatureRosterEntrySchema.array().safeParse(collection.snapshots[0]?.entries);
  if (latestSnapshotEntries.success) {
    latestSnapshotEntries.data.forEach((entry, index) => sourceOrderByExternalId.set(entry.sourceExternalId, index));
  }

  const serializedMembers = [...members]
    .map((member) => {
      const canonicalCapture = member.linkedUserId ? canonicalByUserId.get(member.linkedUserId) : undefined;
      const capture = canonicalCapture ?? member.capture;
      const captureSettings = canonicalCapture
        ? penSettingsSchema.parse(canonicalCapture.collection.penSettings)
        : penSettingsSchema.parse(collection.penSettings);
      const artifact = capture?.currentRevision ? publicArtifact(capture.currentRevision) : null;
      const priorRevisions = capture?.revisions
        .map((revision) => publicArtifact(revision))
        .filter((revision): revision is PublicSignatureArtifact => revision !== null && revision.id !== artifact?.id)
        .slice(0, SIGNATURE_DETAIL_PRIOR_REVISION_LIMIT) ?? [];
      const revisions = artifact
        ? [artifact, ...priorRevisions].sort((left, right) => right.revision - left.revision)
        : priorRevisions;
      const revisionCount = capture?._count.revisions ?? 0;
      return {
        id: member.id,
        name: member.name,
        jerseyNumber: member.jerseyNumber,
        title: member.title,
        roleGroup: member.roleGroup,
        sourceOrder: sourceOrderByExternalId.get(member.sourceExternalId) ?? null,
        required: member.required,
        active: member.active,
        // Mirrors moveSignatureCapture's target rules so the picker never offers a 409.
        canReceiveMovedSignature: member.active
          && !member.linkedUserId
          && (!member.capture || (
            !member.capture.currentRevisionId
            && member.capture._count.revisions === 0
            && member.capture._count.saveOperations === 0
            && !capturesWithNonReadyHistory.has(member.capture.id)
          )),
        // Added by staff rather than imported from the official source roster.
        unofficial: isTeamSignatureCollection(collection.sportCode) && member.roleGroup === SignatureMemberGroup.PLAYER && member.sourceSnapshotId === null,
        linkedUserId: member.linkedUserId,
        captureVersion: capture?.captureVersion ?? 0,
        settingsVersion: capture?.settingsVersion ?? collection.settingsVersion,
        captureSettings,
        artifact,
        revisions,
        revisionCount,
        revisionHistoryTruncated: revisionCount > revisions.length,
      };
    })
    .sort(compareSignatureRosterMembers);
  const primaryMembers = primarySignatureMembers(collection.sportCode, serializedMembers);
  const staffMembers = staffSignatureMembers(collection.sportCode, serializedMembers);
  const completeness = collectionCompleteness(
    primaryMembers.map((member) => ({ active: member.active, artifactReady: Boolean(member.artifact) })),
    isStandaloneStaffSignatureCollection(collection.sportCode) && !serializedMembers.some((member) => member.active) ? 0 : 100,
  );

  return {
    id: collection.id,
    sportCode: collection.sportCode,
    season: collection.season,
    status: collection.status,
    collectionVersion: collection.collectionVersion,
    settingsVersion: collection.settingsVersion,
    penSettings: penSettingsSchema.parse(collection.penSettings),
    settingsLocked: Boolean(collection.firstCaptureAt),
    completeness,
    staffCompleteness: {
      complete: staffMembers.filter((member) => Boolean(member.artifact)).length,
      total: staffMembers.length,
    },
    members: serializedMembers,
  };
}

const signatureCaptureBootstrapSelect = {
  captureVersion: true,
  settingsVersion: true,
  currentRevision: { select: { id: true, state: true } },
  collection: {
    select: {
      sportCode: true,
      season: true,
      status: true,
      settingsVersion: true,
      penSettings: true,
    },
  },
} satisfies Prisma.SignatureCaptureSelect;

export async function getSignatureMemberCaptureBootstrap(collectionId: string, memberId: string) {
  const member = await db.signatureMember.findFirst({
    where: { id: memberId, collectionId },
    select: {
      id: true,
      name: true,
      jerseyNumber: true,
      title: true,
      roleGroup: true,
      active: true,
      linkedUserId: true,
      collection: {
        select: {
          id: true,
          sportCode: true,
          season: true,
          status: true,
          collectionVersion: true,
        },
      },
      capture: { select: signatureCaptureBootstrapSelect },
    },
  });
  if (!member || visibleSignatureMembers(member.collection.sportCode, [member]).length === 0) {
    throw new HttpError(404, "Signature member not found");
  }

  const canonicalCapture = !member.linkedUserId || member.collection.sportCode === SIGNATURE_CREATIVE_STAFF_SPORT_CODE
    ? null
    : await db.signatureCapture.findFirst({
        where: {
          collection: {
            sportCode: SIGNATURE_CREATIVE_STAFF_SPORT_CODE,
            season: member.collection.season,
          },
          member: { active: true, linkedUserId: member.linkedUserId },
        },
        select: signatureCaptureBootstrapSelect,
      });
  const capture = canonicalCapture ?? member.capture;
  if (!capture) throw new HttpError(404, "Signature member is not ready for capture");

  return {
    collection: {
      id: member.collection.id,
      season: member.collection.season,
      status: member.collection.status,
      collectionVersion: member.collection.collectionVersion,
    },
    member: {
      id: member.id,
      name: member.name,
      jerseyNumber: member.jerseyNumber,
      title: member.title,
      roleGroup: member.roleGroup,
      active: member.active,
      captureVersion: capture.captureVersion,
      settingsVersion: capture.settingsVersion,
      captureSettings: penSettingsSchema.parse(capture.collection.penSettings),
      artifact: capture.currentRevision?.state === SignatureArtifactState.READY
        ? { id: capture.currentRevision.id }
        : null,
    },
  };
}

export async function archiveSignatureCollection(input: { actor: Actor; collectionId: string; expectedCollectionVersion: number }) {
  return db.$transaction(async (tx) => {
    const collection = await tx.signatureCollection.findUnique({ where: { id: input.collectionId }, select: { id: true, status: true, collectionVersion: true } });
    if (!collection) throw new HttpError(404, "Signature collection not found");
    if (collection.status === SignatureCollectionStatus.ARCHIVED) return collection;
    if (collection.collectionVersion !== input.expectedCollectionVersion) throw new HttpError(409, "Collection changed since this form was opened");
    const updated = await tx.signatureCollection.update({
      where: { id: collection.id },
      data: { status: SignatureCollectionStatus.ARCHIVED, archivedAt: new Date(), archivedById: input.actor.id, collectionVersion: { increment: 1 }, updatedById: input.actor.id },
      select: { id: true, status: true, collectionVersion: true },
    });
    await createAuditEntryTx(tx, { actorId: input.actor.id, actorRole: input.actor.role, entityType: "SignatureCollection", entityId: collection.id, action: "ARCHIVE", before: { status: collection.status, collectionVersion: collection.collectionVersion }, after: { status: updated.status, collectionVersion: updated.collectionVersion } });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function restoreSignatureCollection(input: { actor: Actor; collectionId: string; expectedCollectionVersion: number }) {
  return db.$transaction(async (tx) => {
    const collection = await tx.signatureCollection.findUnique({ where: { id: input.collectionId }, select: { id: true, status: true, collectionVersion: true } });
    if (!collection) throw new HttpError(404, "Signature collection not found");
    if (collection.status === SignatureCollectionStatus.OPEN) return collection;
    if (collection.collectionVersion !== input.expectedCollectionVersion) throw new HttpError(409, "Collection changed since this form was opened");
    const updated = await tx.signatureCollection.update({
      where: { id: collection.id },
      data: { status: SignatureCollectionStatus.OPEN, archivedAt: null, archivedById: null, collectionVersion: { increment: 1 }, updatedById: input.actor.id },
      select: { id: true, status: true, collectionVersion: true },
    });
    await createAuditEntryTx(tx, { actorId: input.actor.id, actorRole: input.actor.role, entityType: "SignatureCollection", entityId: collection.id, action: "RESTORE", before: { status: collection.status, collectionVersion: collection.collectionVersion }, after: { status: updated.status, collectionVersion: updated.collectionVersion } });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

type SignatureCollectionDeleteRevision = {
  id: string;
  pngPath: string;
  svgPath: string;
};

export async function deleteSignatureCollection(input: { actor: Actor; collectionId: string; expectedCollectionVersion: number }) {
  const pending = await withSerializationRetry(() => db.$transaction(async (tx) => {
    const collection = await tx.signatureCollection.findUnique({
      where: { id: input.collectionId },
      select: { id: true, status: true, collectionVersion: true },
    });
    if (!collection) throw new HttpError(404, "Signature collection not found");
    if (collection.collectionVersion !== input.expectedCollectionVersion) {
      throw new HttpError(409, "Collection changed since this form was opened");
    }

    // Close the collection and invalidate every capture before touching Blob.
    // This makes a multi-iPad save lose the race instead of recreating data
    // while the archive is being removed.
    await tx.signatureSaveOperation.updateMany({
      where: {
        collectionId: input.collectionId,
        status: { in: [SignatureSaveStatus.UPLOADING, SignatureSaveStatus.FINALIZING] },
      },
      data: { status: SignatureSaveStatus.FAILED, errorMessage: "Signature collection was deleted" },
    });

    const captures = await tx.signatureCapture.findMany({
      where: { collectionId: input.collectionId },
      select: { id: true },
    });
    if (captures.length > 0) {
      await tx.signatureCapture.updateMany({
        where: { id: { in: captures.map((capture) => capture.id) } },
        data: { currentRevisionId: null, captureVersion: { increment: 1 } },
      });
    }

    const revisions = await tx.signatureArtifactRevision.findMany({
      where: {
        capture: { is: { collectionId: input.collectionId } },
        state: { not: SignatureArtifactState.DELETED },
      },
      select: { id: true, pngPath: true, svgPath: true },
    });
    if (revisions.length > 0) {
      await tx.signatureArtifactRevision.updateMany({
        where: { id: { in: revisions.map((revision) => revision.id) } },
        data: { state: SignatureArtifactState.PENDING_DELETE, replacedAt: new Date() },
      });
    }

    const updated = await tx.signatureCollection.update({
      where: { id: input.collectionId },
      data: {
        status: SignatureCollectionStatus.ARCHIVED,
        archivedAt: new Date(),
        archivedById: input.actor.id,
        firstCaptureAt: null,
        collectionVersion: { increment: 1 },
        updatedById: input.actor.id,
      },
      select: { collectionVersion: true },
    });
    await createAuditEntryTx(tx, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "SignatureCollection",
      entityId: input.collectionId,
      action: "DELETE_REQUESTED",
      before: { status: collection.status, collectionVersion: collection.collectionVersion },
      after: { status: SignatureCollectionStatus.ARCHIVED, collectionVersion: updated.collectionVersion, revisions: revisions.length },
    });
    return {
      collectionVersion: updated.collectionVersion,
      revisions: revisions as SignatureCollectionDeleteRevision[],
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

  const cleanup = await cleanupSignatureRevisions(pending.revisions);
  if (cleanup.failed.length > 0) {
    throw new HttpError(503, "Some signature files could not be removed; the archived roster was kept for retry");
  }

  await withSerializationRetry(() => db.$transaction(async (tx) => {
    const collection = await tx.signatureCollection.findUnique({
      where: { id: input.collectionId },
      select: { id: true, status: true, collectionVersion: true },
    });
    if (!collection) return;
    if (collection.status !== SignatureCollectionStatus.ARCHIVED || collection.collectionVersion !== pending.collectionVersion) {
      throw new HttpError(409, "Collection changed while it was being deleted; retry the delete");
    }

    const remainingRevisions = await tx.signatureArtifactRevision.findMany({
      where: {
        capture: { is: { collectionId: input.collectionId } },
        state: { not: SignatureArtifactState.DELETED },
      },
      select: { id: true },
    });
    if (remainingRevisions.length > 0) {
      throw new HttpError(503, "Some signature files are still pending removal; retry the delete");
    }

    // sourceSnapshot is RESTRICT, so detach members before removing their
    // snapshots. The explicit order also keeps the cascade predictable across
    // the current Neon/PostgreSQL schema.
    await tx.signatureSaveOperation.deleteMany({ where: { collectionId: input.collectionId } });
    await tx.signatureArtifactRevision.deleteMany({ where: { capture: { is: { collectionId: input.collectionId } } } });
    await tx.signatureCapture.deleteMany({ where: { collectionId: input.collectionId } });
    await tx.signatureMember.updateMany({ where: { collectionId: input.collectionId }, data: { sourceSnapshotId: null } });
    await tx.signatureMember.deleteMany({ where: { collectionId: input.collectionId } });
    await tx.signatureRosterSnapshot.deleteMany({ where: { collectionId: input.collectionId } });
    await tx.signatureCollection.delete({ where: { id: input.collectionId } });
    await createAuditEntryTx(tx, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "SignatureCollection",
      entityId: input.collectionId,
      action: "DELETE",
      before: { status: collection.status, collectionVersion: collection.collectionVersion },
      after: { deleted: true },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

  return { deleted: true };
}

export async function resetSignatureCollection(input: { actor: Actor; collectionId: string; expectedCollectionVersion: number }) {
  const result = await db.$transaction(async (tx) => {
    const collection = await tx.signatureCollection.findUnique({ where: { id: input.collectionId }, select: { id: true, status: true, collectionVersion: true } });
    if (!collection) throw new HttpError(404, "Signature collection not found");
    if (collection.status === SignatureCollectionStatus.ARCHIVED) throw new HttpError(409, "Archived signature collections are read-only");
    if (collection.collectionVersion !== input.expectedCollectionVersion) throw new HttpError(409, "Collection changed since this form was opened");
    const captures = await tx.signatureCapture.findMany({
      where: { collectionId: input.collectionId },
      select: {
        id: true,
        currentRevisionId: true,
        captureVersion: true,
        revisions: {
          where: { state: SignatureArtifactState.READY },
          select: { id: true, pngPath: true, svgPath: true },
        },
      },
    });
    const revisions = captures.flatMap((capture) => capture.revisions);
    if (captures.length > 0) {
      // Increment every capture, including currently blank members, so an
      // in-flight save cannot commit after an explicit collection reset.
      await tx.signatureCapture.updateMany({ where: { id: { in: captures.map((capture) => capture.id) } }, data: { currentRevisionId: null, captureVersion: { increment: 1 } } });
    }
    if (revisions.length > 0) {
      await tx.signatureArtifactRevision.updateMany({ where: { id: { in: revisions.map((revision) => revision.id) } }, data: { state: SignatureArtifactState.PENDING_DELETE, replacedAt: new Date() } });
    }
    const updated = await tx.signatureCollection.update({ where: { id: input.collectionId }, data: { firstCaptureAt: null, collectionVersion: { increment: 1 }, updatedById: input.actor.id }, select: { collectionVersion: true } });
    await createAuditEntryTx(tx, { actorId: input.actor.id, actorRole: input.actor.role, entityType: "SignatureCollection", entityId: input.collectionId, action: "RESET", before: { collectionVersion: input.expectedCollectionVersion, captures: captures.length }, after: { collectionVersion: updated.collectionVersion, captures: 0 } });
    return { collectionVersion: updated.collectionVersion, revisions, captureCount: captures.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await cleanupSignatureRevisions(result.revisions);
  return { collectionVersion: result.collectionVersion, resetCount: result.captureCount };
}
