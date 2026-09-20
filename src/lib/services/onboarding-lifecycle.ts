import { Affiliation, CollaboratorProfile, Prisma, Role, ShiftArea } from "@prisma/client";
import { createAuditEntries, createAuditEntry, createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { normalizeSportCode } from "@/lib/sports";
import { unique } from "@/lib/utils";

type OnboardingActor = {
  id: string;
  role: Role;
};

type InviteRole = Extract<Role, "STAFF" | "STUDENT" | "COLLABORATOR">;

type InviteProfile = {
  affiliation?: Affiliation | null;
  collaboratorProfile?: CollaboratorProfile | null;
  collaboratorPolicyId?: string | null;
  preloadedName?: string | null;
  preloadedPrimaryArea?: ShiftArea | null;
  preloadedAreas?: ShiftArea[];
  preloadedSportCodes?: string[];
};

type NormalizedInviteProfile = {
  preloadedName: string | null;
  preloadedPrimaryArea: ShiftArea | null;
  preloadedAreas: ShiftArea[];
  preloadedSportCodes: string[];
};

type AllowedEmailWithPeople = Prisma.AllowedEmailGetPayload<{
  include: {
    createdBy: { select: { id: true; name: true } };
    claimedBy: { select: { id: true; name: true } };
  };
}>;

type AllowedEmailInviteResult =
  | { skipped: false; entry: AllowedEmailWithPeople }
  | { skipped: true; email: string; role: InviteRole };

type AllowedEmailInvitePreviewStatus =
  | "ready"
  | "duplicate"
  | "existing_user"
  | "pending_invite"
  | "claimed_invite";

type AllowedEmailInvitePreviewRow = {
  email: string;
  requestedRole: InviteRole;
  requestedAffiliation?: Affiliation | null;
  requestedCollaboratorProfile?: CollaboratorProfile | null;
  requestedCollaboratorPolicyId?: string | null;
  requestedName?: string | null;
  requestedPrimaryArea?: ShiftArea | null;
  requestedAreas?: ShiftArea[];
  requestedSportCodes?: string[];
  status: AllowedEmailInvitePreviewStatus;
  existingRole?: Role;
};

function normalizeOnboardingEmail(email: string) {
  return email.trim().toLowerCase();
}

function assertCanInviteRole(actor: OnboardingActor, role: Role) {
  if (role === "STAFF" && actor.role !== "ADMIN") {
    throw new HttpError(403, "Only admins can pre-approve staff accounts");
  }
  if (role === "COLLABORATOR" && actor.role !== "ADMIN") {
    throw new HttpError(403, "Only admins can pre-approve collaborator accounts");
  }
}

function normalizePendingProfile(role: InviteRole, profile: InviteProfile): NormalizedInviteProfile {
  const requestedAreas = unique(profile.preloadedAreas ?? []);
  const requestedSportCodes = unique((profile.preloadedSportCodes ?? []).map(normalizeSportCode));
  const hasPendingProfile = Boolean(
    profile.preloadedName?.trim() ||
    profile.preloadedPrimaryArea ||
    requestedAreas.length > 0 ||
    requestedSportCodes.length > 0,
  );

  if (role !== "STUDENT" && hasPendingProfile) {
    throw new HttpError(400, "Only student invitations can receive preloaded profile data");
  }

  const primaryArea = profile.preloadedPrimaryArea ?? requestedAreas[0] ?? null;
  const areas = primaryArea && !requestedAreas.includes(primaryArea)
    ? [primaryArea, ...requestedAreas]
    : requestedAreas;

  return {
    preloadedName: profile.preloadedName?.trim() || null,
    preloadedPrimaryArea: primaryArea,
    preloadedAreas: areas,
    preloadedSportCodes: requestedSportCodes,
  };
}

function pendingProfileCreateData(profile: NormalizedInviteProfile) {
  return {
    ...(profile.preloadedName ? { preloadedName: profile.preloadedName } : {}),
    ...(profile.preloadedPrimaryArea ? { preloadedPrimaryArea: profile.preloadedPrimaryArea } : {}),
    ...(profile.preloadedAreas.length > 0 ? { preloadedAreas: profile.preloadedAreas } : {}),
    ...(profile.preloadedSportCodes.length > 0 ? { preloadedSportCodes: profile.preloadedSportCodes } : {}),
  };
}

async function resolveInviteProfile(role: InviteRole, profile: InviteProfile) {
  const pendingProfile = normalizePendingProfile(role, profile);

  if (role !== "COLLABORATOR") {
    if (profile.collaboratorPolicyId || profile.affiliation || profile.collaboratorProfile) {
      throw new HttpError(400, "Internal invitations cannot receive collaborator policy metadata");
    }
    return {
      collaboratorPolicyId: null,
      affiliation: null,
      collaboratorProfile: null,
      ...pendingProfile,
    };
  }

  const policy = profile.collaboratorPolicyId
    ? await db.collaboratorPolicy.findUnique({
        where: { id: profile.collaboratorPolicyId },
        include: { affiliation: true },
      })
    : profile.affiliation === "BIG_TEN_NETWORK" && profile.collaboratorProfile === "BTN_STANDARD"
      ? await db.collaboratorPolicy.findFirst({
          where: { affiliation: { key: "BIG_TEN_NETWORK" } },
          include: { affiliation: true },
        })
      : null;
  if (!policy || policy.affiliation.archivedAt) {
    throw new HttpError(400, "Choose a recognized collaborator affiliation");
  }
  if (policy.status !== "ACTIVE") {
    throw new HttpError(409, "That collaborator affiliation is suspended");
  }
  const isLegacyBtn = policy.affiliation.key === "BIG_TEN_NETWORK";
  return {
    collaboratorPolicyId: policy.id,
    affiliation: isLegacyBtn ? Affiliation.BIG_TEN_NETWORK : null,
    collaboratorProfile: isLegacyBtn ? CollaboratorProfile.BTN_STANDARD : null,
    ...pendingProfile,
  };
}

function allowedEmailAuditAfter(
  entry: {
    email: string;
    role: Role;
    affiliation?: Affiliation | null;
    collaboratorProfile?: CollaboratorProfile | null;
    collaboratorPolicyId?: string | null;
    preloadedName?: string | null;
    preloadedPrimaryArea?: ShiftArea | null;
    preloadedAreas?: ShiftArea[];
    preloadedSportCodes?: string[];
    claimedAt?: Date | null;
    claimedById?: string | null;
  },
  source: string,
) {
  return {
    email: entry.email,
    role: entry.role,
    affiliation: entry.affiliation ?? null,
    collaboratorProfile: entry.collaboratorProfile ?? null,
    collaboratorPolicyId: entry.collaboratorPolicyId ?? null,
    preloadedName: entry.preloadedName ?? null,
    preloadedPrimaryArea: entry.preloadedPrimaryArea ?? null,
    preloadedAreas: entry.preloadedAreas ?? [],
    preloadedSportCodes: entry.preloadedSportCodes ?? [],
    claimedById: entry.claimedById ?? null,
    claimedAt: entry.claimedAt?.toISOString() ?? null,
    source,
  };
}

export async function createAllowedEmailInvite(input: {
  actor: OnboardingActor;
  email: string;
  role: InviteRole;
} & InviteProfile): Promise<AllowedEmailInviteResult> {
  assertCanInviteRole(input.actor, input.role);
  const resolvedProfile = await resolveInviteProfile(input.role, input);

  const email = normalizeOnboardingEmail(input.email);
  const existingUser = await db.user.findUnique({
    where: { email },
    select: { id: true, role: true, affiliation: true, collaboratorProfile: true, collaboratorPolicyId: true },
  });

  if (existingUser) {
    if (existingUser.role !== "STUDENT" && input.actor.role !== "ADMIN") {
      throw new HttpError(403, "Only admins can pre-approve staff accounts");
    }

    try {
      const entry = await db.allowedEmail.create({
        data: {
          email,
          role: existingUser.role,
          affiliation: existingUser.affiliation,
          collaboratorProfile: existingUser.collaboratorProfile,
          collaboratorPolicyId: existingUser.collaboratorPolicyId,
          ...pendingProfileCreateData(resolvedProfile),
          createdById: input.actor.id,
          claimedAt: new Date(),
          claimedById: existingUser.id,
        },
        include: {
          createdBy: { select: { id: true, name: true } },
          claimedBy: { select: { id: true, name: true } },
        },
      });

      await createAuditEntry({
        actorId: input.actor.id,
        actorRole: input.actor.role,
        entityType: "allowed_email",
        entityId: entry.id,
        action: "created",
        after: allowedEmailAuditAfter(entry, "registered_user_backfill"),
      });

      return { skipped: false, entry };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { skipped: true, email, role: input.role };
      }
      throw error;
    }
  }

  try {
    const entry = await db.allowedEmail.create({
      data: {
        email,
        role: input.role,
        affiliation: resolvedProfile.affiliation,
        collaboratorProfile: resolvedProfile.collaboratorProfile,
        collaboratorPolicyId: resolvedProfile.collaboratorPolicyId,
        ...pendingProfileCreateData(resolvedProfile),
        createdById: input.actor.id,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        claimedBy: { select: { id: true, name: true } },
      },
    });

    await createAuditEntry({
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "allowed_email",
      entityId: entry.id,
      action: "created",
      after: {
        email,
        role: input.role,
        affiliation: resolvedProfile.affiliation,
        collaboratorProfile: resolvedProfile.collaboratorProfile,
        collaboratorPolicyId: resolvedProfile.collaboratorPolicyId,
        preloadedName: resolvedProfile.preloadedName,
        preloadedPrimaryArea: resolvedProfile.preloadedPrimaryArea,
        preloadedAreas: resolvedProfile.preloadedAreas,
        preloadedSportCodes: resolvedProfile.preloadedSportCodes,
      },
    });

    return { skipped: false, entry };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { skipped: true, email, role: input.role };
    }
    throw error;
  }
}

