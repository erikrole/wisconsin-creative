import { randomUUID } from "node:crypto";
import {
  Prisma,
  ResourceAssetKind,
  ResourceAssetUploadStatus,
  type Role,
} from "@prisma/client";
import { z } from "zod";
import { createAuditEntry, createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { withSerializationRetry } from "@/lib/serialization";
import {
  copyResourceAsset,
  deleteResourceAsset,
  headResourceAsset,
} from "@/lib/resource-assets-storage";

export const RESOURCE_ASSET_ROOT_PATH = "brand-assets";
export const RESOURCE_ASSET_MAX_BYTES = 250 * 1024 * 1024;
export const RESOURCE_ASSET_MAX_NAME_LENGTH = 180;
export const RESOURCE_ASSET_UPLOAD_TTL_MS = 30 * 60 * 1000;
export const RESOURCE_ASSET_VERSION_NOTE_MAX_LENGTH = 500;

export const RESOURCE_ASSET_KIND_LABELS: Record<ResourceAssetKind, string> = {
  [ResourceAssetKind.LOGO]: "Logo",
  [ResourceAssetKind.FONT]: "Font",
  [ResourceAssetKind.GRAPHIC_ELEMENT]: "Graphic element",
  [ResourceAssetKind.TEMPLATE]: "Template",
  [ResourceAssetKind.COLOR_REFERENCE]: "Color and reference",
  [ResourceAssetKind.PHOTO]: "Photography",
  [ResourceAssetKind.VIDEO]: "Video",
  [ResourceAssetKind.DOCUMENT]: "Document",
  [ResourceAssetKind.OTHER]: "Other",
};

export const RESOURCE_ASSET_KIND_OPTIONS = Object.values(ResourceAssetKind).map((value) => ({
  value,
  label: RESOURCE_ASSET_KIND_LABELS[value],
}));

const ALLOWED_CONTENT_TYPES = new Set([
  "application/illustrator",
  "application/msword",
  "application/octet-stream",
  "application/pdf",
  "application/postscript",
  "application/vnd.adobe.illustrator",
  "application/vnd.adobe.photoshop",
  "application/vnd.ms-fontobject",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/x-font-opentype",
  "application/x-font-ttf",
  "application/x-indesign",
  "application/x-zip-compressed",
  "application/zip",
  "font/otf",
  "font/ttf",
  "font/woff",
  "font/woff2",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
  "video/mp4",
  "video/quicktime",
]);

const ALLOWED_EXTENSIONS = new Set([
  "ai",
  "ase",
  "aco",
  "docx",
  "eot",
  "eps",
  "gif",
  "indd",
  "idml",
  "jpeg",
  "jpg",
  "mov",
  "mp4",
  "otf",
  "pdf",
  "png",
  "psd",
  "pptx",
  "svg",
  "ttf",
  "webp",
  "woff",
  "woff2",
  "xlsx",
  "zip",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  ai: "application/illustrator",
  aco: "application/octet-stream",
  ase: "application/octet-stream",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  eot: "application/vnd.ms-fontobject",
  eps: "application/postscript",
  gif: "image/gif",
  indd: "application/x-indesign",
  idml: "application/zip",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  mov: "video/quicktime",
  mp4: "video/mp4",
  otf: "font/otf",
  pdf: "application/pdf",
  png: "image/png",
  psd: "application/vnd.adobe.photoshop",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

export const prepareResourceAssetUploadSchema = z.object({
  folderId: z.string().trim().min(1).max(100),
  assetId: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(RESOURCE_ASSET_MAX_NAME_LENGTH),
  kind: z.nativeEnum(ResourceAssetKind).default(ResourceAssetKind.OTHER),
  description: z.string().trim().max(1000).nullable().optional(),
  originalName: z.string().trim().min(1).max(RESOURCE_ASSET_MAX_NAME_LENGTH),
  contentType: z.string().trim().max(180).optional().default("application/octet-stream"),
  sizeBytes: z.number().int().positive().max(RESOURCE_ASSET_MAX_BYTES),
  versionNote: z.string().trim().max(RESOURCE_ASSET_VERSION_NOTE_MAX_LENGTH).nullable().optional(),
});

export const completeResourceAssetUploadSchema = z.object({
  intentId: z.string().trim().min(1).max(100),
});

export const createResourceAssetFolderSchema = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: z.string().trim().min(1).max(100).optional(),
});

export const restoreResourceAssetVersionSchema = z.object({
  versionId: z.string().trim().min(1).max(100),
});

export const resourceAssetKindQuerySchema = z.nativeEnum(ResourceAssetKind).nullable().optional();

export function normalizeResourceAssetContentType(contentType: string | null | undefined): string {
  return ((contentType ?? "").split(";", 1)[0] ?? "").trim().toLowerCase() || "application/octet-stream";
}

function fileExtension(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? name;
  const match = /\.([a-z0-9]+)$/i.exec(leaf);
  return match?.[1]?.toLowerCase() ?? "";
}

export function normalizeResourceAssetName(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? "";
  const normalized = leaf
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) throw new HttpError(400, "A file name is required.");
  if (normalized.length > RESOURCE_ASSET_MAX_NAME_LENGTH) {
    throw new HttpError(400, `File names must be ${RESOURCE_ASSET_MAX_NAME_LENGTH} characters or fewer.`);
  }
  return normalized;
}

