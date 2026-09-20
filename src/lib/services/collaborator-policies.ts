import {
  BookingKind,
  BookingStatus,
  CollaboratorPolicyStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import {
  COLLABORATOR_CAPABILITY_CATALOG,
  normalizeCollaboratorCapabilities,
  type CollaboratorCapability,
} from "@/lib/collaborator-access";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";

const collaboratorPolicyInclude = {
  affiliation: true,
  grants: { orderBy: { capabilityKey: "asc" as const } },
} satisfies Prisma.CollaboratorPolicyInclude;

export const collaboratorPolicyActorSelect = {
  id: true,
  status: true,
  version: true,
  affiliation: {
    select: { key: true, displayName: true, badgeLabel: true },
  },
  grants: { select: { capabilityKey: true } },
} satisfies Prisma.CollaboratorPolicySelect;

type PolicyWithIdentity = Prisma.CollaboratorPolicyGetPayload<{
  include: typeof collaboratorPolicyInclude;
}>;

type PolicyActor = { id: string; role: Role };

function stableAffiliationKey(displayName: string) {
  const key = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (key.length < 2) throw new HttpError(400, "Affiliation name cannot produce a stable key");
  return key;
}

function validateIdentity(displayName: string, badgeLabel: string) {
  const name = displayName.trim();
  const badge = badgeLabel.trim();
  if (name.length < 1 || name.length > 80) throw new HttpError(400, "Affiliation name must be 1 to 80 characters");
  if (badge.length < 2 || badge.length > 12) throw new HttpError(400, "Badge must be 2 to 12 characters");
  return { displayName: name, badgeLabel: badge };
}

function serializePolicy(policy: PolicyWithIdentity) {
  return {
    id: policy.id,
    status: policy.status,
    version: policy.version,
    capabilities: policy.grants.map((grant) => grant.capabilityKey).filter((key): key is CollaboratorCapability =>
      COLLABORATOR_CAPABILITY_CATALOG.some((entry) => entry.key === key),
    ),
    affiliation: {
      id: policy.affiliation.id,
      key: policy.affiliation.key,
      displayName: policy.affiliation.displayName,
      badgeLabel: policy.affiliation.badgeLabel,
      archivedAt: policy.affiliation.archivedAt,
    },
    updatedAt: policy.updatedAt,
  };
}

export async function listCollaboratorPolicies() {
  const policies = await db.collaboratorPolicy.findMany({
    where: { affiliation: { archivedAt: null } },
    include: collaboratorPolicyInclude,
    orderBy: { affiliation: { displayName: "asc" } },
  });
  const policyIds = policies.map((policy) => policy.id);
  const [users, pendingInvites, bookingGroups] = policyIds.length === 0
    ? [[], [], []] as const
    : await Promise.all([
        db.user.groupBy({
          by: ["collaboratorPolicyId"],
          where: { role: Role.COLLABORATOR, active: true, collaboratorPolicyId: { in: policyIds } },
          _count: { _all: true },
        }),
        db.allowedEmail.groupBy({
          by: ["collaboratorPolicyId"],
          where: { claimedAt: null, collaboratorPolicyId: { in: policyIds } },
          _count: { _all: true },
        }),
        db.booking.groupBy({
          by: ["requesterUserId", "kind"],
          where: {
            requester: { collaboratorPolicyId: { in: policyIds } },
            status: { in: [BookingStatus.BOOKED, BookingStatus.PENDING_PICKUP, BookingStatus.OPEN] },
          },
          _count: { _all: true },
        }),
      ]);
  const policyUsers = await db.user.findMany({
    where: { collaboratorPolicyId: { in: policyIds } },
    select: { id: true, collaboratorPolicyId: true },
  });
  const policyByUser = new Map(policyUsers.map((user) => [user.id, user.collaboratorPolicyId]));
  const obligations = new Map<string, { reservations: number; checkouts: number }>();
  for (const group of bookingGroups) {
    const policyId = policyByUser.get(group.requesterUserId);
    if (!policyId) continue;
    const current = obligations.get(policyId) ?? { reservations: 0, checkouts: 0 };
    if (group.kind === BookingKind.RESERVATION) current.reservations += group._count._all;
    else current.checkouts += group._count._all;
    obligations.set(policyId, current);
  }
  const userCounts = new Map(users.map((row) => [row.collaboratorPolicyId, row._count._all]));
  const inviteCounts = new Map(pendingInvites.map((row) => [row.collaboratorPolicyId, row._count._all]));
  return policies.map((policy) => ({
    ...serializePolicy(policy),
    counts: {
      activeUsers: userCounts.get(policy.id) ?? 0,
      pendingInvites: inviteCounts.get(policy.id) ?? 0,
      activeReservations: obligations.get(policy.id)?.reservations ?? 0,
      activeCheckouts: obligations.get(policy.id)?.checkouts ?? 0,
    },
  }));
}

export async function getCollaboratorPolicy(policyId: string) {
  const policy = await db.collaboratorPolicy.findUnique({
    where: { id: policyId },
    include: collaboratorPolicyInclude,
  });
  if (!policy || policy.affiliation.archivedAt) throw new HttpError(404, "Collaborator policy not found");
  const [summary] = (await listCollaboratorPolicies()).filter((entry) => entry.id === policyId);
  return summary ?? { ...serializePolicy(policy), counts: { activeUsers: 0, pendingInvites: 0, activeReservations: 0, activeCheckouts: 0 } };
}

export async function createCollaboratorAffiliation(input: {
  actor: PolicyActor;
  displayName: string;
  badgeLabel: string;
}) {
  const identity = validateIdentity(input.displayName, input.badgeLabel);
  const key = stableAffiliationKey(identity.displayName);
  try {
    return await db.$transaction(async (tx) => {
      const affiliation = await tx.collaboratorAffiliation.create({
        data: {
          key,
          ...identity,
          policy: {
            create: {
              status: CollaboratorPolicyStatus.SUSPENDED,
              version: 1,
            },
          },
        },
        include: { policy: true },
      });
      const policy = affiliation.policy!;
      await tx.collaboratorPolicyRevision.create({
        data: {
          policyId: policy.id,
          version: 1,
          status: policy.status,
          capabilities: [],
          actorUserId: input.actor.id,
        },
      });
      await createAuditEntryTx(tx, {
        actorId: input.actor.id,
        actorRole: input.actor.role,
        entityType: "collaborator_policy",
        entityId: policy.id,
        action: "created",
        after: { affiliationKey: key, ...identity, status: policy.status, capabilities: [], version: 1 },
      });
      return policy.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "An affiliation with that stable key already exists");
    }
    throw error;
  }
}

export async function previewCollaboratorPolicyChange(input: {
  policyId: string;
  status?: CollaboratorPolicyStatus;
  capabilities?: readonly string[];
}) {
  const current = await getCollaboratorPolicy(input.policyId);
  const capabilities = input.capabilities
    ? normalizeCollaboratorCapabilities(input.capabilities)
    : current.capabilities;
  const status = input.status ?? current.status;
  const removed = current.capabilities.filter((capability) => !capabilities.includes(capability));
  const added = capabilities.filter((capability) => !current.capabilities.includes(capability));
  const suspension = current.status === CollaboratorPolicyStatus.ACTIVE && status === CollaboratorPolicyStatus.SUSPENDED;
  return {
    currentVersion: current.version,
    status,
    capabilities,
    added,
    removed,
    adjustments: input.capabilities
      ? capabilities.filter((capability) => !input.capabilities!.includes(capability))
      : [],
    counts: current.counts,
    requiresConfirmation: suspension || removed.length > 0,
  };
}

export async function updateCollaboratorPolicy(input: {
  actor: PolicyActor;
  policyId: string;
  expectedVersion: number;
  displayName?: string;
  badgeLabel?: string;
  status?: CollaboratorPolicyStatus;
  capabilities?: readonly string[];
  acknowledgeRisk?: boolean;
  action?: "updated" | "restored";
}) {
  return db.$transaction(async (tx) => {
    const current = await tx.collaboratorPolicy.findUnique({
      where: { id: input.policyId },
      include: collaboratorPolicyInclude,
    });
    if (!current || current.affiliation.archivedAt) throw new HttpError(404, "Collaborator policy not found");
    if (current.version !== input.expectedVersion) throw new HttpError(409, "Policy changed since it was loaded");

    const beforeCapabilities = current.grants.map((grant) => grant.capabilityKey).filter((key): key is CollaboratorCapability =>
      COLLABORATOR_CAPABILITY_CATALOG.some((entry) => entry.key === key),
    );
    const capabilities = input.capabilities
      ? normalizeCollaboratorCapabilities(input.capabilities)
      : beforeCapabilities;
    const status = input.status ?? current.status;
    if (status === CollaboratorPolicyStatus.ACTIVE && capabilities.length === 0) {
      throw new HttpError(400, "An active affiliation must have at least one capability");
    }
    const removed = beforeCapabilities.filter((capability) => !capabilities.includes(capability));
    const suspension = current.status === CollaboratorPolicyStatus.ACTIVE && status === CollaboratorPolicyStatus.SUSPENDED;
    if ((removed.length > 0 || suspension) && !input.acknowledgeRisk) {
      throw new HttpError(409, "This policy change requires risk acknowledgement", {
        removed,
        suspension,
      });
    }

    const nextIdentity = validateIdentity(
      input.displayName ?? current.affiliation.displayName,
      input.badgeLabel ?? current.affiliation.badgeLabel,
    );
    const nextVersion = current.version + 1;
    const updated = await tx.collaboratorPolicy.updateMany({
      where: { id: current.id, version: current.version },
      data: { status, version: nextVersion },
    });
    if (updated.count !== 1) throw new HttpError(409, "Policy changed since it was loaded");

    await tx.collaboratorAffiliation.update({
      where: { id: current.affiliationId },
      data: nextIdentity,
    });
    await tx.collaboratorPolicyGrant.deleteMany({ where: { policyId: current.id } });
    if (capabilities.length > 0) {
      await tx.collaboratorPolicyGrant.createMany({
        data: capabilities.map((capabilityKey) => ({ policyId: current.id, capabilityKey })),
      });
    }
    await tx.collaboratorPolicyRevision.create({
      data: {
        policyId: current.id,
        version: nextVersion,
        status,
        capabilities,
        actorUserId: input.actor.id,
      },
    });
    await createAuditEntryTx(tx, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "collaborator_policy",
      entityId: current.id,
      action: input.action ?? "updated",
      before: {
        displayName: current.affiliation.displayName,
        badgeLabel: current.affiliation.badgeLabel,
        status: current.status,
        capabilities: beforeCapabilities,
        version: current.version,
      },
      after: { ...nextIdentity, status, capabilities, version: nextVersion },
    });

    if (removed.length > 0 || suspension) {
      const users = await tx.user.findMany({
        where: { collaboratorPolicyId: current.id, active: true },
        select: { id: true },
      });
      if (users.length > 0) {
        await tx.notification.createMany({
          data: users.map((user) => ({
            userId: user.id,
            type: suspension ? "collaborator_affiliation_suspended" : "collaborator_policy_reduced",
            title: suspension ? "Affiliation access suspended" : "Collaborator access changed",
            body: suspension
              ? `${nextIdentity.displayName} access has been suspended by an administrator.`
              : "An administrator changed the features available to your affiliation.",
            payload: { policyId: current.id, version: nextVersion, removed },
            dedupeKey: `collaborator_policy:${current.id}:${nextVersion}:${user.id}`,
          })),
          skipDuplicates: true,
        });
      }
    }
    return nextVersion;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function listCollaboratorPolicyHistory(policyId: string) {
  const policy = await db.collaboratorPolicy.findUnique({ where: { id: policyId }, select: { id: true } });
  if (!policy) throw new HttpError(404, "Collaborator policy not found");
  return db.collaboratorPolicyRevision.findMany({
    where: { policyId },
    orderBy: { version: "desc" },
    include: { actor: { select: { id: true, name: true } } },
  });
}

export async function restoreCollaboratorPolicy(input: {
  actor: PolicyActor;
  policyId: string;
  revisionId: string;
  expectedVersion: number;
  acknowledgeRisk?: boolean;
}) {
  const revision = await db.collaboratorPolicyRevision.findFirst({
    where: { id: input.revisionId, policyId: input.policyId },
  });
  if (!revision) throw new HttpError(404, "Policy revision not found");
  if (!Array.isArray(revision.capabilities) || !revision.capabilities.every((value) => typeof value === "string")) {
    throw new HttpError(500, "Policy revision is invalid");
  }
  return updateCollaboratorPolicy({
    actor: input.actor,
    policyId: input.policyId,
    expectedVersion: input.expectedVersion,
    status: revision.status,
    capabilities: revision.capabilities,
    acknowledgeRisk: input.acknowledgeRisk,
    action: "restored",
  });
}

export async function archiveCollaboratorAffiliation(input: {
  actor: PolicyActor;
  policyId: string;
  expectedVersion: number;
}) {
  return db.$transaction(async (tx) => {
    const policy = await tx.collaboratorPolicy.findUnique({
      where: { id: input.policyId },
      include: { affiliation: true },
    });
    if (!policy || policy.affiliation.archivedAt) throw new HttpError(404, "Collaborator policy not found");
    if (policy.version !== input.expectedVersion) throw new HttpError(409, "Policy changed since it was loaded");
    if (policy.status !== CollaboratorPolicyStatus.SUSPENDED) throw new HttpError(400, "Suspend the affiliation before archiving it");
    const [activeUsers, pendingInvites] = await Promise.all([
      tx.user.count({ where: { collaboratorPolicyId: policy.id, active: true } }),
      tx.allowedEmail.count({ where: { collaboratorPolicyId: policy.id, claimedAt: null } }),
    ]);
    if (activeUsers > 0 || pendingInvites > 0) {
      throw new HttpError(409, "Deactivate collaborators and remove pending invitations before archiving");
    }
    await tx.collaboratorAffiliation.update({
      where: { id: policy.affiliationId },
      data: { archivedAt: new Date() },
    });
    await createAuditEntryTx(tx, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "collaborator_policy",
      entityId: policy.id,
      action: "archived",
      before: { archivedAt: null },
      after: { archivedAt: new Date().toISOString() },
    });
    return { archived: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
