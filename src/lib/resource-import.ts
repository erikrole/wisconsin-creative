import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { hasValidImageMagic, isAllowedImageType, isBlobUrl } from "@/lib/blob";
import { HttpError } from "@/lib/http";
import { assertPublicHost } from "@/lib/security/ssrf";
import { withSerializationRetry } from "@/lib/serialization";
import { sanitizeText } from "@/lib/sanitize";
import type { z } from "zod";
import { resourceImportManifestSchema } from "@/lib/validation";

export type ResourceImportManifest = z.infer<typeof resourceImportManifestSchema>;

const MAX_IMPORT_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_TOTAL_IMAGE_BYTES = 50 * 1024 * 1024;
const IMAGE_PLACEHOLDER = /\{\{image:([A-Za-z0-9][A-Za-z0-9_-]*)\}\}/g;

const RESOURCE_INCLUDE = {
  author: { select: { id: true, name: true } },
  lastVerifiedBy: { select: { id: true, name: true } },
} as const;

const RESOURCE_IMPORT_SELECT = {
  id: true,
  authorId: true,
  title: true,
  slug: true,
  type: true,
  category: true,
  importKey: true,
  markdown: true,
  published: true,
  featured: true,
  featuredRank: true,
  targetRoles: true,
  targetAreas: true,
  updatedAt: true,
} as const;

type ResourceClient = Prisma.TransactionClient | typeof db;
type ImportFiles = ReadonlyMap<string, File>;

type ImagePlan = {
  key: string;
  alt: string;
  url?: string;
  file?: File;
};