export function normalizedResourceAssetName(name: string): string {
  return normalizeResourceAssetName(name).normalize("NFKC").toLocaleLowerCase("en-US");
}

export function validateResourceAssetFile(input: {
  name: string;
  contentType?: string | null;
  sizeBytes: number;
}) {
  const name = normalizeResourceAssetName(input.name);
  const extension = fileExtension(name);
  const providedContentType = normalizeResourceAssetContentType(input.contentType);
  const contentType = providedContentType === "application/octet-stream"
    ? MIME_BY_EXTENSION[extension] ?? providedContentType
    : providedContentType;
  const typeAllowed = ALLOWED_CONTENT_TYPES.has(contentType);
  const extensionAllowed = ALLOWED_EXTENSIONS.has(extension);

  if (!extensionAllowed || (!typeAllowed && contentType !== "application/octet-stream")) {
    throw new HttpError(400, "That file type is not supported in Brand assets.");
  }
  if (input.sizeBytes <= 0 || !Number.isSafeInteger(input.sizeBytes)) {
    throw new HttpError(400, "File size must be a positive whole number.");
  }
  if (input.sizeBytes > RESOURCE_ASSET_MAX_BYTES) {
    throw new HttpError(413, "That file is too large for Brand assets (max 250 MB).");
  }

  return { name, normalizedName: normalizedResourceAssetName(name), contentType, extension };
}

function safeStorageFileName(name: string): string {
  const extension = fileExtension(name);
  const baseName = normalizeResourceAssetName(name)
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  const base = baseName || "asset";
  return extension ? `${base}.${extension}` : base;
}

function normalizeFolderName(name: string): { name: string; segment: string } {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) throw new HttpError(400, "A folder name is required.");
  if (cleaned.includes("/") || cleaned.includes("\\") || cleaned === "." || cleaned === "..") {
    throw new HttpError(400, "Folder names cannot contain path separators.");
  }
  const segment = cleaned
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!segment) throw new HttpError(400, "Choose a folder name with letters or numbers.");
  return { name: cleaned.slice(0, 80), segment };
}

function versionSummary(version: {
  id: string;
  versionNumber: number;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  etag: string | null;
  versionNote?: string | null;
  createdAt: Date;
  uploadedBy: { id: string; name: string };
}) {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    originalName: version.originalName,
    contentType: version.contentType,
    sizeBytes: version.sizeBytes,
    etag: version.etag,
    versionNote: version.versionNote ?? null,
    createdAt: version.createdAt,
    uploadedBy: version.uploadedBy,
  };
}

