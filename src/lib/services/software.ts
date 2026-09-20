import { Prisma, type Role } from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { withSerializationRetry } from "@/lib/serialization";
import { decryptSoftwareSecret, encryptSoftwareSecret } from "@/lib/software-vault-crypto";
import { canViewSoftwareCredential, type SoftwareCredentialAudience } from "@/lib/software-vault-access";
import { unique } from "@/lib/utils";

const softwareCredentialListSelect = {
  id: true,
  name: true,
  category: true,
  websiteUrl: true,
  accountEmailCiphertext: true,
  visibleTo: true,
  archivedAt: true,
  updatedAt: true,
} as const;

const softwareCredentialMetadataSelect = {
  id: true,
  name: true,
  category: true,
  websiteUrl: true,
  visibleTo: true,
  archivedAt: true,
  updatedAt: true,
} as const;

type SoftwareCredentialListRow = {
  id: string;
  name: string;
  category: string | null;
  websiteUrl: string | null;
  accountEmailCiphertext: string;
  visibleTo: SoftwareCredentialAudience[];
  archivedAt: Date | null;
  updatedAt: Date;
};

type SoftwareCredentialMetadataRow = Omit<SoftwareCredentialListRow, "accountEmailCiphertext">;

type SoftwareCredentialActor = {
  id: string;
  role: Role;
};

export type SoftwareCredentialSummary = {
  id: string;
  name: string;
  category: string | null;
  websiteUrl: string | null;
  accountEmail: string;
  hasPassword: boolean;
  visibleTo: SoftwareCredentialAudience[];
  archivedAt: string | null;
  updatedAt: string;
};