type ValidatedImport = {
  markdown: string;
  images: ImagePlan[];
  missingImageKeys: string[];
};

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function uniqueSlug(client: ResourceClient, base: string): Promise<string> {
  let candidate = base || "guide";
  let suffix = 1;

  while (true) {
    const existing = await client.resource.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });

    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base || "guide"}-${suffix}`;
  }
}

function placeholderKeys(markdown: string): string[] {
  return Array.from(markdown.matchAll(new RegExp(IMAGE_PLACEHOLDER.source, "g")))
    .map((match) => match[1]!)
    .filter((key, index, keys) => keys.indexOf(key) === index);
}

function escapeMarkdownAlt(alt: string): string {
  return sanitizeText(alt)
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\r?\n/g, " ");
}

function validateImageUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, "Image URL must be a valid http or https URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, "Image URL must use http or https");
  }
}

async function validateImportFiles(
  manifest: ResourceImportManifest,
  files: ImportFiles,
  allowMissingFiles: boolean,
): Promise<ValidatedImport> {
  const markdown = sanitizeText(manifest.markdown).trim();
  const keys = placeholderKeys(markdown);
  const manifestByKey = new Map(manifest.images.map((image) => [image.key, image]));

  for (const key of keys) {
    if (!manifestByKey.has(key)) {
      throw new HttpError(400, `Markdown references an undeclared image: ${key}`);
    }
  }

  for (const image of manifest.images) {
    if (!keys.includes(image.key)) {
      throw new HttpError(400, `Image ${image.key} is not referenced by the Markdown`);
    }
    if (image.url) validateImageUrl(image.url);
  }

  let totalBytes = 0;
  const missingImageKeys: string[] = [];
  const images: ImagePlan[] = [];

  for (const image of manifest.images) {
    const file = files.get(image.key);
    if (file) {
      if (!isAllowedImageType(file.type)) {
        throw new HttpError(400, `Image ${image.key} must be JPEG, PNG, WebP, or GIF`);
      }
      if (file.size > MAX_IMPORT_IMAGE_BYTES) {
        throw new HttpError(413, `Image ${image.key} is too large (max 10MB)`);
      }
      totalBytes += file.size;
      if (totalBytes > MAX_IMPORT_TOTAL_IMAGE_BYTES) {
        throw new HttpError(413, "Imported images are too large (max 50MB total)");
      }
      if (!(await hasValidImageMagic(file))) {
        throw new HttpError(400, `Image ${image.key} is not a valid raster image`);
      }
    } else if (!image.url) {
      missingImageKeys.push(image.key);
    }

    images.push({ key: image.key, alt: image.alt, url: image.url, file });
  }

  if (missingImageKeys.length > 0 && !allowMissingFiles) {
    throw new HttpError(
      400,
      `Missing image input for: ${missingImageKeys.join(", ")}. Attach image:<key> files or provide image URLs.`,
    );
  }

  return { markdown, images, missingImageKeys };
}

function importNamespace(importKey: string): string {
  return createHash("sha256").update(importKey).digest("hex").slice(0, 24);
}

function extensionForType(type: string): string {
  return {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  }[type] ?? "bin";
}

async function uploadImportFile(file: File, importKey: string, imageKey: string): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const pathname = `resources/imports/${importNamespace(importKey)}/${imageKey}-${digest}.${extensionForType(file.type)}`;

  const blob = await put(pathname, bytes, {
    access: "public",
    contentType: file.type,
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return blob.url;
}

async function readRemoteImageBody(response: Response): Promise<Buffer | null> {
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_IMPORT_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

function asArrayBuffer(bytes: Buffer): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function rehostRemoteImage(
  url: string,
  importKey: string,
  imageKey: string,
): Promise<string | null> {
  let currentUrl = url;

  for (let redirect = 0; redirect <= 3; redirect += 1) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

    try {
      await assertPublicHost(parsed.hostname);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(currentUrl, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            Accept: "image/jpeg,image/png,image/webp,image/gif,image/*;q=0.8",
            "User-Agent": "WisconsinCreativeResourceImporter/1.0",
          },
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location || redirect === 3) return null;
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }
        if (!response.ok) return null;

        const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
        if (!isAllowedImageType(contentType)) return null;
        const bytes = await readRemoteImageBody(response);
        if (!bytes || bytes.length === 0) return null;

        const file = new File([asArrayBuffer(bytes)], `${imageKey}.${extensionForType(contentType)}`, { type: contentType });
        if (!(await hasValidImageMagic(file))) return null;
        return uploadImportFile(file, importKey, imageKey);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function materializeImage(
  image: ImagePlan,
  importKey: string,
): Promise<string> {
  if (image.file) return uploadImportFile(image.file, importKey, image.key);
  if (!image.url) {
    throw new HttpError(400, `Missing image input for ${image.key}`);
  }
  if (isBlobUrl(image.url)) return image.url;

  const blobUrl = await rehostRemoteImage(
    image.url,
    importKey,
    image.key,
  );
  if (!blobUrl) {
    throw new HttpError(422, `Could not rehost image ${image.key}`);
  }
  return blobUrl;
}

function replaceImagePlaceholders(markdown: string, images: ImagePlan[], urls: Map<string, string>): string {
  let output = markdown;
  for (const image of images) {
    const url = urls.get(image.key);
    if (!url) throw new HttpError(500, `Image ${image.key} was not materialized`);
    output = output.split(`{{image:${image.key}}}`).join(`![${escapeMarkdownAlt(image.alt)}](${url})`);
  }
  return sanitizeText(output);
}

function markdownImageCount(markdown: string | null | undefined): number {
  return markdown?.match(/!\[[^\]]*\]\([^)]*\)/g)?.length ?? 0;
}

function auditSnapshot(resource: {
  title: string;
  type: string;
  category: string;
  published: boolean;
  featured: boolean;
  featuredRank: number | null;
  targetRoles: unknown;
  targetAreas: unknown;
  importKey: string | null;
}, imageCount: number, sourceLabel: string | null) {
  return {
    title: resource.title,
    type: resource.type,
    category: resource.category,
    published: resource.published,
    featured: resource.featured,
    featuredRank: resource.featuredRank,
    targetRoles: resource.targetRoles,
    targetAreas: resource.targetAreas,
    importKey: resource.importKey,
    imageCount,
    source: "resource_import",
    sourceLabel,
  };
}

export async function previewResourceImport(
  manifest: ResourceImportManifest,
  files: ImportFiles = new Map(),
): Promise<{
  importKey: string;
  sourceLabel: string | null;
  operation: "create" | "update";
  resourceId: string | null;
  slug: string;
  markdownLength: number;
  imageCount: number;
  missingImageKeys: string[];
  imageSources: Array<{ key: string; source: "file" | "url" | "missing" }>;
}> {
  const validated = await validateImportFiles(manifest, files, true);
  const existing = await db.resource.findUnique({
    where: { importKey: manifest.importKey },
    select: RESOURCE_IMPORT_SELECT,
  });
  const slug = existing?.slug ?? await uniqueSlug(db, slugify(manifest.title));

  return {
    importKey: manifest.importKey,
    sourceLabel: manifest.sourceLabel ?? null,
    operation: existing ? "update" : "create",
    resourceId: existing?.id ?? null,
    slug,
    markdownLength: validated.markdown.length,
    imageCount: validated.images.length,
    missingImageKeys: validated.missingImageKeys,
    imageSources: validated.images.map((image) => ({
      key: image.key,
      source: image.file ? "file" : image.url ? "url" : "missing",
    })),
  };
}

export async function importResource(input: {
  manifest: ResourceImportManifest;
  files?: ImportFiles;
  actorId: string;
  actorRole: Role;
}) {
  const files = input.files ?? new Map<string, File>();
  const validated = await validateImportFiles(input.manifest, files, false);

  // Check STAFF ownership before any Blob side effect. The transaction below
  // repeats this guard because the import key can be claimed between reads.
  if (input.actorRole === Role.STAFF) {
    const existing = await db.resource.findUnique({
      where: { importKey: input.manifest.importKey },
      select: { authorId: true },
    });
    if (existing && existing.authorId !== input.actorId) {
      throw new HttpError(403, "You can only import over your own resources");
    }
  }

  const imageUrls = new Map<string, string>();
  for (const image of validated.images) {
    imageUrls.set(
      image.key,
      await materializeImage(image, input.manifest.importKey),
    );
  }
  const markdown = replaceImagePlaceholders(validated.markdown, validated.images, imageUrls);

  return withSerializationRetry(() => db.$transaction(async (tx) => {
    const existing = await tx.resource.findUnique({
      where: { importKey: input.manifest.importKey },
      select: RESOURCE_IMPORT_SELECT,
    });

    if (existing && input.actorRole === Role.STAFF && existing.authorId !== input.actorId) {
      throw new HttpError(403, "You can only import over your own resources");
    }

    const featuredRank = input.manifest.featured
      ? input.manifest.featuredRank ?? null
      : null;
    const commonData = {
      title: input.manifest.title,
      type: input.manifest.type,
      category: input.manifest.category,
      markdown,
      targetRoles: input.manifest.targetRoles,
      targetAreas: input.manifest.targetAreas,
      featured: input.manifest.featured,
      featuredRank,
      published: input.manifest.published,
      importKey: input.manifest.importKey,
    };

    const operation = existing ? "update" : "create";
    const guide = existing
      ? await tx.resource.update({
        where: { id: existing.id },
        data: commonData,
        include: RESOURCE_INCLUDE,
      })
      : await tx.resource.create({
        data: {
          ...commonData,
          slug: await uniqueSlug(tx, slugify(input.manifest.title)),
          content: [],
          authorId: input.actorId,
        },
        include: RESOURCE_INCLUDE,
      });

    await createAuditEntryTx(tx, {
      actorId: input.actorId,
      actorRole: input.actorRole,
      entityType: "resource",
      entityId: guide.id,
      action: operation === "create" ? "resource_created" : "resource_updated",
      before: existing
        ? auditSnapshot(existing, markdownImageCount(existing.markdown), null)
        : undefined,
      after: auditSnapshot(guide, validated.images.length, input.manifest.sourceLabel ?? null),
    });

    return { operation: operation as "create" | "update", guide };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
