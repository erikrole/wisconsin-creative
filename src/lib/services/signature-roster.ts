import { randomUUID } from "node:crypto";
import {
  Prisma,
  SignatureArtifactState,
  SignatureCollectionStatus,
  SignatureMemberGroup,
  SignatureSaveStatus,
  SignatureSnapshotStatus,
  ShiftArea,
} from "@prisma/client";
import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { HttpError } from "@/lib/http";
import { withSerializationRetry } from "@/lib/serialization";
import {
  DEFAULT_SIGNATURE_PEN_SETTINGS,
  SIGNATURE_AD_HOC_SPORT_CODE,
  SIGNATURE_ADMINISTRATION_SPORT_CODE,
  SIGNATURE_CREATIVE_STAFF_SPORT_CODE,
  SIGNATURE_MBB_SPORT_CODE,
  getSignatureRosterSourceConfig,
  normalizeSignatureName,
  penSettingsSchema,
  signatureAdHocMemberSchema,
  signatureTeamPlayerCreateSchema,
  signatureRosterEntrySchema,
  type SignatureImportedSportCode,
  type SignaturePenSettings,
  type SignatureRosterEntry,
} from "@/lib/signatures/types";
import {
  signatureJson,
  CREATIVE_STAFF_SOURCE_PREFIX,
  SIGNATURE_ROSTER_APPLY_MAX_WAIT_MS,
  SIGNATURE_ROSTER_APPLY_TIMEOUT_MS,
  creativeStaffTitleFilters,
  signatureRosterApplyCaptureSelect,
  signatureRosterApplyMemberSelect,
  signatureRosterPlayerIdentityKey,
  findHighConfidenceHistoricalRosterMember,
  findUnofficialRosterMemberToAdopt,
  isBlankSignatureRosterCapture,
  canDonateSignatureRosterCapture,
  defaultImportedMemberRequired,
  isTeamSignatureCollection,
  Actor,
  SignatureRosterApplyMember,
  SignatureRosterMergePlan,
  SignatureRosterMergeResult,
} from "./signatures-shared";

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
    const adoptedMemberIds = new Set<string>();
    const mergePlans: SignatureRosterMergePlan[] = [];

    for (const entry of entries) {
      let existingMember = existingBySource.get(entry.sourceExternalId);
      if (!existingMember) {
        const adopted = findUnofficialRosterMemberToAdopt(existing, entry, incomingIdentityCounts, adoptedMemberIds);
        if (adopted) {
          adoptedMemberIds.add(adopted.id);
          existingBySource.delete(adopted.sourceExternalId);
          existingBySource.set(entry.sourceExternalId, adopted);
          existingMember = adopted;
        }
      }
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
            sourceExternalId: entry.sourceExternalId,
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
          sourceSnapshotId: snapshot.id,
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
          // Staff-added unofficial players never came from a source roster, so
          // an official import has no authority to remove them.
          sourceSnapshotId: { not: null },
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

    // Roster sync writes are batched: every new member goes out in one
    // createMany, and reactivations/renames are grouped by the exact value
    // written so each distinct target costs one updateMany instead of one
    // round trip per user. Every field written before is still written.
    const memberCreates: Prisma.SignatureMemberCreateManyInput[] = [];
    const memberUpdateGroups = new Map<
      string,
      { ids: string[]; data: { name: string; normalizedName: string; title: string | null; active: true } }
    >();

    for (const user of users) {
      const current = existingByUser.get(user.id);
      if (current) {
        const needsUpdate = !current.active || current.name !== user.name || current.title !== user.title;
        if (needsUpdate) {
          const data = {
            name: user.name,
            normalizedName: normalizeSignatureName(user.name),
            title: user.title,
            active: true as const,
          };
          const key = `${data.name}\u0000${data.normalizedName}\u0000${data.title ?? ""}`;
          const group = memberUpdateGroups.get(key);
          if (group) group.ids.push(current.id);
          else memberUpdateGroups.set(key, { ids: [current.id], data });
          updated += 1;
          if (!current.active) reactivated += 1;
          changed = true;
        }
        continue;
      }

      memberCreates.push({
        collectionId: collection.id,
        sourceExternalId: `${CREATIVE_STAFF_SOURCE_PREFIX}${user.id}`,
        name: user.name,
        normalizedName: normalizeSignatureName(user.name),
        roleGroup: SignatureMemberGroup.CREATIVE_STAFF,
        title: user.title,
        required: true,
        active: true,
        linkedUserId: user.id,
      });
      added += 1;
      changed = true;
    }

    if (memberCreates.length > 0) {
      await tx.signatureMember.createMany({ data: memberCreates });
    }
    for (const group of memberUpdateGroups.values()) {
      await tx.signatureMember.updateMany({ where: { id: { in: group.ids } }, data: group.data });
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
    // One updateMany per link target instead of per member: the same person can
    // own an unlinked roster row in several sport collections for the season.
    const relinkTargets = new Map<string, string[]>();
    for (const member of teamMembers) {
      const matchedUser = uniquelyNamedUsers.get(member.normalizedName);
      if (!matchedUser || member.linkedUserId === matchedUser.id || member.linkedUserId) continue;
      const ids = relinkTargets.get(matchedUser.id);
      if (ids) ids.push(member.id);
      else relinkTargets.set(matchedUser.id, [member.id]);
    }
    for (const [linkedUserId, ids] of relinkTargets) {
      const linked = await tx.signatureMember.updateMany({
        where: { id: { in: ids }, linkedUserId: null },
        data: { linkedUserId },
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

/**
 * Remove a player from the active roster without deleting the source member
 * row or its private signature history. The separate Remove signature action
 * remains the explicit artifact-erasure boundary. A later reviewed source
 * snapshot may reactivate this member.
 */
export async function removeSignatureMemberFromRoster(input: {
  actor: Actor;
  collectionId: string;
  memberId: string;
  expectedCollectionVersion: number;
}) {
  return withSerializationRetry(() => db.$transaction(async (tx) => {
    const collection = await tx.signatureCollection.findUnique({
      where: { id: input.collectionId },
      select: { id: true, status: true, collectionVersion: true },
    });
    if (!collection) throw new HttpError(404, "Signature collection not found");
    if (collection.status === SignatureCollectionStatus.ARCHIVED) throw new HttpError(409, "Archived signature collections are read-only");
    if (collection.collectionVersion !== input.expectedCollectionVersion) throw new HttpError(409, "Collection changed since this form was opened");

    const member = await tx.signatureMember.findFirst({
      where: { id: input.memberId, collectionId: input.collectionId },
      select: {
        id: true,
        name: true,
        roleGroup: true,
        active: true,
        capture: { select: { id: true, captureVersion: true } },
      },
    });
    if (!member) throw new HttpError(404, "Signature member not found");
    if (member.roleGroup !== SignatureMemberGroup.PLAYER) throw new HttpError(400, "Only players can be removed from a team signature roster");
    if (!member.active) return { memberId: member.id, collectionVersion: collection.collectionVersion, removed: false };

    // Mark active saves failed before fencing the capture. Existing committed
    // artifacts stay private and intact; a later source import can restore the
    // row and the separate Remove signature action can erase those artifacts.
    await tx.signatureSaveOperation.updateMany({
      where: {
        collectionId: input.collectionId,
        memberId: member.id,
        status: { in: [SignatureSaveStatus.UPLOADING, SignatureSaveStatus.FINALIZING] },
      },
      data: { status: SignatureSaveStatus.FAILED, errorMessage: "Signature roster member was removed" },
    });
    await tx.signatureMember.update({ where: { id: member.id }, data: { active: false } });
    if (member.capture) {
      // Incrementing the capture version fences any request that was already in
      // flight without changing the committed signature or its revision list.
      await tx.signatureCapture.update({ where: { id: member.capture.id }, data: { captureVersion: { increment: 1 } } });
    }

    const updated = await tx.signatureCollection.update({
      where: { id: input.collectionId },
      data: { collectionVersion: { increment: 1 }, updatedById: input.actor.id },
      select: { collectionVersion: true },
    });
    await createAuditEntryTx(tx, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "SignatureMember",
      entityId: member.id,
      action: "REMOVE_FROM_ROSTER",
      before: {
        active: true,
        name: member.name,
        roleGroup: member.roleGroup,
        captureVersion: member.capture?.captureVersion ?? null,
        collectionVersion: collection.collectionVersion,
      },
      after: {
        active: false,
        captureVersion: member.capture ? member.capture.captureVersion + 1 : null,
        collectionVersion: updated.collectionVersion,
        signatureHistoryPreserved: true,
      },
    });
    return { memberId: member.id, collectionVersion: updated.collectionVersion, removed: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

async function lockOpenTeamSignatureCollection(tx: Prisma.TransactionClient, collectionId: string, expectedCollectionVersion: number) {
  const collection = await tx.signatureCollection.findUnique({
    where: { id: collectionId },
    select: { id: true, sportCode: true, season: true, status: true, collectionVersion: true, settingsVersion: true },
  });
  if (!collection) throw new HttpError(404, "Signature collection not found");
  if (collection.status === SignatureCollectionStatus.ARCHIVED) throw new HttpError(409, "Archived signature collections are read-only");
  if (collection.collectionVersion !== expectedCollectionVersion) throw new HttpError(409, "Roster changed since this form was opened. Refresh and try again.");
  return collection;
}

/**
 * Adds a player who is on the team but not on the official source roster.
 * The member has no source snapshot, so official imports never deactivate it,
 * and a later official entry with the same name adopts it instead of
 * duplicating it. A same-name player from the sport's most recent earlier
 * season seeds the source identity so the official profile still lines up.
 */
export async function addSignatureTeamPlayer(input: {
  actor: Actor;
  collectionId: string;
  name: string;
  jerseyNumber: number | null;
  expectedCollectionVersion: number;
}) {
  const parsed = signatureTeamPlayerCreateSchema.parse(input);
  const normalizedName = normalizeSignatureName(parsed.name);
  return withSerializationRetry(() => db.$transaction(async (tx) => {
    const collection = await lockOpenTeamSignatureCollection(tx, input.collectionId, parsed.expectedCollectionVersion);
    if (!isTeamSignatureCollection(collection.sportCode)) throw new HttpError(400, "Players can only be added to a team signature roster");

    const sameName = await tx.signatureMember.findMany({
      where: { collectionId: collection.id, roleGroup: SignatureMemberGroup.PLAYER, normalizedName },
      select: { id: true, active: true, capture: { select: { id: true } } },
    });
    if (sameName.some((member) => member.active)) throw new HttpError(409, `${parsed.name} is already on this roster`);

    let memberId: string;
    let reactivated = false;
    let seededFrom: { memberId: string; season: string } | null = null;
    if (sameName.length === 1) {
      // Bring back the removed row so its signature history stays attached.
      const removed = sameName[0]!;
      await tx.signatureMember.update({
        where: { id: removed.id },
        data: { active: true, required: true, name: parsed.name, jerseyNumber: parsed.jerseyNumber },
      });
      if (!removed.capture) {
        await tx.signatureCapture.create({ data: { collectionId: collection.id, memberId: removed.id, settingsVersion: collection.settingsVersion } });
      }
      memberId = removed.id;
      reactivated = true;
    } else {
      if (sameName.length > 1) throw new HttpError(409, `More than one removed ${parsed.name} exists on this roster. Ask an admin to review.`);
      const priorMatches = await tx.signatureMember.findMany({
        where: {
          normalizedName,
          roleGroup: SignatureMemberGroup.PLAYER,
          collection: { sportCode: collection.sportCode, season: { lt: collection.season } },
        },
        orderBy: { collection: { season: "desc" } },
        select: { id: true, sourceExternalId: true, sourceProfileUrl: true, collection: { select: { season: true } } },
      });
      const latestSeason = priorMatches[0]?.collection.season;
      const latest = priorMatches.filter((match) => match.collection.season === latestSeason);
      const prior = latest.length === 1 ? latest[0]! : null;
      const sourceTaken = prior
        ? await tx.signatureMember.count({ where: { collectionId: collection.id, sourceExternalId: prior.sourceExternalId } }) > 0
        : true;
      const member = await tx.signatureMember.create({
        data: {
          collectionId: collection.id,
          sourceExternalId: prior && !sourceTaken ? prior.sourceExternalId : `manual:${randomUUID()}`,
          sourceProfileUrl: prior?.sourceProfileUrl ?? null,
          name: parsed.name,
          normalizedName,
          jerseyNumber: parsed.jerseyNumber,
          roleGroup: SignatureMemberGroup.PLAYER,
          required: true,
          active: true,
        },
        select: { id: true },
      });
      await tx.signatureCapture.create({ data: { collectionId: collection.id, memberId: member.id, settingsVersion: collection.settingsVersion } });
      memberId = member.id;
      if (prior) seededFrom = { memberId: prior.id, season: prior.collection.season };
    }

    const updated = await tx.signatureCollection.update({
      where: { id: collection.id },
      data: { collectionVersion: { increment: 1 }, updatedById: input.actor.id },
      select: { collectionVersion: true },
    });
    await createAuditEntryTx(tx, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "SignatureMember",
      entityId: memberId,
      action: "ADD_UNOFFICIAL_PLAYER",
      before: { collectionVersion: collection.collectionVersion, reactivated },
      after: {
        collectionId: collection.id,
        collectionVersion: updated.collectionVersion,
        name: parsed.name,
        jerseyNumber: parsed.jerseyNumber,
        officialRoster: false,
        seededFrom,
      },
    });
    return { memberId, collectionVersion: updated.collectionVersion, reactivated, seededFrom };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

/**
 * Moves a saved signature to the person who actually signed it, keeping the
 * original immutable revisions. The whole capture row changes owner and the
 * source member gets a fresh blank capture, so no artifact is re-rendered or
 * copied. The target must be blank; a true swap is two moves through a blank
 * member, which keeps every step verifiable.
 */
export async function moveSignatureCapture(input: {
  actor: Actor;
  collectionId: string;
  memberId: string;
  targetMemberId: string;
  expectedCollectionVersion: number;
  expectedCaptureVersion: number;
}) {
  if (input.memberId === input.targetMemberId) throw new HttpError(400, "Choose a different person");
  return withSerializationRetry(() => db.$transaction(async (tx) => {
    const collection = await lockOpenTeamSignatureCollection(tx, input.collectionId, input.expectedCollectionVersion);
    const members = await tx.signatureMember.findMany({
      where: { id: { in: [input.memberId, input.targetMemberId] }, collectionId: collection.id },
      select: {
        id: true,
        name: true,
        active: true,
        linkedUserId: true,
        capture: {
          select: {
            id: true,
            captureVersion: true,
            currentRevisionId: true,
            currentRevision: { select: { id: true, state: true } },
            _count: { select: { revisions: true, saveOperations: true } },
          },
        },
      },
    });
    const source = members.find((member) => member.id === input.memberId);
    const target = members.find((member) => member.id === input.targetMemberId);
    if (!source || !target) throw new HttpError(404, "Signature member not found");
    if (source.linkedUserId || target.linkedUserId) {
      throw new HttpError(400, "Creative staff signatures are shared across rosters and can't be moved here");
    }
    const sourceCapture = source.capture;
    if (!sourceCapture?.currentRevisionId || sourceCapture.currentRevision?.state !== SignatureArtifactState.READY) {
      throw new HttpError(409, `${source.name} has no saved signature to move`);
    }
    if (sourceCapture.captureVersion !== input.expectedCaptureVersion) {
      throw new HttpError(409, `${source.name}'s signature changed since this roster loaded. Refresh and try again.`);
    }
    if (!target.active) throw new HttpError(409, `${target.name} is not active on this roster`);
    const targetCapture = target.capture;
    if (targetCapture && (targetCapture.currentRevisionId || targetCapture._count.revisions > 0 || targetCapture._count.saveOperations > 0)) {
      throw new HttpError(409, `${target.name} already has signature history. Move to a person with no signature.`);
    }
    const liveSaves = await tx.signatureSaveOperation.count({
      where: {
        captureId: sourceCapture.id,
        status: { in: [SignatureSaveStatus.UPLOADING, SignatureSaveStatus.FINALIZING] },
      },
    });
    if (liveSaves > 0) throw new HttpError(409, `A save for ${source.name} is still in progress. Try again in a moment.`);

    // member_id is unique, so the target's empty capture leaves before the
    // signed capture changes owner. It has no revisions or save operations.
    if (targetCapture) await tx.signatureCapture.delete({ where: { id: targetCapture.id } });
    await tx.signatureCapture.update({
      where: { id: sourceCapture.id },
      // Advancing the version fences any edit session still open on either person.
      data: { memberId: target.id, captureVersion: { increment: 1 } },
    });
    await tx.signatureSaveOperation.updateMany({
      where: { captureId: sourceCapture.id },
      data: { memberId: target.id },
    });
    const blank = await tx.signatureCapture.create({
      data: {
        collectionId: collection.id,
        memberId: source.id,
        settingsVersion: collection.settingsVersion,
        captureVersion: Math.max(targetCapture?.captureVersion ?? 0, sourceCapture.captureVersion) + 1,
      },
      select: { id: true },
    });
    const updated = await tx.signatureCollection.update({
      where: { id: collection.id },
      data: { collectionVersion: { increment: 1 }, updatedById: input.actor.id },
      select: { collectionVersion: true },
    });
    await createAuditEntryTx(tx, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "SignatureCapture",
      entityId: sourceCapture.id,
      action: "MOVE_SIGNATURE",
      before: {
        memberId: source.id,
        memberName: source.name,
        revisionId: sourceCapture.currentRevisionId,
        captureVersion: sourceCapture.captureVersion,
        collectionVersion: collection.collectionVersion,
      },
      after: {
        memberId: target.id,
        memberName: target.name,
        captureVersion: sourceCapture.captureVersion + 1,
        collectionVersion: updated.collectionVersion,
        sourceBlankCaptureId: blank.id,
      },
    });
    return { collectionVersion: updated.collectionVersion, memberId: source.id, targetMemberId: target.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
