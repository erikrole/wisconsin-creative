import { randomUUID } from "node:crypto";
import {
  Prisma,
  SignatureArtifactState,
  SignatureCollectionStatus,
  SignatureMemberGroup,
  SignatureSaveStatus,
  SignatureSnapshotStatus,
  Role,
  ShiftArea,
} from "@prisma/client";
import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { HttpError } from "@/lib/http";
import { isSerializationConflict, withSerializationRetry } from "@/lib/serialization";
import { renderSignatureArtifacts } from "@/lib/signatures/artifacts";
import {
  DEFAULT_SIGNATURE_PEN_SETTINGS,
  SIGNATURE_AD_HOC_SPORT_CODE,
  SIGNATURE_ADMINISTRATION_SPORT_CODE,
  SIGNATURE_CREATIVE_STAFF_SPORT_CODE,
  SIGNATURE_MBB_SPORT_CODE,
  getSignatureRosterSourceConfig,
  isRequiredSignatureGroup,
  isStandaloneSignatureCollection,
  isStandaloneStaffSignatureCollection,
  normalizeSignatureName,
  penSettingsSchema,
  signatureAdHocMemberSchema,
  signatureCreativeStaffCollectionSchema,
  signatureRosterEntrySchema,
  type CaptureSaveRequest,
  type SignatureImportedSportCode,
  type SignaturePenSettings,
  type SignatureRosterEntry,
} from "@/lib/signatures/types";
import {
  buildSignatureArtifactPath,
  deletePrivateSignatureArtifacts,
  getPrivateSignatureArtifact,
  uploadPrivateSignatureArtifact,
} from "@/lib/signatures/storage";
import { compareSignatureRosterMembers } from "@/lib/signatures/roster";
import { createStoredZip, type SignatureZipFormat, type StoredZipEntry } from "@/lib/signatures/zip";

const signatureJson = (value: unknown) => value as Prisma.InputJsonValue;

type Actor = { id: string; role: Role };

const CREATIVE_STAFF_SOURCE_PREFIX = "creative-staff:";
const SIGNATURE_SAVE_STALE_MS = 60_000;
const SIGNATURE_ZIP_MAX_ENTRIES = 1_000;
const SIGNATURE_ZIP_MAX_BYTES = 50 * 1024 * 1024;
const SIGNATURE_ZIP_READ_CONCURRENCY = 8;
const SIGNATURE_CLEANUP_CONCURRENCY = 8;
const SIGNATURE_DETAIL_PRIOR_REVISION_LIMIT = 5;
const SIGNATURE_ROSTER_APPLY_MAX_WAIT_MS = 10_000;
const SIGNATURE_ROSTER_APPLY_TIMEOUT_MS = 30_000;
const STALE_SIGNATURE_CAPTURE_MESSAGE = "This person was already signed or changed on another iPad; this iPad's draft was kept. Return to the roster before trying again";
const CREATIVE_STAFF_TITLE_MARKERS = ["Creative", "Digital Media"] as const;
const creativeStaffTitleFilters = CREATIVE_STAFF_TITLE_MARKERS.map((marker) => ({
  title: { contains: marker, mode: "insensitive" as const },
}));

const signatureRosterApplyCaptureSelect = {
  id: true,
  memberId: true,
  captureVersion: true,
  currentRevisionId: true,
  capturedAt: true,
  capturedById: true,
  currentRevision: { select: { id: true, state: true } },
  saveOperations: {
    where: { status: { in: [SignatureSaveStatus.UPLOADING, SignatureSaveStatus.FINALIZING] } },
    select: { id: true },
  },
  _count: { select: { revisions: true } },
} satisfies Prisma.SignatureCaptureSelect;

const signatureRosterApplyMemberSelect = {
  id: true,
  sourceExternalId: true,
  sourceProfileUrl: true,
  name: true,
  normalizedName: true,
  jerseyNumber: true,
  roleGroup: true,
  title: true,
  active: true,
  required: true,
  capture: { select: signatureRosterApplyCaptureSelect },
} satisfies Prisma.SignatureMemberSelect;

type SignatureRosterApplyMember = Prisma.SignatureMemberGetPayload<{ select: typeof signatureRosterApplyMemberSelect }>;
type SignatureRosterApplyCapture = Prisma.SignatureCaptureGetPayload<{ select: typeof signatureRosterApplyCaptureSelect }>;

type SignatureRosterMergePlan = {
  source: SignatureRosterApplyMember;
  targetMemberId: string;
  targetSourceExternalId: string;
};

type SignatureRosterMergeResult = {
  sourceMemberId: string;
  sourceExternalId: string;
  targetMemberId: string;
  targetSourceExternalId: string;
  artifactTransferred: boolean;
  transferredRevisionCount: number;
};

function signatureRosterPlayerIdentityKey(member: Pick<SignatureRosterApplyMember, "normalizedName" | "roleGroup"> | SignatureRosterEntry) {
  if (member.roleGroup !== SignatureMemberGroup.PLAYER || !member.normalizedName) return null;
  return `${member.roleGroup}:${member.normalizedName}`;
}

function findHighConfidenceHistoricalRosterMember(
  existing: SignatureRosterApplyMember[],
  entry: SignatureRosterEntry,
  targetMemberId: string | undefined,
  sourceIds: Set<string>,
  incomingIdentityCounts: Map<string, number>,
  reservedSourceMemberIds: Set<string>,
) {
  const identityKey = signatureRosterPlayerIdentityKey(entry);
  if (!identityKey || incomingIdentityCounts.get(identityKey) !== 1) return null;
  const matches = existing.filter((member) => member.id !== targetMemberId && signatureRosterPlayerIdentityKey(member) === identityKey);
  if (matches.length !== 1) return null;
  const candidate = matches[0];
  if (!candidate) return null;
  if (candidate.active || sourceIds.has(candidate.sourceExternalId) || reservedSourceMemberIds.has(candidate.id)) return null;
  return candidate;
}

function isBlankSignatureRosterCapture(capture: SignatureRosterApplyCapture | null) {
  return !capture
    || (
      capture.captureVersion === 0
      && !capture.currentRevisionId
      && capture._count?.revisions === 0
      && !capture.capturedAt
      && !capture.capturedById
      && capture.saveOperations.length === 0
    );
}

function canDonateSignatureRosterCapture(capture: SignatureRosterApplyCapture | null) {
  if (!capture || capture.saveOperations.length > 0) return false;
  if (!capture.currentRevisionId && capture._count?.revisions === 0) return true;
  return Boolean(
    capture.currentRevisionId
    && capture.currentRevision?.id === capture.currentRevisionId
    && capture.currentRevision.state === SignatureArtifactState.READY,
  );
}

const artifactRevisionSelect = {
  id: true,
  revision: true,
  state: true,
  width: true,
  height: true,
  pngHash: true,
  svgHash: true,
  pngPath: true,
  svgPath: true,
  committedAt: true,
  replacedAt: true,
} satisfies Prisma.SignatureArtifactRevisionSelect;

function publicArtifact(revision: {
  id: string;
  revision: number;
  state: SignatureArtifactState;
  width: number;
  height: number;
  pngHash: string;
  svgHash: string;
  committedAt: Date | null;
  replacedAt: Date | null;
}) {
  if (revision.state !== SignatureArtifactState.READY) return null;
  return {
    id: revision.id,
    revision: revision.revision,
    width: revision.width,
    height: revision.height,
    pngHash: revision.pngHash,
    svgHash: revision.svgHash,
    committedAt: revision.committedAt?.toISOString() ?? null,
    replacedAt: revision.replacedAt?.toISOString() ?? null,
  };
}

type PublicSignatureArtifact = NonNullable<ReturnType<typeof publicArtifact>>;