export async function updatePendingAllowedEmailProfile(input: {
  actor: OnboardingActor;
  id: string;
} & InviteProfile): Promise<{ entry: AllowedEmailWithPeople }> {
  assertCanInviteRole(input.actor, "STUDENT");
  const resolvedProfile = await resolveInviteProfile("STUDENT", input);

  return db.$transaction(async (tx) => {
    const existing = await tx.allowedEmail.findUnique({
      where: { id: input.id },
    });

    if (!existing) {
      throw new HttpError(404, "Allowed email not found");
    }
    if (existing.claimedAt) {
      throw new HttpError(409, "Cannot update a claimed invitation");
    }
    if (existing.role !== "STUDENT") {
      throw new HttpError(400, "Only student invitations can receive preloaded profile data");
    }

    const updated = await tx.allowedEmail.update({
      where: { id: existing.id },
      data: {
        preloadedName: resolvedProfile.preloadedName,
        preloadedPrimaryArea: resolvedProfile.preloadedPrimaryArea,
        preloadedAreas: resolvedProfile.preloadedAreas,
        preloadedSportCodes: resolvedProfile.preloadedSportCodes,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        claimedBy: { select: { id: true, name: true } },
      },
    });

    await createAuditEntryTx(tx, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "allowed_email",
      entityId: updated.id,
      action: "pending_profile_updated",
      before: allowedEmailAuditAfter(existing, "pending_profile_update"),
      after: allowedEmailAuditAfter(updated, "pending_profile_update"),
    });

    return { entry: updated };
  });
}

