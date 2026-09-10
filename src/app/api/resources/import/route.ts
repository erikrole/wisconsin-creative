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

function parseMultipartBoolean(value: FormDataEntryValue | null): boolean {
  if (value === null) return false;
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
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.toLowerCase().includes("multipart/form-data")) {
    const formData = await req.formData();
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

  const body = resourceImportRequestSchema.parse(await req.json());
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
    return ok({ data: await previewResourceImport(manifest, files) });
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
