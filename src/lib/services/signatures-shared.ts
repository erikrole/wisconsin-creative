import {
  Prisma,
  SignatureArtifactState,
  SignatureCollectionStatus,
  SignatureMemberGroup,
  SignatureSaveStatus,
  SignatureSnapshotStatus,
  Role,
} from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import {
  SIGNATURE_CREATIVE_STAFF_SPORT_CODE,
  SIGNATURE_MBB_SPORT_CODE,
  getSignatureRosterSourceConfig,
  isRequiredSignatureGroup,
  isStandaloneSignatureCollection,
  isStandaloneStaffSignatureCollection,
  type CaptureSaveRequest,
  type SignatureRosterEntry,
} from "@/lib/signatures/types";
import { deletePrivateSignatureArtifacts } from "@/lib/signatures/storage";

export const signatureJson = (value: unknown) => value as Prisma.InputJsonValue;

export type Actor = { id: string; role: Role };

export const CREATIVE_STAFF_SOURCE_PREFIX = "creative-staff:";

const SIGNATURE_SAVE_STALE_MS = 60_000;

export const SIGNATURE_ZIP_MAX_ENTRIES = 1_000;

export const SIGNATURE_ZIP_MAX_BYTES = 50 * 1024 * 1024;

export const SIGNATURE_ZIP_READ_CONCURRENCY = 8;

const SIGNATURE_CLEANUP_CONCURRENCY = 8;

export const SIGNATURE_DETAIL_PRIOR_REVISION_LIMIT = 5;

export const SIGNATURE_ROSTER_APPLY_MAX_WAIT_MS = 10_000;

export const SIGNATURE_ROSTER_APPLY_TIMEOUT_MS = 30_000;

export const STALE_SIGNATURE_CAPTURE_MESSAGE = "This person was already signed or changed on another iPad; this iPad's draft was kept. Return to the roster before trying again";

const CREATIVE_STAFF_TITLE_MARKERS = ["Creative", "Digital Media"] as const;

export const creativeStaffTitleFilters = CREATIVE_STAFF_TITLE_MARKERS.map((marker) => ({
  title: { contains: marker, mode: "insensitive" as const },
}));