export async function createAllowedEmailInvitesBulk(input: {
  actor: OnboardingActor;
  emails: Array<{ email: string; role: InviteRole } & InviteProfile>;
}) {
  for (const entry of input.emails) {
    assertCanInviteRole(input.actor, entry.role);
  }

  const resolvedProfiles = await Promise.all(
    input.emails.map((entry) => resolveInviteProfile(entry.role, entry)),
  );

  const normalized = input.emails.map((entry, index) => ({
    ...entry,
    ...resolvedProfiles[index]!,
    email: normalizeOnboardingEmail(entry.email),
  }));
  const emailList = normalized.map((entry) => entry.email);

  const [existingAllowed, existingUsers] = await Promise.all([
    db.allowedEmail.findMany({
      where: { email: { in: emailList } },
      select: { email: true },
    }),
    db.user.findMany({
      where: { email: { in: emailList } },
      select: { email: true },
    }),
  ]);

  const existingSet = new Set([
    ...existingAllowed.map((entry) => entry.email),
    ...existingUsers.map((entry) => entry.email),
  ]);

  const toCreate = normalized.filter((entry) => !existingSet.has(entry.email));

  if (toCreate.length > 0) {
    // skipDuplicates keeps the batch alive against in-batch repeats and a
    // concurrent commit racing the pre-read above; the returned count is the
    // number of rows actually inserted.
    const createResult = await db.allowedEmail.createMany({
      data: toCreate.map((entry) => ({
        email: entry.email,
        role: entry.role,
        ...(entry.affiliation ? { affiliation: entry.affiliation } : {}),
        ...(entry.collaboratorProfile ? { collaboratorProfile: entry.collaboratorProfile } : {}),
        ...(entry.collaboratorPolicyId ? { collaboratorPolicyId: entry.collaboratorPolicyId } : {}),
        ...pendingProfileCreateData(entry),
        createdById: input.actor.id,
      })),
      skipDuplicates: true,
    });

    const created = await db.allowedEmail.findMany({
      where: { email: { in: toCreate.map((entry) => entry.email) }, createdById: input.actor.id },
      select: {
        id: true,
        email: true,
        role: true,
        affiliation: true,
        collaboratorProfile: true,
        collaboratorPolicyId: true,
        preloadedName: true,
        preloadedPrimaryArea: true,
        preloadedAreas: true,
        preloadedSportCodes: true,
      },
    });

    await createAuditEntries(
      created.map((entry) => ({
        actorId: input.actor.id,
        actorRole: input.actor.role,
        entityType: "allowed_email",
        entityId: entry.id,
        action: "created",
        after: {
          email: entry.email,
          role: entry.role,
          affiliation: entry.affiliation,
          collaboratorProfile: entry.collaboratorProfile,
          collaboratorPolicyId: entry.collaboratorPolicyId,
          preloadedName: entry.preloadedName,
          preloadedPrimaryArea: entry.preloadedPrimaryArea,
          preloadedAreas: entry.preloadedAreas,
          preloadedSportCodes: entry.preloadedSportCodes,
        },
      })),
    );

    return { created: createResult.count, skipped: normalized.length - createResult.count };
  }

  return { created: 0, skipped: normalized.length };
}