function toSummary(row: SoftwareCredentialListRow): SoftwareCredentialSummary {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    websiteUrl: row.websiteUrl,
    accountEmail: decryptSoftwareSecret(row.accountEmailCiphertext),
    // The column is required by the schema. Avoid selecting password ciphertext
    // on a list read merely to derive this invariant.
    hasPassword: true,
    visibleTo: row.visibleTo,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAuditMetadata(row: SoftwareCredentialMetadataRow) {
  return {
    name: row.name,
    category: row.category,
    websiteUrl: row.websiteUrl,
    visibleTo: [...row.visibleTo],
    archivedAt: row.archivedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rethrowSoftwareNameConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new HttpError(409, "A software login with that name already exists.");
  }
  throw error;
}

export async function listSoftwareCredentials({
  includeArchived = false,
  role,
  collaboratorCanView = false,
}: {
  includeArchived?: boolean;
  role: string;
  collaboratorCanView?: boolean;
}) {
  const rows = await db.softwareCredential.findMany({
    where: includeArchived ? undefined : { archivedAt: null },
    orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
    select: softwareCredentialListSelect,
  });
  return rows
    .filter((row) => canViewSoftwareCredential(role, row.visibleTo, collaboratorCanView))
    .map((row) => toSummary(row));
}

export async function createSoftwareCredential(data: {
  name: string;
  category?: string | null;
  websiteUrl?: string | null;
  accountEmail: string;
  password: string;
  visibleTo: readonly SoftwareCredentialAudience[];
}, actor: SoftwareCredentialActor) {
  const normalizedVisibleTo = unique(data.visibleTo) as SoftwareCredentialAudience[];
  if (normalizedVisibleTo.length === 0) throw new HttpError(400, "Choose at least one software audience.");

  const accountEmailCiphertext = encryptSoftwareSecret(data.accountEmail);
  const passwordCiphertext = encryptSoftwareSecret(data.password);

  try {
    return await withSerializationRetry(() => db.$transaction(async (tx) => {
      const credential = await tx.softwareCredential.create({
        data: {
          name: data.name.trim(),
          category: data.category?.trim() || null,
          websiteUrl: data.websiteUrl || null,
          accountEmailCiphertext,
          passwordCiphertext,
          visibleTo: normalizedVisibleTo,
        },
        select: softwareCredentialMetadataSelect,
      });

      await createAuditEntryTx(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "software_credential",
        entityId: credential.id,
        action: "create",
        after: {
          ...toAuditMetadata(credential),
          accountEmailStored: true,
          passwordStored: true,
        },
      });

      return credential;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) {
    rethrowSoftwareNameConflict(error);
  }
}

export async function updateSoftwareCredential(
  id: string,
  data: {
    name?: string;
    category?: string | null;
    websiteUrl?: string | null;
    accountEmail?: string;
    password?: string;
    visibleTo?: readonly SoftwareCredentialAudience[];
    archived?: boolean;
  },
  actor: SoftwareCredentialActor,
) {
  const normalizedVisibleTo = data.visibleTo === undefined
    ? undefined
    : unique(data.visibleTo) as SoftwareCredentialAudience[];
  if (normalizedVisibleTo?.length === 0) throw new HttpError(400, "Choose at least one software audience.");
  const accountEmailCiphertext = data.accountEmail === undefined
    ? undefined
    : encryptSoftwareSecret(data.accountEmail);
  const passwordCiphertext = data.password === undefined
    ? undefined
    : encryptSoftwareSecret(data.password);
  const archivedAt = data.archived === undefined ? undefined : data.archived ? new Date() : null;

  try {
    return await withSerializationRetry(() => db.$transaction(async (tx) => {
      const existing = await tx.softwareCredential.findUnique({
        where: { id },
        select: softwareCredentialMetadataSelect,
      });
      if (!existing) throw new HttpError(404, "Software account not found.");

      const credential = await tx.softwareCredential.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name.trim() } : {}),
          ...(data.category !== undefined ? { category: data.category?.trim() || null } : {}),
          ...(data.websiteUrl !== undefined ? { websiteUrl: data.websiteUrl || null } : {}),
          ...(accountEmailCiphertext !== undefined ? { accountEmailCiphertext } : {}),
          ...(passwordCiphertext !== undefined ? { passwordCiphertext } : {}),
          ...(normalizedVisibleTo !== undefined ? { visibleTo: normalizedVisibleTo } : {}),
          ...(archivedAt !== undefined ? { archivedAt } : {}),
        },
        select: softwareCredentialMetadataSelect,
      });

      await createAuditEntryTx(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "software_credential",
        entityId: id,
        action: data.archived === true ? "archive" : data.archived === false ? "restore" : "update",
        before: {
          ...toAuditMetadata(existing),
          accountEmailStored: true,
          passwordStored: true,
        },
        after: {
          ...toAuditMetadata(credential),
          accountEmailStored: true,
          passwordStored: true,
          accountEmailChanged: data.accountEmail !== undefined,
          passwordChanged: data.password !== undefined,
        },
      });

      return credential;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) {
    rethrowSoftwareNameConflict(error);
  }
}

export async function archiveSoftwareCredential(id: string, actor: SoftwareCredentialActor) {
  return updateSoftwareCredential(id, { archived: true }, actor);
}

export async function revealSoftwarePassword(
  id: string,
  viewer: SoftwareCredentialActor & { collaboratorCanView?: boolean },
) {
  return withSerializationRetry(() => db.$transaction(async (tx) => {
    const row = await tx.softwareCredential.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        archivedAt: true,
        passwordCiphertext: true,
        visibleTo: true,
      },
    });
    if (!row || row.archivedAt || !canViewSoftwareCredential(viewer.role, row.visibleTo, viewer.collaboratorCanView)) {
      throw new HttpError(404, "Software account not found.");
    }

    const password = decryptSoftwareSecret(row.passwordCiphertext);
    await createAuditEntryTx(tx, {
      actorId: viewer.id,
      actorRole: viewer.role,
      entityType: "software_credential",
      entityId: row.id,
      action: "reveal_password",
      after: { name: row.name },
    });

    return { id: row.id, name: row.name, password };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