type SignatureCompletenessMember = { active: boolean; artifactReady: boolean };

function collectionCompleteness(members: SignatureCompletenessMember[], emptyPercent = 100) {
  const activeMembers = members.filter((member) => member.active);
  const complete = activeMembers.filter((member) => member.artifactReady);
  return {
    complete: complete.length,
    required: activeMembers.length,
    percent: activeMembers.length === 0 ? emptyPercent : Math.round((complete.length / activeMembers.length) * 100),
  };
}

const collectionInclude = {
  snapshots: {
    where: { status: SignatureSnapshotStatus.APPLIED },
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { entries: true },
  },
  members: {
    orderBy: { name: "asc" as const },
    include: {
      capture: {
        include: {
          currentRevision: {
            select: artifactRevisionSelect,
          },
          revisions: {
            where: { state: SignatureArtifactState.READY },
            orderBy: { revision: "desc" as const },
            take: SIGNATURE_DETAIL_PRIOR_REVISION_LIMIT + 1,
            select: artifactRevisionSelect,
          },
          _count: {
            select: {
              revisions: { where: { state: SignatureArtifactState.READY } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.SignatureCollectionInclude;

const canonicalCaptureInclude = {
  collection: {
    select: { id: true, sportCode: true, season: true, status: true, settingsVersion: true, penSettings: true },
  },
  member: { select: { id: true, active: true, linkedUserId: true } },
  currentRevision: { select: artifactRevisionSelect },
} satisfies Prisma.SignatureCaptureInclude;

const canonicalDetailCaptureInclude = {
  ...canonicalCaptureInclude,
  revisions: {
    where: { state: SignatureArtifactState.READY },
    orderBy: { revision: "desc" as const },
    take: SIGNATURE_DETAIL_PRIOR_REVISION_LIMIT + 1,
    select: artifactRevisionSelect,
  },
  _count: {
    select: {
      revisions: { where: { state: SignatureArtifactState.READY } },
    },
  },
} satisfies Prisma.SignatureCaptureInclude;

type CanonicalSignatureCapture = Prisma.SignatureCaptureGetPayload<{ include: typeof canonicalCaptureInclude }>;
type CanonicalSignatureDetailCapture = Prisma.SignatureCaptureGetPayload<{ include: typeof canonicalDetailCaptureInclude }>;

const saveOperationInclude = {
  revision: true,
  capture: { include: { currentRevision: true } },
} satisfies Prisma.SignatureSaveOperationInclude;

type SignatureSaveOperationWithRevision = Prisma.SignatureSaveOperationGetPayload<{ include: typeof saveOperationInclude }>;

function assertSignatureSaveOperationTarget(
  operation: SignatureSaveOperationWithRevision,
  input: { actor: Actor; target: CanonicalSignatureCapture; request: CaptureSaveRequest },
) {
  if (
    operation.collectionId !== input.target.collectionId ||
    operation.memberId !== input.target.memberId ||
    operation.captureId !== input.target.id ||
    operation.actorUserId !== input.actor.id ||
    operation.expectedCaptureVersion !== input.request.expectedCaptureVersion ||
    operation.settingsVersion !== input.request.settingsVersion
  ) {
    throw new HttpError(409, "This save request ID was already used for another signature");
  }
}

function committedSignatureSave(operation: SignatureSaveOperationWithRevision) {
  const revision = operation.revision ? publicArtifact(operation.revision) : null;
  if (!revision) throw new HttpError(503, "The committed signature artifact is temporarily unavailable");
  return {
    status: "committed" as const,
    captureVersion: operation.capture.captureVersion,
    revision,
  };
}

function isStaleSignatureSave(operation: Pick<SignatureSaveOperationWithRevision, "updatedAt">, now = Date.now()) {
  return operation.updatedAt.getTime() <= now - SIGNATURE_SAVE_STALE_MS;
}

function isPrismaUniqueConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

function defaultImportedMemberRequired(sportCode: string, roleGroup: SignatureMemberGroup) {
  const source = getSignatureRosterSourceConfig(sportCode || SIGNATURE_MBB_SPORT_CODE);
  return source.requiredByDefault === true || isRequiredSignatureGroup(roleGroup);
}

async function resolveSignatureCaptureTarget(collectionId: string, memberId: string) {
  const requested = await db.signatureCapture.findFirst({
    where: { collectionId, memberId },
    include: canonicalCaptureInclude,
  });
  if (!requested) throw new HttpError(404, "Signature member is not ready for capture");
  if (!requested.member.active) throw new HttpError(409, "This roster member is inactive and cannot receive a new signature");
  if (requested.collection.status === SignatureCollectionStatus.ARCHIVED) throw new HttpError(409, "Archived signature collections are read-only");
  if (!requested.member.linkedUserId || requested.collection.sportCode === SIGNATURE_CREATIVE_STAFF_SPORT_CODE) {
    return requested;
  }
  const canonical = await db.signatureCapture.findFirst({
    where: {
      collection: {
        sportCode: SIGNATURE_CREATIVE_STAFF_SPORT_CODE,
        season: requested.collection.season,
      },
      member: { active: true, linkedUserId: requested.member.linkedUserId },
    },
    include: canonicalCaptureInclude,
  });
  return canonical ?? requested;
}

function visibleSignatureMembers<T extends { roleGroup: SignatureMemberGroup }>(sportCode: string, members: T[]) {
  if (sportCode === SIGNATURE_CREATIVE_STAFF_SPORT_CODE) {
    return members.filter((member) => member.roleGroup === SignatureMemberGroup.CREATIVE_STAFF);
  }
  if (isStandaloneStaffSignatureCollection(sportCode)) {
    return members.filter((member) => member.roleGroup === SignatureMemberGroup.SUPPORT_STAFF);
  }
  return members.filter((member) => member.roleGroup !== SignatureMemberGroup.CREATIVE_STAFF);
}

function isTeamSignatureCollection(sportCode: string) {
  return !isStandaloneSignatureCollection(sportCode);
}

function primarySignatureMembers<T extends { active: boolean; required: boolean; roleGroup: SignatureMemberGroup }>(sportCode: string, members: T[]) {
  return isTeamSignatureCollection(sportCode)
    ? members.filter((member) => member.active && member.roleGroup === SignatureMemberGroup.PLAYER)
    : members.filter((member) => member.active && member.required);
}

function staffSignatureMembers<T extends { active: boolean; roleGroup: SignatureMemberGroup }>(sportCode: string, members: T[]) {
  return isTeamSignatureCollection(sportCode)
    ? members.filter((member) => member.active && member.roleGroup !== SignatureMemberGroup.PLAYER)
    : [];
}

export async function listSignatureCollections(options: { includeArchived?: boolean } = {}) {
  const collections = await db.signatureCollection.findMany({
    where: options.includeArchived ? undefined : { status: SignatureCollectionStatus.OPEN },
    orderBy: [{ status: "asc" }, { season: "desc" }],
    include: {
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
      currentRevision: { is: { state: SignatureArtifactState.READY } },
    },
    select: {
      collection: { select: { season: true } },
      member: { select: { linkedUserId: true } },
    },
  });
  const canonicalReadyKeys = new Set(canonicalCaptures
    .filter((capture) => capture.member.linkedUserId)
    .map((capture) => `${capture.collection.season}:${capture.member.linkedUserId}`));

  return collections.map((collection) => {
    const members = visibleSignatureMembers(collection.sportCode, collection.members);
    const readyMemberIds = new Set(collection.captures.map((capture) => capture.memberId));
    const hasReadyArtifact = (member: typeof members[number]) => readyMemberIds.has(member.id)
      || Boolean(member.linkedUserId && canonicalReadyKeys.has(`${collection.season}:${member.linkedUserId}`));
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
  return serializeSignatureCollection(collection, canonicalByUserId);
}

function serializeSignatureCollection(
  collection: Prisma.SignatureCollectionGetPayload<{ include: typeof collectionInclude }>,
  canonicalByUserId: Map<string, CanonicalSignatureDetailCapture>,
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

export async function createSignatureRosterPreview(input: {
  actor: Actor;
  sportCode?: SignatureImportedSportCode;
  season: string;
  sourceUrl: string;
  sourceHash: string;
  parserVersion: string;
  fetchedAt: Date;
  entries: SignatureRosterEntry[];
}) {
  const {
    actor,
    sportCode = SIGNATURE_MBB_SPORT_CODE,
    season,
    sourceUrl,
    sourceHash,
    parserVersion,
    fetchedAt,
    entries,
  } = input;
  const source = getSignatureRosterSourceConfig(sportCode);
  return db.$transaction(async (tx) => {
    const collection = await tx.signatureCollection.upsert({
      where: { sportCode_season: { sportCode, season } },
      create: {
        sportCode,
        season,
        penSettings: signatureJson(DEFAULT_SIGNATURE_PEN_SETTINGS),
        createdById: actor.id,
        updatedById: actor.id,
      },
      update: {},
      select: { id: true, collectionVersion: true, status: true },
    });
    if (collection.status === SignatureCollectionStatus.ARCHIVED) {
      throw new HttpError(409, "Archived signature collections are read-only");
    }

    const existing = await tx.signatureRosterSnapshot.findUnique({
      where: { collectionId_sourceHash: { collectionId: collection.id, sourceHash } },
      select: { id: true, createdAt: true, status: true },
    });
    if (existing) {
      return {
        collectionId: collection.id,
        collectionVersion: collection.collectionVersion,
        snapshotId: existing.id,
        createdAt: existing.createdAt.toISOString(),
        candidateCount: entries.length,
        unchanged: true,
        alreadyApplied: existing.status === SignatureSnapshotStatus.APPLIED,
      };
    }

    const snapshot = await tx.signatureRosterSnapshot.create({
      data: {
        collectionId: collection.id,
        status: SignatureSnapshotStatus.PREVIEW,
        sourceKey: source.sourceKey,
        sourceUrl,
        sourceHash,
        parserVersion,
        fetchedAt,
        candidateCount: entries.length,
        entries: signatureJson(entries),
      },
    });
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "SignatureRosterSnapshot",
      entityId: snapshot.id,
      action: "PREVIEW",
      after: {
        collectionId: collection.id,
        sourceHash,
        parserVersion,
        candidateCount: entries.length,
      },
    });
    return {
      collectionId: collection.id,
      collectionVersion: collection.collectionVersion,
      snapshotId: snapshot.id,
      createdAt: snapshot.createdAt.toISOString(),
      candidateCount: entries.length,
      unchanged: false,
      alreadyApplied: false,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function applySignatureRosterSnapshot(input: {
  actor: Actor;
  snapshotId: string;
  expectedCollectionVersion: number;
}) {
  const result = await withSerializationRetry(() => db.$transaction(async (tx) => {
    const snapshot = await tx.signatureRosterSnapshot.findUnique({
      where: { id: input.snapshotId },
      include: { collection: true },
    });
    if (!snapshot) throw new HttpError(404, "Roster snapshot not found");
    if (snapshot.collection.status === SignatureCollectionStatus.ARCHIVED) {
      throw new HttpError(409, "Archived signature collections are read-only");
    }
    if (snapshot.status === SignatureSnapshotStatus.APPLIED) {
      const latestApplied = await tx.signatureRosterSnapshot.findFirst({
        where: { collectionId: snapshot.collectionId, status: SignatureSnapshotStatus.APPLIED },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (latestApplied?.id === snapshot.id) {
        const memberCount = await tx.signatureMember.count({ where: { collectionId: snapshot.collectionId } });
        return { collectionId: snapshot.collectionId, collectionVersion: snapshot.collection.collectionVersion, memberCount, unchanged: true };
      }
    }
    if (snapshot.collection.collectionVersion !== input.expectedCollectionVersion) {
      throw new HttpError(409, "Roster changed since this preview was created");
    }

    const entries = signatureRosterEntrySchema.array().parse(snapshot.entries) as SignatureRosterEntry[];
    if (entries.some((entry) => entry.roleGroup === SignatureMemberGroup.CREATIVE_STAFF)) {
      throw new HttpError(400, "Creative staff must use the standalone Creative staff roster");
    }
    const existing = await tx.signatureMember.findMany({
      where: { collectionId: snapshot.collectionId },
      select: signatureRosterApplyMemberSelect,
    });
    const existingBySource = new Map(existing.map((member) => [member.sourceExternalId, member]));
    const sourceIds = new Set(entries.map((entry) => entry.sourceExternalId));
    const incomingIdentityCounts = new Map<string, number>();
    for (const entry of entries) {
      const identityKey = signatureRosterPlayerIdentityKey(entry);
      if (identityKey) incomingIdentityCounts.set(identityKey, (incomingIdentityCounts.get(identityKey) ?? 0) + 1);
    }
    const reservedSourceMemberIds = new Set<string>();
    const mergePlans: SignatureRosterMergePlan[] = [];

    for (const entry of entries) {
      const existingMember = existingBySource.get(entry.sourceExternalId);
      const historicalMember = findHighConfidenceHistoricalRosterMember(
        existing,
        entry,
        existingMember?.id,
        sourceIds,
        incomingIdentityCounts,
        reservedSourceMemberIds,
      );
      const canMergeHistoricalMember = Boolean(
        historicalMember
        && existingMember?.active !== false
        && isBlankSignatureRosterCapture(existingMember?.capture ?? null)
        && canDonateSignatureRosterCapture(historicalMember.capture ?? null)
      );
      if (existingMember) {
        if (canMergeHistoricalMember) {
          mergePlans.push({
            source: historicalMember!,
            targetMemberId: existingMember.id,
            targetSourceExternalId: entry.sourceExternalId,
          });
          reservedSourceMemberIds.add(historicalMember!.id);
        }
        await tx.signatureMember.update({
          where: { id: existingMember.id },
          data: {
            sourceSnapshotId: snapshot.id,
            sourceProfileUrl: entry.sourceProfileUrl,
            name: entry.name,
            normalizedName: entry.normalizedName,
            jerseyNumber: entry.jerseyNumber,
            roleGroup: entry.roleGroup as SignatureMemberGroup,
            title: entry.title,
            // Players always require a signature. Preserve an admin's
            // readiness decision for unchanged non-player groups.
            required: entry.roleGroup === SignatureMemberGroup.PLAYER
              ? true
              : existingMember.roleGroup === entry.roleGroup
              ? existingMember.required
              : entry.roleGroup === "SUPPORT_STAFF" || existingMember.roleGroup === "SUPPORT_STAFF"
                ? false
                : existingMember.required,
            active: true,
          },
        });
      } else {
        const member = await tx.signatureMember.create({
          data: {
            collectionId: snapshot.collectionId,
            sourceSnapshotId: snapshot.id,
            sourceExternalId: entry.sourceExternalId,
            sourceProfileUrl: entry.sourceProfileUrl,
            name: entry.name,
            normalizedName: entry.normalizedName,
            jerseyNumber: entry.jerseyNumber,
            roleGroup: entry.roleGroup as SignatureMemberGroup,
            title: entry.title,
            required: defaultImportedMemberRequired(snapshot.collection.sportCode, entry.roleGroup),
          },
        });
        const createdMember: SignatureRosterApplyMember = {
          id: member.id,
          sourceExternalId: entry.sourceExternalId,
          sourceProfileUrl: entry.sourceProfileUrl,
          name: entry.name,
          normalizedName: entry.normalizedName,
          jerseyNumber: entry.jerseyNumber,
          roleGroup: entry.roleGroup as SignatureMemberGroup,
          title: entry.title,
          active: true,
          required: member.required ?? defaultImportedMemberRequired(snapshot.collection.sportCode, entry.roleGroup),
          capture: null,
        };
        existingBySource.set(entry.sourceExternalId, createdMember);
        if (canMergeHistoricalMember) {
          mergePlans.push({
            source: historicalMember!,
            targetMemberId: member.id,
            targetSourceExternalId: entry.sourceExternalId,
          });
          reservedSourceMemberIds.add(historicalMember!.id);
        }
      }
    }

    const sourceIdList = [...sourceIds];
    if (sourceIdList.length > 0) {
      await tx.signatureMember.updateMany({
        where: {
          collectionId: snapshot.collectionId,
          sourceExternalId: { notIn: sourceIdList },
        },
        data: { active: false },
      });
    }

    const members = await tx.signatureMember.findMany({
      where: { collectionId: snapshot.collectionId },
      select: { id: true },
    });
    await tx.signatureCapture.createMany({
      data: members.map((member) => ({
        collectionId: snapshot.collectionId,
        memberId: member.id,
        settingsVersion: snapshot.collection.settingsVersion,
      })),
      skipDuplicates: true,
    });

    const mergeResults: SignatureRosterMergeResult[] = [];
    if (mergePlans.length > 0) {
      const mergeMemberIds = [...new Set(mergePlans.flatMap((plan) => [plan.source.id, plan.targetMemberId]))];
      const mergeCaptures = await tx.signatureCapture.findMany({
        where: {
          collectionId: snapshot.collectionId,
          memberId: { in: mergeMemberIds },
        },
        select: signatureRosterApplyCaptureSelect,
      });
      const captureByMemberId = new Map(mergeCaptures.map((capture) => [capture.memberId, capture]));

      for (const plan of mergePlans) {
        const sourceCapture = captureByMemberId.get(plan.source.id) ?? plan.source.capture ?? null;
        const targetCapture = captureByMemberId.get(plan.targetMemberId) ?? null;
        let artifactTransferred = false;
        let transferredRevisionCount = 0;

        if (
          targetCapture
          && sourceCapture
          && isBlankSignatureRosterCapture(targetCapture)
          && canDonateSignatureRosterCapture(sourceCapture)
          && sourceCapture.currentRevisionId
        ) {
          await tx.signatureCapture.update({
            where: { id: sourceCapture.id },
            data: { currentRevisionId: null },
          });
          const movedRevisions = await tx.signatureArtifactRevision.updateMany({
            where: { captureId: sourceCapture.id },
            data: { captureId: targetCapture.id },
          });
          await tx.signatureSaveOperation.updateMany({
            where: { captureId: sourceCapture.id },
            data: { captureId: targetCapture.id, memberId: plan.targetMemberId },
          });
          await tx.signatureCapture.update({
            where: { id: targetCapture.id },
            data: {
              currentRevisionId: sourceCapture.currentRevisionId,
              captureVersion: Math.max(targetCapture.captureVersion, sourceCapture.captureVersion),
              capturedAt: sourceCapture.capturedAt,
              capturedById: sourceCapture.capturedById,
            },
          });
          artifactTransferred = true;
          transferredRevisionCount = movedRevisions.count;
        }

        if (artifactTransferred) {
          await createAuditEntryTx(tx, {
            actorId: input.actor.id,
            actorRole: input.actor.role,
            entityType: "SignatureMember",
            entityId: plan.targetMemberId,
            action: "MERGE_ROSTER_MEMBER",
            before: {
              sourceMemberId: plan.source.id,
              sourceExternalId: plan.source.sourceExternalId,
              targetMemberId: plan.targetMemberId,
              targetSourceExternalId: plan.targetSourceExternalId,
              matchedBy: ["normalizedName", "roleGroup"],
            },
            after: {
              sourceMemberRetainedInactive: true,
              artifactTransferred,
              transferredRevisionCount,
            },
          });
        }
        if (artifactTransferred) {
          mergeResults.push({
            sourceMemberId: plan.source.id,
            sourceExternalId: plan.source.sourceExternalId,
            targetMemberId: plan.targetMemberId,
            targetSourceExternalId: plan.targetSourceExternalId,
            artifactTransferred,
            transferredRevisionCount,
          });
        }
      }
    }

    await tx.signatureRosterSnapshot.update({
      where: { id: snapshot.id },
      data: { status: SignatureSnapshotStatus.APPLIED, appliedAt: new Date(), appliedById: input.actor.id },
    });
    const collection = await tx.signatureCollection.update({
      where: { id: snapshot.collectionId },
      data: { collectionVersion: { increment: 1 }, updatedById: input.actor.id },
      select: { id: true, collectionVersion: true },
    });
    await createAuditEntryTx(tx, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "SignatureRosterSnapshot",
      entityId: snapshot.id,
      action: "APPLY",
      before: { collectionVersion: input.expectedCollectionVersion, sourceHash: snapshot.sourceHash },
      after: {
        collectionVersion: collection.collectionVersion,
        candidateCount: snapshot.candidateCount,
        mergedCount: mergeResults.length,
      },
    });
    return {
      collectionId: collection.id,
      collectionVersion: collection.collectionVersion,
      memberCount: members.length,
      mergedCount: mergeResults.length,
      merges: mergeResults,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: SIGNATURE_ROSTER_APPLY_MAX_WAIT_MS,
    timeout: SIGNATURE_ROSTER_APPLY_TIMEOUT_MS,
  }));
  return result;
}

export async function ensureSignatureCreativeStaffCollection(input: {
  actor: Actor;
  season: string;
}) {
  const { season } = signatureCreativeStaffCollectionSchema.parse({ season: input.season });
  try {
    return await withSerializationRetry(() => db.$transaction(async (tx) => {
      const existing = await tx.signatureCollection.findUnique({
        where: { sportCode_season: { sportCode: SIGNATURE_CREATIVE_STAFF_SPORT_CODE, season } },
        select: { id: true, sportCode: true, season: true, status: true, collectionVersion: true },
      });
      if (existing) return { ...existing, created: false };

      const created = await tx.signatureCollection.create({
        data: {
          sportCode: SIGNATURE_CREATIVE_STAFF_SPORT_CODE,
          season,
          penSettings: signatureJson(DEFAULT_SIGNATURE_PEN_SETTINGS),
          createdById: input.actor.id,
          updatedById: input.actor.id,
        },
        select: { id: true, sportCode: true, season: true, status: true, collectionVersion: true },
      });
      await createAuditEntryTx(tx, {
        actorId: input.actor.id,
        actorRole: input.actor.role,
        entityType: "SignatureCollection",
        entityId: created.id,
        action: "CREATE",
        after: { sportCode: created.sportCode, season: created.season, collectionVersion: created.collectionVersion },
      });
      return { ...created, created: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.signatureCollection.findUnique({
        where: { sportCode_season: { sportCode: SIGNATURE_CREATIVE_STAFF_SPORT_CODE, season } },
        select: { id: true, sportCode: true, season: true, status: true, collectionVersion: true },
      });
      if (existing) return { ...existing, created: false };
    }
    throw error;
  }
}

export async function createAdHocSignatureMember(input: {
  actor: Actor;
  season: string;
  name: string;
  category: string;
}) {
  const parsed = signatureAdHocMemberSchema.parse(input);
  return withSerializationRetry(() => db.$transaction(async (tx) => {
    const collection = await tx.signatureCollection.upsert({
      where: { sportCode_season: { sportCode: SIGNATURE_AD_HOC_SPORT_CODE, season: parsed.season } },
      create: {
        sportCode: SIGNATURE_AD_HOC_SPORT_CODE,
        season: parsed.season,
        penSettings: signatureJson(DEFAULT_SIGNATURE_PEN_SETTINGS),
        createdById: input.actor.id,
        updatedById: input.actor.id,
      },
      update: {},
      select: { id: true, status: true, collectionVersion: true, settingsVersion: true },
    });
    if (collection.status === SignatureCollectionStatus.ARCHIVED) {
      throw new HttpError(409, "The ad-hoc signature roster for this season is archived");
    }

    const member = await tx.signatureMember.create({
      data: {
        collectionId: collection.id,
        sourceExternalId: `manual:${randomUUID()}`,
        name: parsed.name,
        normalizedName: normalizeSignatureName(parsed.name),
        roleGroup: SignatureMemberGroup.SUPPORT_STAFF,
        title: parsed.category,
        required: true,
        active: true,
      },
      select: { id: true, name: true, title: true },
    });
    await tx.signatureCapture.create({
      data: {
        collectionId: collection.id,
        memberId: member.id,
        settingsVersion: collection.settingsVersion,
      },
    });
    const updated = await tx.signatureCollection.update({
      where: { id: collection.id },
      data: { collectionVersion: { increment: 1 }, updatedById: input.actor.id },
      select: { collectionVersion: true },
    });
    await createAuditEntryTx(tx, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "SignatureMember",
      entityId: member.id,
      action: "CREATE_AD_HOC",
      after: {
        collectionId: collection.id,
        collectionVersion: updated.collectionVersion,
        name: member.name,
        category: member.title,
      },
    });
    return {
      collectionId: collection.id,
      collectionVersion: updated.collectionVersion,
      memberId: member.id,
      captureVersion: 0,
      settingsVersion: collection.settingsVersion,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function syncSignatureCreativeStaff(input: {
  actor: Actor;
  collectionId: string;
  expectedCollectionVersion: number;
}) {
  return withSerializationRetry(() => db.$transaction(async (tx) => {
    const collection = await tx.signatureCollection.findUnique({
      where: { id: input.collectionId },
      select: { id: true, sportCode: true, season: true, status: true, collectionVersion: true, settingsVersion: true },
    });
    if (!collection) throw new HttpError(404, "Signature collection not found");
    if (collection.sportCode !== SIGNATURE_CREATIVE_STAFF_SPORT_CODE) {
      throw new HttpError(409, "Creative staff uses its standalone roster");
    }
    if (collection.status === SignatureCollectionStatus.ARCHIVED) {
      throw new HttpError(409, "Archived signature collections are read-only");
    }
    if (collection.collectionVersion !== input.expectedCollectionVersion) {
      throw new HttpError(409, "Collection changed since this form was opened");
    }

    const users = await tx.user.findMany({
      where: {
        active: true,
        hiddenFromRoster: false,
        staffingType: "FT",
        OR: [
          { primaryArea: { in: [ShiftArea.VIDEO, ShiftArea.PHOTO, ShiftArea.GRAPHICS] } },
          { areaAssignments: { some: { area: { in: [ShiftArea.VIDEO, ShiftArea.PHOTO, ShiftArea.GRAPHICS] } } } },
          ...creativeStaffTitleFilters,
        ],
      },
      select: { id: true, name: true, title: true },
      orderBy: { name: "asc" },
    });
    const existing = await tx.signatureMember.findMany({
      where: { collectionId: collection.id, roleGroup: SignatureMemberGroup.CREATIVE_STAFF },
      select: { id: true, linkedUserId: true, required: true, active: true, name: true, title: true },
    });
    const existingByUser = new Map(existing.filter((member) => member.linkedUserId).map((member) => [member.linkedUserId as string, member]));
    const activeUserIds = new Set(users.map((user) => user.id));
    const usersByNormalizedName = new Map<string, Array<(typeof users)[number]>>();
    for (const user of users) {
      const normalizedName = normalizeSignatureName(user.name);
      usersByNormalizedName.set(normalizedName, [...(usersByNormalizedName.get(normalizedName) ?? []), user]);
    }
    const uniquelyNamedUsers = new Map([...usersByNormalizedName.entries()]
      .filter(([, matches]) => matches.length === 1)
      .map(([normalizedName, matches]) => [normalizedName, matches[0]]));
    let added = 0;
    let reactivated = 0;
    let updated = 0;
    let changed = false;

    for (const user of users) {
      const current = existingByUser.get(user.id);
      if (current) {
        const needsUpdate = !current.active || current.name !== user.name || current.title !== user.title;
        if (needsUpdate) {
          await tx.signatureMember.update({
            where: { id: current.id },
            data: { name: user.name, normalizedName: normalizeSignatureName(user.name), title: user.title, active: true },
          });
          updated += 1;
          if (!current.active) reactivated += 1;
          changed = true;
        }
        continue;
      }

      await tx.signatureMember.create({
        data: {
          collectionId: collection.id,
          sourceExternalId: `${CREATIVE_STAFF_SOURCE_PREFIX}${user.id}`,
          name: user.name,
          normalizedName: normalizeSignatureName(user.name),
          roleGroup: SignatureMemberGroup.CREATIVE_STAFF,
          title: user.title,
          required: true,
          active: true,
          linkedUserId: user.id,
        },
      });
      added += 1;
      changed = true;
    }

    const stale = existing.filter((member) => member.active && (!member.linkedUserId || !activeUserIds.has(member.linkedUserId)));
    if (stale.length > 0) {
      await tx.signatureMember.updateMany({
        where: { id: { in: stale.map((member) => member.id) }, active: true },
        data: { active: false },
      });
      changed = true;
    }

    const teamMembers = uniquelyNamedUsers.size === 0 ? [] : await tx.signatureMember.findMany({
      where: {
        active: true,
        roleGroup: { not: SignatureMemberGroup.PLAYER },
        normalizedName: { in: [...uniquelyNamedUsers.keys()] },
        collection: {
          season: collection.season,
          sportCode: { notIn: [SIGNATURE_CREATIVE_STAFF_SPORT_CODE, SIGNATURE_ADMINISTRATION_SPORT_CODE, SIGNATURE_AD_HOC_SPORT_CODE] },
        },
      },
      select: { id: true, normalizedName: true, linkedUserId: true },
    });
    let linkedTeamMembers = 0;
    for (const member of teamMembers) {
      const matchedUser = uniquelyNamedUsers.get(member.normalizedName);
      if (!matchedUser || member.linkedUserId === matchedUser.id || member.linkedUserId) continue;
      const linked = await tx.signatureMember.updateMany({
        where: { id: member.id, linkedUserId: null },
        data: { linkedUserId: matchedUser.id },
      });
      if (linked.count > 0) {
        linkedTeamMembers += linked.count;
        changed = true;
      }
    }

    const members = await tx.signatureMember.findMany({
      where: { collectionId: collection.id },
      select: { id: true },
    });
    await tx.signatureCapture.createMany({
      data: members.map((member) => ({
        collectionId: collection.id,
        memberId: member.id,
        settingsVersion: collection.settingsVersion,
      })),
      skipDuplicates: true,
    });

    const nextCollectionVersion = changed
      ? (await tx.signatureCollection.update({
          where: { id: collection.id },
          data: { collectionVersion: { increment: 1 }, updatedById: input.actor.id },
          select: { collectionVersion: true },
        })).collectionVersion
      : collection.collectionVersion;
    if (changed) {
      await createAuditEntryTx(tx, {
        actorId: input.actor.id,
        actorRole: input.actor.role,
        entityType: "SignatureCollection",
        entityId: collection.id,
        action: "SYNC_CREATIVE_STAFF",
        before: { collectionVersion: input.expectedCollectionVersion, activeMembers: existing.filter((member) => member.active).length },
        after: { collectionVersion: nextCollectionVersion, activeMembers: users.length, added, reactivated, updated, deactivated: stale.length, linkedTeamMembers },
      });
    }
    return {
      collectionId: collection.id,
      collectionVersion: nextCollectionVersion,
      activeCount: users.length,
      added,
      reactivated,
      updated,
      deactivated: stale.length,
      linkedTeamMembers,
      unchanged: !changed,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function updateSignaturePenSettings(input: {
  actor: Actor;
  collectionId: string;
  expectedCollectionVersion: number;
  expectedSettingsVersion: number;
  settings: SignaturePenSettings;
}) {
  penSettingsSchema.parse(input.settings);
  return db.$transaction(async (tx) => {
    const collection = await tx.signatureCollection.findUnique({ where: { id: input.collectionId } });
    if (!collection) throw new HttpError(404, "Signature collection not found");
    if (collection.status === SignatureCollectionStatus.ARCHIVED) throw new HttpError(409, "Archived signature collections are read-only");
    if (collection.collectionVersion !== input.expectedCollectionVersion || collection.settingsVersion !== input.expectedSettingsVersion) {
      throw new HttpError(409, "Signature settings changed since this form was opened");
    }
    if (collection.firstCaptureAt) {
      throw new HttpError(409, "Changing pen settings requires an explicit collection reset after the first capture");
    }
    const updated = await tx.signatureCollection.update({
      where: { id: input.collectionId },
      data: {
        penSettings: signatureJson(input.settings),
        settingsVersion: { increment: 1 },
        collectionVersion: { increment: 1 },
        updatedById: input.actor.id,
      },
      select: { collectionVersion: true, settingsVersion: true },
    });
    await tx.signatureCapture.updateMany({
      where: { collectionId: input.collectionId },
      data: { settingsVersion: updated.settingsVersion },
    });
    await createAuditEntryTx(tx, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "SignatureCollection",
      entityId: input.collectionId,
      action: "UPDATE_PEN_SETTINGS",
      before: { collectionVersion: input.expectedCollectionVersion, settingsVersion: input.expectedSettingsVersion },
      after: { collectionVersion: updated.collectionVersion, settingsVersion: updated.settingsVersion, settings: input.settings },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateSignatureMemberRequired(input: {
  actor: Actor;
  collectionId: string;
  memberId: string;
  required: boolean;
  expectedCollectionVersion: number;
}) {
  return db.$transaction(async (tx) => {
    const collection = await tx.signatureCollection.findUnique({ where: { id: input.collectionId }, select: { collectionVersion: true, status: true } });
    if (!collection) throw new HttpError(404, "Signature collection not found");
    if (collection.status === SignatureCollectionStatus.ARCHIVED) throw new HttpError(409, "Archived signature collections are read-only");
    if (collection.collectionVersion !== input.expectedCollectionVersion) throw new HttpError(409, "Collection changed since this form was opened");
    const member = await tx.signatureMember.findFirst({ where: { id: input.memberId, collectionId: input.collectionId }, select: { id: true, required: true, roleGroup: true } });
    if (!member) throw new HttpError(404, "Signature member not found");
    if (member.roleGroup === SignatureMemberGroup.PLAYER && !input.required) {
      throw new HttpError(400, "Players always require a signature");
    }
    await tx.signatureMember.update({ where: { id: member.id }, data: { required: input.required } });
    const updated = await tx.signatureCollection.update({ where: { id: input.collectionId }, data: { collectionVersion: { increment: 1 }, updatedById: input.actor.id }, select: { collectionVersion: true } });
    await createAuditEntryTx(tx, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "SignatureMember",
      entityId: member.id,
      action: "UPDATE_REQUIRED",
      before: { required: member.required, collectionVersion: input.expectedCollectionVersion },
      after: { required: input.required, collectionVersion: updated.collectionVersion },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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

export async function removeSignatureCapture(input: {
  actor: Actor;
  collectionId: string;
  memberId: string;
  expectedCaptureVersion: number;
}) {
  const target = await resolveSignatureCaptureTarget(input.collectionId, input.memberId);
  const result = await db.$transaction(async (tx) => {
    const capture = await tx.signatureCapture.findUnique({
      where: { id: target.id },
      include: {
        currentRevision: true,
        collection: true,
        revisions: {
          where: { state: SignatureArtifactState.READY },
          select: { id: true, pngPath: true, svgPath: true },
        },
      },
    });
    if (!capture) throw new HttpError(404, "Signature member is not ready for capture");
    if (capture.collection.status === SignatureCollectionStatus.ARCHIVED) throw new HttpError(409, "Archived signature collections are read-only");
    if (capture.captureVersion !== input.expectedCaptureVersion) throw new HttpError(409, "This signature changed elsewhere; reload before removing it");
    if (!capture.currentRevision) return { revisions: [], captureVersion: capture.captureVersion };
    const revision = capture.currentRevision;
    await tx.signatureCapture.update({ where: { id: capture.id }, data: { currentRevisionId: null, captureVersion: { increment: 1 } } });
    await tx.signatureArtifactRevision.updateMany({ where: { id: { in: capture.revisions.map((item) => item.id) } }, data: { state: SignatureArtifactState.PENDING_DELETE, replacedAt: new Date() } });
    await createAuditEntryTx(tx, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "SignatureCapture",
      entityId: capture.id,
      action: "REMOVE",
      before: { captureVersion: capture.captureVersion, revisionId: revision.id, pngHash: revision.pngHash, svgHash: revision.svgHash },
      after: { captureVersion: capture.captureVersion + 1, revisionId: null },
    });
    return { revisions: capture.revisions, captureVersion: capture.captureVersion + 1 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (result.revisions.length > 0) await cleanupSignatureRevisions(result.revisions);
  return { removed: result.revisions.length > 0, captureVersion: result.captureVersion };
}

async function markSaveFailed(input: {
  actor: Actor;
  captureId: string;
  requestId: string;
  revisionId: string;
  operationId: string;
  stage: "UPLOAD" | "FINALIZE";
  error: unknown;
}) {
  const message = input.error instanceof Error ? input.error.message.slice(0, 500) : "Signature save failed";
  return db.$transaction(async (tx) => {
    await tx.signatureArtifactRevision.updateMany({ where: { id: input.revisionId, state: SignatureArtifactState.PENDING_DELETE }, data: { state: SignatureArtifactState.PENDING_DELETE, errorMessage: message } });
    const failed = await tx.signatureSaveOperation.updateMany({ where: { id: input.operationId, status: { not: SignatureSaveStatus.COMMITTED } }, data: { status: SignatureSaveStatus.FAILED, errorMessage: message } });
    if (failed.count > 0) {
      await createAuditEntryTx(tx, {
        actorId: input.actor.id,
        actorRole: input.actor.role,
        entityType: "SignatureCapture",
        entityId: input.captureId,
        action: "SAVE_FAILED",
        after: { operationId: input.operationId, requestId: input.requestId, revisionId: input.revisionId, stage: input.stage, error: message },
      });
    }
    return failed.count;
  });
}

async function cleanupSignatureRevisions(revisions: Array<{ id: string; pngPath: string; svgPath: string }>) {
  if (revisions.length === 0) return { cleaned: 0, failed: [] as typeof revisions };

  const outcomes = await mapWithConcurrency(revisions, SIGNATURE_CLEANUP_CONCURRENCY, async (revision) => {
    try {
      await deletePrivateSignatureArtifacts([revision.pngPath, revision.svgPath]);
      return { revision, cleaned: true };
    } catch {
      // Pending-delete is deliberately durable and retryable. A later cleanup
      // pass can safely attempt the same paths again.
      return { revision, cleaned: false };
    }
  });
  const cleaned = outcomes.filter((outcome) => outcome.cleaned).map((outcome) => outcome.revision);
  const failed = outcomes.filter((outcome) => !outcome.cleaned).map((outcome) => outcome.revision);
  if (cleaned.length === 0) return { cleaned: 0, failed };

  try {
    await db.signatureArtifactRevision.updateMany({
      where: { id: { in: cleaned.map((revision) => revision.id) }, state: SignatureArtifactState.PENDING_DELETE },
      data: { state: SignatureArtifactState.DELETED, deletedAt: new Date() },
    });
  } catch {
    // Blob deletion succeeded but the durable state transition did not. Keep
    // those rows retryable so the next pass can reconcile the database.
    return { cleaned: 0, failed: [...failed, ...cleaned] };
  }
  return { cleaned: cleaned.length, failed };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const run = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

export async function saveSignatureCapture(input: { actor: Actor; collectionId: string; memberId: string; request: CaptureSaveRequest }) {
  const target = await resolveSignatureCaptureTarget(input.collectionId, input.memberId);
  let existingOperation = await db.signatureSaveOperation.findUnique({ where: { requestId: input.request.requestId }, include: saveOperationInclude });
  if (existingOperation) assertSignatureSaveOperationTarget(existingOperation, { actor: input.actor, target, request: input.request });
  if (existingOperation?.status === SignatureSaveStatus.COMMITTED) return committedSignatureSave(existingOperation);
  if (existingOperation?.status === SignatureSaveStatus.FAILED) {
    throw new HttpError(409, "This save request failed; try saving again");
  }
  if (existingOperation && !isStaleSignatureSave(existingOperation)) {
    throw new HttpError(425, "This signature is still saving; try again shortly");
  }

  if (target.collection.status === SignatureCollectionStatus.ARCHIVED) throw new HttpError(409, "Archived signature collections are read-only");
  if (target.captureVersion !== input.request.expectedCaptureVersion) throw new HttpError(409, STALE_SIGNATURE_CAPTURE_MESSAGE);
  if (target.collection.settingsVersion !== input.request.settingsVersion) throw new HttpError(409, "Pen settings changed; reload the capture surface");
  const settings = penSettingsSchema.parse(target.collection.penSettings);
  let artifacts: Awaited<ReturnType<typeof renderSignatureArtifacts>>;
  try {
    artifacts = await renderSignatureArtifacts(input.request.strokes, settings);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Signature")) {
      throw new HttpError(400, error.message);
    }
    throw new HttpError(503, "Signature rendering is temporarily unavailable");
  }
  let revisionId = existingOperation?.revision?.id ?? randomUUID();
  const pngPath = existingOperation?.revision?.pngPath ?? buildSignatureArtifactPath(target.collectionId, target.memberId, revisionId, "png");
  const svgPath = existingOperation?.revision?.svgPath ?? buildSignatureArtifactPath(target.collectionId, target.memberId, revisionId, "svg");

  if (existingOperation) {
    if (!existingOperation.revision) throw new HttpError(503, "This signature save cannot be recovered yet");
    if (existingOperation.revision.pngHash !== artifacts.pngHash || existingOperation.revision.svgHash !== artifacts.svgHash) {
      throw new HttpError(409, "This save request ID belongs to a different signature draft");
    }
    const claimed = await db.signatureSaveOperation.updateMany({
      where: { id: existingOperation.id, status: existingOperation.status, updatedAt: existingOperation.updatedAt },
      data: { status: existingOperation.status },
    });
    if (claimed.count === 0) {
      const winner = await db.signatureSaveOperation.findUnique({ where: { requestId: input.request.requestId }, include: saveOperationInclude });
      if (winner) {
        assertSignatureSaveOperationTarget(winner, { actor: input.actor, target, request: input.request });
        if (winner.status === SignatureSaveStatus.COMMITTED) return committedSignatureSave(winner);
      }
      throw new HttpError(425, "This signature is still saving; try again shortly");
    }
    existingOperation = { ...existingOperation, updatedAt: new Date() };
  }

  let operationId = existingOperation?.id;
  if (!operationId) try {
    const prepared = await withSerializationRetry(() => db.$transaction(async (tx) => {
      const current = await tx.signatureCapture.findUnique({ where: { id: target.id }, select: { captureVersion: true, collectionId: true, memberId: true, settingsVersion: true } });
      if (!current || current.collectionId !== target.collectionId || current.memberId !== target.memberId || current.captureVersion !== input.request.expectedCaptureVersion || current.settingsVersion !== input.request.settingsVersion) throw new HttpError(409, STALE_SIGNATURE_CAPTURE_MESSAGE);
      const latest = await tx.signatureArtifactRevision.findFirst({ where: { captureId: target.id }, orderBy: { revision: "desc" }, select: { revision: true } });
      const revision = await tx.signatureArtifactRevision.create({ data: { id: revisionId, captureId: target.id, revision: (latest?.revision ?? 0) + 1, state: SignatureArtifactState.PENDING_DELETE, pngPath, svgPath, pngHash: artifacts.pngHash, svgHash: artifacts.svgHash, width: artifacts.width, height: artifacts.height, cropBounds: signatureJson(artifacts.cropBounds) } });
      const operation = await tx.signatureSaveOperation.create({ data: { requestId: input.request.requestId, collectionId: target.collectionId, memberId: target.memberId, captureId: target.id, expectedCaptureVersion: input.request.expectedCaptureVersion, settingsVersion: input.request.settingsVersion, status: SignatureSaveStatus.UPLOADING, revisionId: revision.id, actorUserId: input.actor.id } });
      return { operationId: operation.id, revisionId: revision.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    operationId = prepared.operationId;
    revisionId = prepared.revisionId;
  } catch (error) {
    if (isPrismaUniqueConflict(error)) {
      const winner = await db.signatureSaveOperation.findUnique({ where: { requestId: input.request.requestId }, include: saveOperationInclude });
      if (winner) {
        assertSignatureSaveOperationTarget(winner, { actor: input.actor, target, request: input.request });
        if (winner.status === SignatureSaveStatus.COMMITTED) return committedSignatureSave(winner);
        if (winner.status === SignatureSaveStatus.FAILED) throw new HttpError(409, "This save request failed; try saving again");
      }
      throw new HttpError(425, "Another save is already processing this signature; retry this same save shortly");
    }
    if (isSerializationConflict(error)) {
      throw new HttpError(425, "Another save is settling this signature; retry this same save shortly");
    }
    throw error;
  }

  if (!existingOperation || existingOperation.status === SignatureSaveStatus.UPLOADING) {
    try {
      await uploadPrivateSignatureArtifact({ path: pngPath, body: artifacts.png, contentType: "image/png", allowOverwrite: Boolean(existingOperation) });
      await uploadPrivateSignatureArtifact({ path: svgPath, body: Buffer.from(artifacts.svg, "utf8"), contentType: "image/svg+xml", allowOverwrite: Boolean(existingOperation) });
      const finalizedForCommit = await db.signatureSaveOperation.updateMany({
        where: { id: operationId, status: SignatureSaveStatus.UPLOADING },
        data: { status: SignatureSaveStatus.FINALIZING },
      });
      if (finalizedForCommit.count === 0) {
        // Delete/reset can fail this operation while the Blob uploads are in
        // flight. The row may be gone by now, so the uploader must fence itself
        // and remove the paths it just created instead of relying on the DB row
        // for later cleanup.
        try { await deletePrivateSignatureArtifacts([pngPath, svgPath]); } catch { /* pending cleanup owns retry when the row still exists */ }
        throw new HttpError(409, "This signature save was cancelled; return to the roster before trying again");
      }
    } catch (error) {
      if (error instanceof HttpError && error.status === 409 && error.message === "This signature save was cancelled; return to the roster before trying again") {
        throw error;
      }
      const failedCount = await markSaveFailed({ actor: input.actor, captureId: target.id, requestId: input.request.requestId, revisionId, operationId, stage: "UPLOAD", error });
      // If the status update failed after the finalizer committed, the
      // operation is already the current capture. Never delete those paths
      // based on an ambiguous upload/finalization response.
      if (failedCount > 0) {
        try { await deletePrivateSignatureArtifacts([pngPath, svgPath]); } catch { /* durable pending-delete retry owns recovery */ }
      }
      throw new HttpError(503, "Signature files could not be stored; the existing signature was kept");
    }
  }

  let finalized: Awaited<ReturnType<typeof finalizeSignatureSave>>;
  try {
    finalized = await withSerializationRetry(
      () => finalizeSignatureSave({
        actor: input.actor,
        collectionId: target.collectionId,
        captureId: target.id,
        operationId,
        revisionId,
        expectedCaptureVersion: input.request.expectedCaptureVersion,
        settingsVersion: input.request.settingsVersion,
      }),
    );
  } catch (error) {
    if (!isSerializationConflict(error) && !(error instanceof HttpError && error.status === 425)) {
      await markSaveFailed({ actor: input.actor, captureId: target.id, requestId: input.request.requestId, revisionId, operationId, stage: "FINALIZE", error });
    }
    if (isSerializationConflict(error)) {
      throw new HttpError(425, "Another save is settling this signature; retry this same save shortly");
    }
    throw error;
  }

  return { status: "committed" as const, captureVersion: finalized.captureVersion, revision: publicArtifact(finalized.revision) };
}

async function finalizeSignatureSave(input: {
  actor: Actor;
  collectionId: string;
  captureId: string;
  operationId: string;
  revisionId: string;
  expectedCaptureVersion: number;
  settingsVersion: number;
}) {
  return db.$transaction(async (tx) => {
      const operation = await tx.signatureSaveOperation.findUnique({ where: { id: input.operationId }, include: { revision: true, capture: { select: { captureVersion: true } } } });
      if (!operation || operation.captureId !== input.captureId || operation.revisionId !== input.revisionId) {
        throw new HttpError(409, "This signature save operation changed while finalizing");
      }
      if (operation.status === SignatureSaveStatus.COMMITTED) {
        const revision = operation.revision ? publicArtifact(operation.revision) : null;
        if (!revision || !operation.revision) throw new HttpError(503, "The committed signature artifact is temporarily unavailable");
        return { captureVersion: operation.capture.captureVersion, revision: operation.revision };
      }
      if (operation.status === SignatureSaveStatus.FAILED) {
        throw new HttpError(409, "This save request failed; try saving again");
      }
      if (operation.status !== SignatureSaveStatus.FINALIZING) {
        throw new HttpError(425, "This signature is still uploading; try again shortly");
      }
      const current = await tx.signatureCapture.findUnique({ where: { id: input.captureId }, include: { currentRevision: true, collection: true, member: true } });
      if (!current || !current.member.active || current.captureVersion !== input.expectedCaptureVersion || current.settingsVersion !== input.settingsVersion || current.collection.status === SignatureCollectionStatus.ARCHIVED) {
        throw new HttpError(409, STALE_SIGNATURE_CAPTURE_MESSAGE);
      }
      if (current.currentRevisionId) {
        await tx.signatureArtifactRevision.update({ where: { id: current.currentRevisionId }, data: { replacedAt: new Date() } });
      }
      const now = new Date();
      const revision = await tx.signatureArtifactRevision.update({ where: { id: input.revisionId }, data: { state: SignatureArtifactState.READY, committedAt: now } });
      const capture = await tx.signatureCapture.update({ where: { id: input.captureId }, data: { currentRevisionId: revision.id, captureVersion: { increment: 1 }, capturedAt: now, capturedById: input.actor.id }, select: { captureVersion: true } });
      await tx.signatureCollection.updateMany({ where: { id: input.collectionId, firstCaptureAt: null }, data: { firstCaptureAt: now, updatedById: input.actor.id } });
      await tx.signatureSaveOperation.update({ where: { id: input.operationId }, data: { status: SignatureSaveStatus.COMMITTED, committedAt: now } });
      await createAuditEntryTx(tx, { actorId: input.actor.id, actorRole: input.actor.role, entityType: "SignatureCapture", entityId: input.captureId, action: "SAVE", before: { captureVersion: input.expectedCaptureVersion, priorRevisionId: current.currentRevisionId, priorPngHash: current.currentRevision?.pngHash ?? null, priorSvgHash: current.currentRevision?.svgHash ?? null }, after: { captureVersion: capture.captureVersion, operationId: input.operationId, requestId: operation.requestId, revisionId: revision.id, pngHash: revision.pngHash, svgHash: revision.svgHash, width: revision.width, height: revision.height } });
      return { captureVersion: capture.captureVersion, revision };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

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
  if (!usedNames.has(initial)) {
    usedNames.add(initial);
    return initial;
  }
  const stem = initial.slice(0, -(format.length + 1));
  let suffix = 2;
  let candidate = `${stem}_${suffix}.${format}`;
  while (usedNames.has(candidate)) {
    suffix += 1;
    candidate = `${stem}_${suffix}.${format}`;
  }
  usedNames.add(candidate);
  return candidate;
}

async function readSignatureZipEntry(entry: { name: string; path: string }): Promise<StoredZipEntry> {
  const blob = await getPrivateSignatureArtifact(entry.path);
  if (!blob) throw new HttpError(503, "A committed signature file is temporarily unavailable; try again shortly");
  return {
    name: entry.name,
    data: new Uint8Array(await new Response(blob.stream).arrayBuffer()),
  };
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
      currentRevision: { is: { state: SignatureArtifactState.READY } },
    },
    select: {
      member: { select: { linkedUserId: true } },
      currentRevision: { select: { state: true, pngPath: true, svgPath: true } },
    },
  });
  const canonicalByUserId = new Map(canonicalCaptures
    .filter((capture) => capture.member.linkedUserId && capture.currentRevision?.state === SignatureArtifactState.READY)
    .map((capture) => [capture.member.linkedUserId as string, capture.currentRevision as { state: SignatureArtifactState; pngPath: string; svgPath: string }]));

  const usedNames = new Set<string>();
  const fileEntries = members
    .map((member) => {
      const revision = member.linkedUserId
        ? canonicalByUserId.get(member.linkedUserId) ?? member.capture?.currentRevision
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
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= fileEntries.length) return;
      const entry = fileEntries[index];
      if (!entry) return;
      zipEntries[index] = await readSignatureZipEntry(entry);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SIGNATURE_ZIP_READ_CONCURRENCY, fileEntries.length) }, () => worker()));

  const totalBytes = zipEntries.reduce((total, entry) => total + entry.data.byteLength, 0);
  if (totalBytes > SIGNATURE_ZIP_MAX_BYTES) throw new HttpError(413, "The signature export is too large to download as one ZIP");

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
      saveOperations: { none: { status: { in: [SignatureSaveStatus.UPLOADING, SignatureSaveStatus.FINALIZING, SignatureSaveStatus.COMMITTED] } } },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, pngPath: true, svgPath: true },
  });
  const cleanup = await cleanupSignatureRevisions(revisions);
  return { abandoned: abandoned.count, attempted: revisions.length, deleted: cleanup.cleaned };
}