export async function previewAllowedEmailInvitesBulk(input: {
  actor: OnboardingActor;
  emails: Array<{ email: string; role: InviteRole } & InviteProfile>;
}) {
  for (const entry of input.emails) {
    assertCanInviteRole(input.actor, entry.role);
  }

  const resolvedProfiles = await Promise.all(
    input.emails.map((entry) => resolveInviteProfile(entry.role, entry)),
  );

  const normalized = input.emails.map((entry, index) => ({
    ...entry,
    ...resolvedProfiles[index]!,
    email: normalizeOnboardingEmail(entry.email),
  }));
  const emailList = normalized.map((entry) => entry.email);

  const [existingAllowed, existingUsers] = await Promise.all([
    db.allowedEmail.findMany({
      where: { email: { in: emailList } },
      select: { email: true, role: true, claimedAt: true },
    }),
    db.user.findMany({
      where: { email: { in: emailList } },
      select: { email: true, role: true },
    }),
  ]);

  const allowedByEmail = new Map(existingAllowed.map((entry) => [entry.email, entry]));
  const usersByEmail = new Map(existingUsers.map((entry) => [entry.email, entry]));
  const seen = new Set<string>();
  const rows: AllowedEmailInvitePreviewRow[] = normalized.map((entry) => {
    const requestedProfile = {
      requestedName: entry.preloadedName,
      requestedPrimaryArea: entry.preloadedPrimaryArea,
      requestedAreas: entry.preloadedAreas,
      requestedSportCodes: entry.preloadedSportCodes,
    };

    if (seen.has(entry.email)) {
      return {
        email: entry.email,
        requestedRole: entry.role,
        requestedAffiliation: entry.affiliation ?? null,
        requestedCollaboratorProfile: entry.collaboratorProfile ?? null,
        requestedCollaboratorPolicyId: entry.collaboratorPolicyId ?? null,
        ...requestedProfile,
        status: "duplicate",
      };
    }

    seen.add(entry.email);
    const allowed = allowedByEmail.get(entry.email);
    if (allowed) {
      return {
        email: entry.email,
        requestedRole: entry.role,
        requestedAffiliation: entry.affiliation ?? null,
        requestedCollaboratorProfile: entry.collaboratorProfile ?? null,
        requestedCollaboratorPolicyId: entry.collaboratorPolicyId ?? null,
        ...requestedProfile,
        existingRole: allowed.role,
        status: allowed.claimedAt ? "claimed_invite" : "pending_invite",
      };
    }

    const user = usersByEmail.get(entry.email);
    if (user) {
      return {
        email: entry.email,
        requestedRole: entry.role,
        requestedAffiliation: entry.affiliation ?? null,
        requestedCollaboratorProfile: entry.collaboratorProfile ?? null,
        requestedCollaboratorPolicyId: entry.collaboratorPolicyId ?? null,
        ...requestedProfile,
        existingRole: user.role,
        status: "existing_user",
      };
    }

    return {
      email: entry.email,
      requestedRole: entry.role,
      requestedAffiliation: entry.affiliation ?? null,
      requestedCollaboratorProfile: entry.collaboratorProfile ?? null,
      requestedCollaboratorPolicyId: entry.collaboratorPolicyId ?? null,
      ...requestedProfile,
      status: "ready",
    };
  });

  const summary: Record<AllowedEmailInvitePreviewStatus, number> = {
    ready: 0,
    duplicate: 0,
    existing_user: 0,
    pending_invite: 0,
    claimed_invite: 0,
  };
  for (const row of rows) {
    summary[row.status] += 1;
  }

  return { rows, summary };
}
