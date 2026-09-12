import { createHash } from "node:crypto";
import { Prisma, ResourceType, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { withSerializationRetry } from "@/lib/serialization";
import type { z } from "zod";
import { resourceImportManifestSchema } from "@/lib/validation";
import {
  downloadImportImage, MAX_IMPORT_TOTAL_IMAGE_BYTES, uploadImportImage,
  validateImportImage, validateImportImageUrl,
} from "@/lib/resource-import-images";

export type ResourceImportManifest = z.infer<typeof resourceImportManifestSchema>;
type ImportInput = {
  manifest: ResourceImportManifest;
  files?: ReadonlyMap<string, File>;
  actorId: string;
  actorRole: Role;
};
const IMAGE_PLACEHOLDER = /\{\{image:([A-Za-z0-9][A-Za-z0-9_-]*)\}\}/g;
const RESOURCE_INCLUDE = {
  author: { select: { id: true, name: true } },
  lastVerifiedBy: { select: { id: true, name: true } },
} as const;
const RESOURCE_IMPORT_SELECT = {
  id: true, authorId: true, title: true, slug: true, type: true, category: true,
  importKey: true, markdown: true, published: true, featured: true,
  featuredRank: true, targetRoles: true, targetAreas: true, updatedAt: true,
} as const;
type Existing = Prisma.ResourceGetPayload<{ select: typeof RESOURCE_IMPORT_SELECT }>;
type ResourceClient = Prisma.TransactionClient | typeof db;

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "guide";
}

async function uniqueSlug(client: ResourceClient, base: string): Promise<string> {
  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const slug = suffix === 1 ? base : `${base}-${suffix}`;
    if (!await client.resource.findUnique({ where: { slug }, select: { id: true } })) return slug;
  }
  throw new HttpError(409, "Too many guides have this title. Choose a more specific title.");
}

function assertOwnership(existing: Existing | null, input: ImportInput): void {
  if (existing && input.actorRole === Role.STAFF && existing.authorId !== input.actorId) {
    throw new HttpError(403, "You can only import over your own resources");
  }
}

function assertVersion(existing: Existing | null, manifest: ResourceImportManifest): void {
  if (existing ? existing.updatedAt.toISOString() !== manifest.expectedUpdatedAt : manifest.expectedUpdatedAt !== undefined) {
    throw new HttpError(409, "Guide changed or an update version is missing. Dry-run again and send its expectedUpdatedAt.");
  }
}

async function validateInput(input: ImportInput, allowMissing: boolean) {
  requirePermission(input.actorRole, "resource", "import");
  const manifest = resourceImportManifestSchema.parse(input.manifest);
  const files = input.files ?? new Map<string, File>();
  // Preserve CommonMark angle links and code. Both readers drop raw HTML and
  // disallow unsafe link schemes; plain-text sanitization corrupts Markdown.
  const markdown = manifest.markdown;
  const keys = new Set(Array.from(markdown.matchAll(IMAGE_PLACEHOLDER), (match) => match[1]));
  const declared = new Set(manifest.images.map((image) => image.key));
  if (markdown.replace(IMAGE_PLACEHOLDER, "").includes("{{image:")) throw new HttpError(400, "Malformed image placeholder");
  for (const key of keys) {
    if (!declared.has(key!)) throw new HttpError(400, `Markdown references an undeclared image: ${key}`);
  }
  for (const key of files.keys()) {
    if (!declared.has(key)) throw new HttpError(400, `Undeclared image file: ${key}`);
  }
  let total = 0;
  const missingImageKeys: string[] = [];
  for (const image of manifest.images) {
    if (!keys.has(image.key)) throw new HttpError(400, `Image ${image.key} is not referenced by the Markdown`);
    const file = files.get(image.key);
    if (file && image.url) throw new HttpError(400, `Supply a file or URL for ${image.key}, not both`);
    if (image.url) validateImportImageUrl(image.url);
    if (file) {
      await validateImportImage(file, image.key);
      total += file.size;
    } else if (!image.url) missingImageKeys.push(image.key);
  }
  if (total > MAX_IMPORT_TOTAL_IMAGE_BYTES) throw new HttpError(413, "Imported images exceed 20MB total");
  if (!allowMissing && missingImageKeys.length) throw new HttpError(400, `Missing image input for: ${missingImageKeys.join(", ")}`);
  return { manifest, files, missingImageKeys };
}

function resourceData(manifest: ResourceImportManifest, markdown: string, existing: Existing | null) {
  const featured = manifest.featured ?? existing?.featured ?? false;
  return {
    title: manifest.title, category: manifest.category, markdown, importKey: manifest.importKey,
    type: manifest.type ?? existing?.type ?? ResourceType.GENERAL,
    targetRoles: manifest.targetRoles ?? existing?.targetRoles ?? [],
    targetAreas: manifest.targetAreas ?? existing?.targetAreas ?? [],
    published: manifest.published ?? existing?.published ?? false,
    featured,
    featuredRank: featured
      ? manifest.featuredRank === undefined ? existing?.featuredRank ?? null : manifest.featuredRank
      : null,
  };
}

