import { withAuth } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import {
  importResource,
  previewResourceImport,
  type ResourceImportManifest,
} from "@/lib/resource-import";
import {
  resourceImportManifestSchema,
  resourceImportRequestSchema,
} from "@/lib/validation";

const IMPORT_LIMIT = { max: 10, windowMs: 5 * 60_000 };
export const runtime = "nodejs";
export const maxDuration = 60;
// Leave room under the serverless request-body ceiling, including multipart.
const MAX_REQUEST_BYTES = 4_000_000;

function parseMultipartBoolean(value: FormDataEntryValue | null): boolean {
  if (value === null) return true;
  if (typeof value !== "string") throw new HttpError(400, "dryRun must be true or false");
  if (value === "true") return true;
  if (value === "false") return false;
  throw new HttpError(400, "dryRun must be true or false");
}

async function parseImportRequest(req: Request): Promise<{
  manifest: ResourceImportManifest;
  dryRun: boolean;
  files: Map<string, File>;
}> {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  const mime = contentType.split(";")[0]?.trim();
  if (mime !== "multipart/form-data" && mime !== "application/json") {
    throw new HttpError(415, "Use application/json or multipart/form-data");
  }
  if (Number(req.headers.get("content-length")) > MAX_REQUEST_BYTES) {
    throw new HttpError(413, "Import request exceeds 4MB. Use remote image URLs or smaller files.");
  }
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Import body is required");
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) throw new HttpError(413, "Import request exceeds 4MB");
      chunks.push(Uint8Array.from(value).buffer);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bodyResponse = new Response(new Blob(chunks), { headers: { "content-type": req.headers.get("content-type")! } });

  if (contentType.toLowerCase().includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await bodyResponse.formData();
    } catch {
      throw new HttpError(400, "Malformed multipart import");
    }
    const rawManifest = formData.get("manifest");
    if (typeof rawManifest !== "string") {
      throw new HttpError(400, "manifest must be a JSON object");
    }

    let parsedManifest: unknown;
    try {
      parsedManifest = JSON.parse(rawManifest);
    } catch {
      throw new HttpError(400, "manifest must be valid JSON");
    }

    const manifest = resourceImportManifestSchema.parse(parsedManifest);
    const allowed = new Set(["manifest", "dryRun", ...manifest.images.map((image) => `image:${image.key}`)]);
    for (const key of formData.keys()) {
      if (!allowed.has(key) || formData.getAll(key).length !== 1) {
        throw new HttpError(400, `Unknown or duplicate multipart field: ${key}`);
      }
    }
    const files = new Map<string, File>();
    for (const image of manifest.images) {
      const part = formData.get(`image:${image.key}`);
      if (part === null) continue;
      if (!(part instanceof File)) {
        throw new HttpError(400, `image:${image.key} must be a file`);
      }
      files.set(image.key, part);
    }

    return {
      manifest,
      dryRun: parseMultipartBoolean(formData.get("dryRun")),
      files,
    };
  }

  let json: unknown;
  try {
    json = await bodyResponse.json();
  } catch {
    throw new HttpError(400, "Import body must be valid JSON");
  }
  const body = resourceImportRequestSchema.parse(json);
  return { manifest: body.manifest, dryRun: body.dryRun, files: new Map() };
}

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "resource", "import");

  const { allowed } = await checkRateLimit(`resource:import:${user.id}`, IMPORT_LIMIT);
  if (!allowed) {
    throw new HttpError(429, "Too many resource imports. Please wait a moment.");
  }

  const { manifest, dryRun, files } = await parseImportRequest(req);
  if (dryRun) {
    return ok({ data: await previewResourceImport({ manifest, files, actorId: user.id, actorRole: user.role }) });
  }

  const result = await importResource({
    manifest,
    files,
    actorId: user.id,
    actorRole: user.role,
  });

  return ok({
    data: result.guide,
    meta: {
      operation: result.operation,
      importKey: manifest.importKey,
      imageCount: manifest.images.length,
    },
  }, result.operation === "create" ? 201 : 200);
});