function assetSummary(asset: {
  id: string;
  name: string;
  kind: ResourceAssetKind;
  description: string | null;
  folderId: string;
  folder: { id: string; name: string; path: string };
  createdAt: Date;
  updatedAt: Date;
  currentVersion: {
    id: string;
    versionNumber: number;
    originalName: string;
    contentType: string;
    sizeBytes: number;
    etag: string | null;
    createdAt: Date;
    uploadedBy: { id: string; name: string };
  } | null;
  _count: { versions: number };
  favorites?: { id: string }[];
}) {
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    description: asset.description,
    folderId: asset.folderId,
    folder: asset.folder,
    isFavorite: Boolean(asset.favorites?.length),
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    versionCount: asset._count.versions,
    currentVersion: asset.currentVersion ? versionSummary(asset.currentVersion) : null,
  };
}

export async function listResourceAssets(input: {
  folderId?: string | null;
  search?: string | null;
  kind?: ResourceAssetKind | null;
  favoritesOnly?: boolean;
  favoriteUserId?: string | null;
  scope?: "folder" | "all";
  sort?: "name" | "updated" | "type";
} = {}) {
  const folder = input.folderId
    ? await db.resourceAssetFolder.findUnique({ where: { id: input.folderId } })
    : await db.resourceAssetFolder.findUnique({ where: { path: RESOURCE_ASSET_ROOT_PATH } });
  if (!folder) throw new HttpError(404, "Brand asset folder not found.");

  const search = input.search?.trim();
  const scope = input.scope ?? "folder";
  if (input.favoritesOnly && !input.favoriteUserId) {
    throw new HttpError(400, "A signed-in user is required to filter favorites.");
  }
  const assetWhere: Prisma.ResourceAssetWhereInput = {
    // `startsWith` alone would leak siblings: searching "brand-assets/logos"
    // would also match "brand-assets/logos-archive". Match the folder itself
    // or a true descendant path segment.
    ...(scope === "all"
      ? { folder: { OR: [{ path: folder.path }, { path: { startsWith: `${folder.path}/` } }] } }
      : { folderId: folder.id }),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.favoritesOnly
      ? { favorites: { some: { userId: input.favoriteUserId as string } } }
      : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
            { currentVersion: { is: { originalName: { contains: search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const orderBy: Prisma.ResourceAssetOrderByWithRelationInput[] = input.sort === "updated"
    ? [{ updatedAt: "desc" }, { name: "asc" }]
    : input.sort === "type"
      ? [{ kind: "asc" }, { name: "asc" }]
      : [{ name: "asc" }];
  const [folders, assets] = await Promise.all([
    db.resourceAssetFolder.findMany({
      where: { parentId: folder.id },
      orderBy: { name: "asc" },
      include: { _count: { select: { assets: true } } },
    }),
    db.resourceAsset.findMany({
      where: assetWhere,
      orderBy,
      include: {
        folder: { select: { id: true, name: true, path: true } },
        currentVersion: {
          include: { uploadedBy: { select: { id: true, name: true } } },
        },
        _count: { select: { versions: true } },
        ...(input.favoriteUserId
          ? { favorites: { where: { userId: input.favoriteUserId }, select: { id: true } } }
          : {}),
      },
    }),
  ]);

  const pathParts = folder.path.split("/");
  const breadcrumbRows = await db.resourceAssetFolder.findMany({
    where: { path: { in: pathParts.map((_, index) => pathParts.slice(0, index + 1).join("/")) } },
    select: { id: true, name: true, path: true },
  });
  const breadcrumbByPath = new Map(breadcrumbRows.map((row) => [row.path, row]));

  return {
    folder: { id: folder.id, name: folder.name, path: folder.path },
    breadcrumbs: pathParts.map((_, index) => breadcrumbByPath.get(pathParts.slice(0, index + 1).join("/"))).filter(Boolean),
    // Child folders are always returned so the navigation rail and folder grid
    // stay stable across scope/filter changes; the UI decides when to show them.
    folders: folders.map((child) => ({
      id: child.id,
      name: child.name,
      path: child.path,
      assetCount: child._count.assets,
    })),
    assets: assets.map(assetSummary),
  };
}

export async function getResourceAsset(id: string, viewerId?: string | null) {
  const asset = await db.resourceAsset.findUnique({
    where: { id },
    include: {
      folder: { select: { id: true, name: true, path: true } },
      currentVersion: { include: { uploadedBy: { select: { id: true, name: true } } } },
      versions: {
        orderBy: { versionNumber: "desc" },
        include: { uploadedBy: { select: { id: true, name: true } } },
      },
      _count: { select: { versions: true } },
      ...(viewerId
        ? { favorites: { where: { userId: viewerId }, select: { id: true } } }
        : {}),
    },
  });
  if (!asset) throw new HttpError(404, "Brand asset not found.");

  return {
    ...assetSummary(asset),
    folder: asset.folder,
    versions: asset.versions.map(versionSummary),
  };
}

export async function getResourceAssetVersion(assetId: string, versionId?: string | null) {
  const version = versionId
    ? await db.resourceAssetVersion.findUnique({
        where: { id: versionId },
        include: { asset: { select: { id: true, name: true } } },
      })
    : await db.resourceAsset.findUnique({
        where: { id: assetId },
        select: {
          currentVersion: {
            include: { asset: { select: { id: true, name: true } } },
          },
        },
      }).then((row) => row?.currentVersion ?? null);

  if (!version || version.asset.id !== assetId) throw new HttpError(404, "Brand asset version not found.");
  return version;
}

export async function prepareResourceAssetUpload(input: {
  actorId: string;
  actorRole: Role;
  folderId: string;
  assetId?: string;
  name: string;
  kind: ResourceAssetKind;
  description?: string | null;
  versionNote?: string | null;
  originalName: string;
  contentType?: string | null;
  sizeBytes: number;
}) {
  const file = validateResourceAssetFile({
    name: input.originalName,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });
  const intentId = randomUUID();
  const storagePath = `resource-assets/${intentId}/${safeStorageFileName(file.name)}`;
  const expiresAt = new Date(Date.now() + RESOURCE_ASSET_UPLOAD_TTL_MS);

  // Abandoned intents can never be completed once expired, so drop this actor's
  // stale rows before adding another. Best-effort: cleanup never blocks upload.
  try {
    await db.resourceAssetUpload.deleteMany({
      where: {
        actorId: input.actorId,
        status: ResourceAssetUploadStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
    });
  } catch (error) {
    console.error("Could not prune expired brand asset upload intents", error);
  }

  return withSerializationRetry(() =>
    db.$transaction(
      async (tx) => {
        const folder = await tx.resourceAssetFolder.findUnique({ where: { id: input.folderId } });
        if (!folder) throw new HttpError(404, "Brand asset folder not found.");

        let assetId: string | undefined;
        let name = normalizeResourceAssetName(input.name);
        let normalizedName = normalizedResourceAssetName(name);
        let kind = input.kind;
        let description = input.description?.trim() || null;
        const versionNote = input.versionNote?.trim() || null;
        let versionNumber = 1;

        if (input.assetId) {
          const asset = await tx.resourceAsset.findUnique({
            where: { id: input.assetId },
            select: { id: true, folderId: true, name: true, normalizedName: true, kind: true, description: true },
          });
          if (!asset) throw new HttpError(404, "Brand asset not found.");
          if (asset.folderId !== folder.id) throw new HttpError(409, "A replacement must stay in the same folder.");
          assetId = asset.id;
          name = asset.name;
          normalizedName = asset.normalizedName;
          kind = asset.kind;
          description = asset.description;
          const latest = await tx.resourceAssetVersion.findFirst({
            where: { assetId: asset.id },
            orderBy: { versionNumber: "desc" },
            select: { versionNumber: true },
          });
          versionNumber = (latest?.versionNumber ?? 0) + 1;
        } else {
          const existing = await tx.resourceAsset.findUnique({
            where: { folderId_normalizedName: { folderId: folder.id, normalizedName } },
            select: { id: true },
          });
          if (existing) {
            throw new HttpError(409, "A file with that name already exists. Upload a new version from its file row.", {
              existingAssetId: existing.id,
            });
          }
        }

        await tx.resourceAssetUpload.create({
          data: {
            id: intentId,
            actorId: input.actorId,
            folderId: folder.id,
            assetId: assetId ?? null,
            name,
            normalizedName,
            kind,
            description,
            originalName: file.name,
            storagePath,
            contentType: file.contentType,
            sizeBytes: input.sizeBytes,
            versionNumber,
            versionNote,
            expiresAt,
          },
        });
        await createAuditEntryTx(tx, {
          actorId: input.actorId,
          actorRole: input.actorRole,
          entityType: "resource_asset_upload",
          entityId: intentId,
          action: "resource_asset_upload_prepared",
          after: {
            assetId: assetId ?? null,
            folderId: folder.id,
            name,
            versionNumber,
            contentType: file.contentType,
            sizeBytes: input.sizeBytes,
            versionNote,
          },
        });

        return {
          id: intentId,
          storagePath,
          assetId: assetId ?? null,
          name,
          versionNumber,
          contentType: file.contentType,
          sizeBytes: input.sizeBytes,
          versionNote,
          expiresAt,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function completeResourceAssetUpload(input: {
  actorId: string;
  actorRole: Role;
  intentId: string;
}) {
  const intent = await db.resourceAssetUpload.findUnique({ where: { id: input.intentId } });
  if (!intent || intent.actorId !== input.actorId) throw new HttpError(404, "Upload intent not found.");
  if (intent.status === ResourceAssetUploadStatus.COMPLETED) {
    if (!intent.assetId) throw new HttpError(409, "Completed upload is missing its asset record.");
    return { assetId: intent.assetId, versionNumber: intent.versionNumber, name: intent.name };
  }
  if (intent.expiresAt.getTime() <= Date.now()) throw new HttpError(410, "This upload expired. Please start it again.");

  const stored = await headResourceAsset(intent.storagePath);
  const storedContentType = normalizeResourceAssetContentType(stored.contentType);
  if (stored.pathname !== intent.storagePath || stored.size !== intent.sizeBytes || storedContentType !== intent.contentType) {
    throw new HttpError(409, "The uploaded file did not match the expected file metadata.");
  }

  const completed = await withSerializationRetry(() =>
    db.$transaction(
      async (tx) => {
        const current = await tx.resourceAssetUpload.findUnique({ where: { id: input.intentId } });
        if (!current || current.actorId !== input.actorId) throw new HttpError(404, "Upload intent not found.");
        if (current.status === ResourceAssetUploadStatus.COMPLETED) {
          if (!current.assetId) throw new HttpError(409, "Completed upload is missing its asset record.");
          return { assetId: current.assetId, versionNumber: current.versionNumber, name: current.name };
        }
        if (current.expiresAt.getTime() <= Date.now()) throw new HttpError(410, "This upload expired. Please start it again.");

        let asset;
        if (current.assetId) {
          asset = await tx.resourceAsset.findUnique({ where: { id: current.assetId } });
          if (!asset) throw new HttpError(409, "The file being replaced no longer exists.");
          if (asset.folderId !== current.folderId) throw new HttpError(409, "The upload target changed folders.");
        } else {
          const existing = await tx.resourceAsset.findUnique({
            where: { folderId_normalizedName: { folderId: current.folderId, normalizedName: current.normalizedName } },
            select: { id: true },
          });
          if (existing) throw new HttpError(409, "A file with that name was created while this upload was in progress.");
          asset = await tx.resourceAsset.create({
            data: {
              name: current.name,
              normalizedName: current.normalizedName,
              folderId: current.folderId,
              kind: current.kind,
              description: current.description,
              createdById: input.actorId,
              updatedById: input.actorId,
            },
          });
        }

        // The prepared version number is advisory only. Two replacements prepared
        // at the same time both reserve N+1, so recompute at commit time and let
        // them land as N+1 and N+2 instead of losing the second upload to the
        // (assetId, versionNumber) unique constraint.
        const latest = await tx.resourceAssetVersion.findFirst({
          where: { assetId: asset.id },
          orderBy: { versionNumber: "desc" },
          select: { versionNumber: true },
        });
        const versionNumber = (latest?.versionNumber ?? 0) + 1;

        const version = await tx.resourceAssetVersion.create({
          data: {
            assetId: asset.id,
            versionNumber,
            originalName: current.originalName,
            storagePath: current.storagePath,
            contentType: storedContentType,
            sizeBytes: stored.size,
            etag: stored.etag,
            versionNote: current.versionNote,
            uploadedById: input.actorId,
          },
        });
        await tx.resourceAsset.update({
          where: { id: asset.id },
          data: { currentVersionId: version.id, updatedById: input.actorId },
        });
        await tx.resourceAssetUpload.update({
          where: { id: current.id },
          data: {
            status: ResourceAssetUploadStatus.COMPLETED,
            assetId: asset.id,
            versionNumber,
            completedAt: new Date(),
          },
        });
        await createAuditEntryTx(tx, {
          actorId: input.actorId,
          actorRole: input.actorRole,
          entityType: "resource_asset",
          entityId: asset.id,
          action: "resource_asset_version_uploaded",
          after: {
            folderId: asset.folderId,
            name: asset.name,
            kind: asset.kind,
            versionNumber: version.versionNumber,
            originalName: version.originalName,
            contentType: version.contentType,
            sizeBytes: version.sizeBytes,
            versionNote: version.versionNote,
          },
        });

        return { assetId: asset.id, versionNumber: version.versionNumber, name: asset.name };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  return completed;
}

export async function restoreResourceAssetVersion(input: {
  actorId: string;
  actorRole: Role;
  assetId: string;
  versionId: string;
}) {
  const source = await db.resourceAssetVersion.findUnique({
    where: { id: input.versionId },
    include: {
      asset: { select: { id: true, folderId: true, name: true, kind: true, description: true, currentVersionId: true } },
    },
  });
  if (!source || source.asset.id !== input.assetId) throw new HttpError(404, "Brand asset version not found.");
  if (source.asset.currentVersionId === source.id) throw new HttpError(409, "That version is already current.");

  const latest = await db.resourceAssetVersion.findFirst({
    where: { assetId: input.assetId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;
  const copiedPath = `resource-assets/${input.assetId}/restore-${randomUUID()}/${safeStorageFileName(source.originalName)}`;
  const copied = await copyResourceAsset(source.storagePath, copiedPath, source.contentType);

  try {
    return await withSerializationRetry(() =>
      db.$transaction(
        async (tx) => {
          const asset = await tx.resourceAsset.findUnique({
            where: { id: input.assetId },
            select: { id: true, folderId: true, name: true, currentVersionId: true },
          });
          const currentSource = await tx.resourceAssetVersion.findUnique({
            where: { id: input.versionId },
            select: { id: true, originalName: true, contentType: true, sizeBytes: true, versionNumber: true },
          });
          const currentLatest = await tx.resourceAssetVersion.findFirst({
            where: { assetId: input.assetId },
            orderBy: { versionNumber: "desc" },
            select: { versionNumber: true },
          });
          if (!asset || !currentSource) throw new HttpError(404, "Brand asset version not found.");
          if (asset.currentVersionId === currentSource.id) throw new HttpError(409, "That version is already current.");
          if ((currentLatest?.versionNumber ?? 0) + 1 !== nextVersionNumber) {
            throw new HttpError(409, "This file changed while the restore was prepared. Open History and try again.");
          }

          const version = await tx.resourceAssetVersion.create({
            data: {
              assetId: asset.id,
              versionNumber: nextVersionNumber,
              originalName: currentSource.originalName,
              storagePath: copied.pathname,
              contentType: currentSource.contentType,
              sizeBytes: currentSource.sizeBytes,
              etag: copied.etag,
              versionNote: `Restored from version ${currentSource.versionNumber}`,
              uploadedById: input.actorId,
            },
          });
          await tx.resourceAsset.update({
            where: { id: asset.id },
            data: { currentVersionId: version.id, updatedById: input.actorId },
          });
          await createAuditEntryTx(tx, {
            actorId: input.actorId,
            actorRole: input.actorRole,
            entityType: "resource_asset",
            entityId: asset.id,
            action: "resource_asset_version_restored",
            before: {
              currentVersionId: asset.currentVersionId,
              restoredFromVersion: currentSource.versionNumber,
            },
            after: {
              currentVersionId: version.id,
              versionNumber: version.versionNumber,
              versionNote: version.versionNote,
            },
          });
          return { assetId: asset.id, versionId: version.id, versionNumber: version.versionNumber, name: asset.name };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error) {
    try {
      await deleteResourceAsset(copied.pathname);
    } catch (cleanupError) {
      console.error("Could not clean up a failed brand asset restore", cleanupError);
    }
    throw error;
  }
}

export async function toggleResourceAssetFavorite(input: {
  actorId: string;
  actorRole: Role;
  assetId: string;
}) {
  const asset = await db.resourceAsset.findUnique({ where: { id: input.assetId }, select: { id: true } });
  if (!asset) throw new HttpError(404, "Brand asset not found.");

  const existing = await db.resourceAssetFavorite.findUnique({
    where: { userId_assetId: { userId: input.actorId, assetId: input.assetId } },
  });
  if (existing) {
    await db.resourceAssetFavorite.deleteMany({ where: { userId: input.actorId, assetId: input.assetId } });
    await createAuditEntry({
      actorId: input.actorId,
      actorRole: input.actorRole,
      entityType: "resource_asset",
      entityId: input.assetId,
      action: "resource_asset_favorite_removed",
    });
    return { favorited: false };
  }

  try {
    await db.resourceAssetFavorite.create({ data: { userId: input.actorId, assetId: input.assetId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { favorited: true };
    }
    throw error;
  }
  await createAuditEntry({
    actorId: input.actorId,
    actorRole: input.actorRole,
    entityType: "resource_asset",
    entityId: input.assetId,
    action: "resource_asset_favorite_added",
  });
  return { favorited: true };
}

export async function createResourceAssetFolder(input: {
  actorId: string;
  actorRole: Role;
  name: string;
  parentId?: string;
}) {
  const folderName = normalizeFolderName(input.name);
  return withSerializationRetry(() =>
    db.$transaction(
      async (tx) => {
        const parent = input.parentId
          ? await tx.resourceAssetFolder.findUnique({ where: { id: input.parentId } })
          : await tx.resourceAssetFolder.findUnique({ where: { path: RESOURCE_ASSET_ROOT_PATH } });
        if (!parent) throw new HttpError(404, "Parent brand asset folder not found.");
        if (parent.path.split("/").length >= 5) throw new HttpError(400, "Brand asset folders cannot be nested further.");

        const path = `${parent.path}/${folderName.segment}`;
        const duplicate = await tx.resourceAssetFolder.findUnique({ where: { path }, select: { name: true } });
        if (duplicate) {
          throw new HttpError(409, `A folder named ${duplicate.name} already exists here.`);
        }

        const folder = await tx.resourceAssetFolder.create({
          data: {
            name: folderName.name,
            path,
            parentId: parent.id,
            createdById: input.actorId,
          },
        });
        await createAuditEntryTx(tx, {
          actorId: input.actorId,
          actorRole: input.actorRole,
          entityType: "resource_asset_folder",
          entityId: folder.id,
          action: "resource_asset_folder_created",
          after: { name: folder.name, path: folder.path, parentId: parent.id },
        });
        return { id: folder.id, name: folder.name, path: folder.path, assetCount: 0 };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}