function sameData(existing: Existing, data: ReturnType<typeof resourceData>) {
  return Object.entries(data).every(([key, value]) =>
    JSON.stringify(existing[key as keyof Existing]) === JSON.stringify(value));
}

function auditSnapshot(resource: Omit<ReturnType<typeof resourceData>, "markdown"> & { markdown: string | null }) {
  const { markdown, ...metadata } = resource;
  return { ...metadata, markdownLength: markdown?.length ?? 0,
    markdownSha256: createHash("sha256").update(markdown ?? "").digest("hex"), source: "resource_import" };
}

export async function previewResourceImport(input: ImportInput) {
  const { manifest, files, missingImageKeys } = await validateInput(input, true);
  const existing = await db.resource.findUnique({ where: { importKey: manifest.importKey }, select: RESOURCE_IMPORT_SELECT });
  assertOwnership(existing, input);
  return {
    importKey: manifest.importKey, sourceLabel: manifest.sourceLabel ?? null,
    operation: existing ? "update" : "create", resourceId: existing?.id ?? null,
    slug: existing?.slug ?? await uniqueSlug(db, slugify(manifest.title)),
    expectedUpdatedAt: existing?.updatedAt.toISOString() ?? null,
    markdownLength: manifest.markdown.length, imageCount: manifest.images.length, missingImageKeys,
    proposed: resourceData(manifest, manifest.markdown, existing),
    imageSources: manifest.images.map((image) => ({ key: image.key, source: files.has(image.key) ? "file" : image.url ? "url" : "missing" })),
    warnings: manifest.images.length ? ["Dry-run checks image inputs but does not download remote images or test Blob credentials."] : [],
  };
}

export async function importResource(input: ImportInput) {
  const { manifest, files } = await validateInput(input, false);
  const before = await db.resource.findUnique({ where: { importKey: manifest.importKey }, select: RESOURCE_IMPORT_SELECT });
  assertOwnership(before, input);
  assertVersion(before, manifest);

  const signal = AbortSignal.timeout(25_000);
  const prepared = new Map<string, File>();
  let totalBytes = 0;
  // Validate ALL bytes before uploading; a shared deadline bounds the batch.
  for (const image of manifest.images) {
    const file = files.get(image.key) ?? await downloadImportImage(image.url!, image.key, signal);
    totalBytes += file.size;
    if (totalBytes > MAX_IMPORT_TOTAL_IMAGE_BYTES) throw new HttpError(413, "Imported images exceed 20MB total");
    prepared.set(image.key, file);
  }
  const urls = new Map<string, string>();
  for (const [key, file] of prepared) urls.set(key, await uploadImportImage(file, manifest.importKey, key, signal));
  const markdown = manifest.markdown.replace(IMAGE_PLACEHOLDER, (_, key: string) => {
    const image = manifest.images.find((image) => image.key === key)!;
    const alt = image.alt.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/[\r\n]/g, " ");
    const url = urls.get(key)!.replace(/[()<> ]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return `![${alt}](${url})`;
  });
  if (markdown.length > 200_000) throw new HttpError(413, "Final Markdown exceeds 200,000 characters");

  // Content-addressed Blobs are retryable, not transaction-owned. Never delete
  // a URL another import may reference after a DB/audit failure.
  const commit = () => withSerializationRetry(() => db.$transaction(async (tx) => {
    const existing = await tx.resource.findUnique({ where: { importKey: manifest.importKey }, select: RESOURCE_IMPORT_SELECT });
    assertOwnership(existing, input);
    const data = resourceData(manifest, markdown, existing);
    if (existing && sameData(existing, data)) {
      const guide = await tx.resource.findUniqueOrThrow({ where: { id: existing.id }, include: RESOURCE_INCLUDE });
      return { operation: "unchanged" as const, guide };
    }
    assertVersion(existing, manifest);
    const guide = existing
      ? await tx.resource.update({ where: { id: existing.id }, data, include: RESOURCE_INCLUDE })
      : await tx.resource.create({ data: { ...data, slug: await uniqueSlug(tx, slugify(manifest.title)), content: [], authorId: input.actorId }, include: RESOURCE_INCLUDE });
    await createAuditEntryTx(tx, {
      actorId: input.actorId, actorRole: input.actorRole, entityType: "resource", entityId: guide.id,
      action: existing ? "resource_updated" : "resource_created",
      before: existing ? auditSnapshot({ ...existing, importKey: manifest.importKey }) : undefined,
      after: { ...auditSnapshot(data), sourceLabel: manifest.sourceLabel ?? null, imageCount: manifest.images.length },
    });
    return { operation: existing ? "update" as const : "create" as const, guide };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  try {
    return await commit();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return commit();
    throw error;
  }
}