export const signatureRosterApplyCaptureSelect = {
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

export const signatureRosterApplyMemberSelect = {
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
  sourceSnapshotId: true,
  capture: { select: signatureRosterApplyCaptureSelect },
} satisfies Prisma.SignatureMemberSelect;

export type SignatureRosterApplyMember = Prisma.SignatureMemberGetPayload<{ select: typeof signatureRosterApplyMemberSelect }>;

export type SignatureRosterApplyCapture = Prisma.SignatureCaptureGetPayload<{ select: typeof signatureRosterApplyCaptureSelect }>;

export type SignatureRosterMergePlan = {
  source: SignatureRosterApplyMember;
  targetMemberId: string;
  targetSourceExternalId: string;
};

export type SignatureRosterMergeResult = {
  sourceMemberId: string;
  sourceExternalId: string;
  targetMemberId: string;
  targetSourceExternalId: string;
  artifactTransferred: boolean;
  transferredRevisionCount: number;
};

export function signatureRosterPlayerIdentityKey(member: Pick<SignatureRosterApplyMember, "normalizedName" | "roleGroup"> | SignatureRosterEntry) {
  if (member.roleGroup !== SignatureMemberGroup.PLAYER || !member.normalizedName) return null;
  return `${member.roleGroup}:${member.normalizedName}`;
}

export function findHighConfidenceHistoricalRosterMember(
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

// A player added by staff (no source snapshot) who later appears on the
// official roster under a new source ID is adopted rather than duplicated.
export function findUnofficialRosterMemberToAdopt(
  existing: SignatureRosterApplyMember[],
  entry: SignatureRosterEntry,
  incomingIdentityCounts: Map<string, number>,
  adoptedMemberIds: Set<string>,
) {
  const identityKey = signatureRosterPlayerIdentityKey(entry);
  if (!identityKey || incomingIdentityCounts.get(identityKey) !== 1) return null;
  const matches = existing.filter((member) => (
    member.active
    && member.sourceSnapshotId === null
    && !adoptedMemberIds.has(member.id)
    && signatureRosterPlayerIdentityKey(member) === identityKey
  ));
  return matches.length === 1 ? matches[0]! : null;
}

export function isBlankSignatureRosterCapture(capture: SignatureRosterApplyCapture | null) {
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

export function canDonateSignatureRosterCapture(capture: SignatureRosterApplyCapture | null) {
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

export function publicArtifact(revision: {
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

export type PublicSignatureArtifact = NonNullable<ReturnType<typeof publicArtifact>>;

export type SignatureCompletenessMember = { active: boolean; artifactReady: boolean };

export function collectionCompleteness(members: SignatureCompletenessMember[], emptyPercent = 100) {
  const activeMembers = members.filter((member) => member.active);
  const complete = activeMembers.filter((member) => member.artifactReady);
  return {
    complete: complete.length,
    required: activeMembers.length,
    percent: activeMembers.length === 0 ? emptyPercent : Math.round((complete.length / activeMembers.length) * 100),
  };
}

export const collectionInclude = {
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
              saveOperations: true,
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

export const canonicalDetailCaptureInclude = {
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

export type CanonicalSignatureCapture = Prisma.SignatureCaptureGetPayload<{ include: typeof canonicalCaptureInclude }>;

export type CanonicalSignatureDetailCapture = Prisma.SignatureCaptureGetPayload<{ include: typeof canonicalDetailCaptureInclude }>;

export const saveOperationInclude = {
  revision: true,
  capture: { include: { currentRevision: true } },
} satisfies Prisma.SignatureSaveOperationInclude;

export type SignatureSaveOperationWithRevision = Prisma.SignatureSaveOperationGetPayload<{ include: typeof saveOperationInclude }>;

export function assertSignatureSaveOperationTarget(
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

export function committedSignatureSave(operation: SignatureSaveOperationWithRevision) {
  const revision = operation.revision ? publicArtifact(operation.revision) : null;
  if (!revision) throw new HttpError(503, "The committed signature artifact is temporarily unavailable");
  return {
    status: "committed" as const,
    captureVersion: operation.capture.captureVersion,
    revision,
  };
}

export function isStaleSignatureSave(operation: Pick<SignatureSaveOperationWithRevision, "updatedAt">, now = Date.now()) {
  return operation.updatedAt.getTime() <= now - SIGNATURE_SAVE_STALE_MS;
}

export function isPrismaUniqueConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

export function defaultImportedMemberRequired(sportCode: string, roleGroup: SignatureMemberGroup) {
  const source = getSignatureRosterSourceConfig(sportCode || SIGNATURE_MBB_SPORT_CODE);
  return source.requiredByDefault === true || isRequiredSignatureGroup(roleGroup);
}

export async function resolveSignatureCaptureTarget(collectionId: string, memberId: string, allowInactive = false) {
  const requested = await db.signatureCapture.findFirst({
    where: { collectionId, memberId },
    include: canonicalCaptureInclude,
  });
  if (!requested) throw new HttpError(404, "Signature member is not ready for capture");
  if (!requested.member.active && !allowInactive) throw new HttpError(409, "This roster member is inactive and cannot receive a new signature");
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

export function visibleSignatureMembers<T extends { roleGroup: SignatureMemberGroup }>(sportCode: string, members: T[]) {
  if (sportCode === SIGNATURE_CREATIVE_STAFF_SPORT_CODE) {
    return members.filter((member) => member.roleGroup === SignatureMemberGroup.CREATIVE_STAFF);
  }
  if (isStandaloneStaffSignatureCollection(sportCode)) {
    return members.filter((member) => member.roleGroup === SignatureMemberGroup.SUPPORT_STAFF);
  }
  return members.filter((member) => member.roleGroup !== SignatureMemberGroup.CREATIVE_STAFF);
}

export function isTeamSignatureCollection(sportCode: string) {
  return !isStandaloneSignatureCollection(sportCode);
}

export function primarySignatureMembers<T extends { active: boolean; required: boolean; roleGroup: SignatureMemberGroup }>(sportCode: string, members: T[]) {
  return isTeamSignatureCollection(sportCode)
    ? members.filter((member) => member.active && member.roleGroup === SignatureMemberGroup.PLAYER)
    : members.filter((member) => member.active && member.required);
}

export function staffSignatureMembers<T extends { active: boolean; roleGroup: SignatureMemberGroup }>(sportCode: string, members: T[]) {
  return isTeamSignatureCollection(sportCode)
    ? members.filter((member) => member.active && member.roleGroup !== SignatureMemberGroup.PLAYER)
    : [];
}

export async function cleanupSignatureRevisions(revisions: Array<{ id: string; pngPath: string; svgPath: string }>) {
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
