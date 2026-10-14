import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { databaseIdSchema } from "@/lib/validation";
import {
  applyCleanupWizardAttach,
  applyCleanupWizardQr,
  applyCleanupWizardSerial,
  deferCleanupWizardItem,
  getCleanupWizardCounts,
  listCleanupWizardQueue,
  parseCleanupWizardKind,
} from "@/lib/services/item-cleanup-wizard";

const queueQuerySchema = z.object({
  kind: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(25).optional(),
  exclude: z.string().optional(),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_qr"),
    assetId: databaseIdSchema,
    code: z.string().trim().min(1).max(200),
  }),
  z.object({
    action: z.literal("set_serial"),
    assetId: databaseIdSchema,
    serialNumber: z.string().trim().min(1).max(500),
  }),
  z.object({
    action: z.literal("attach"),
    assetId: databaseIdSchema,
    parentAssetId: databaseIdSchema,
  }),
  z.object({
    action: z.literal("defer"),
    assetId: databaseIdSchema,
    kind: z.enum(["legacy_qr", "missing_serial", "attachment_candidate"]),
    reason: z.enum(["no_printed_qr", "no_serial", "keep_standalone", "needs_shelf_check", "other"]),
  }),
]);

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "asset", "edit");

  const url = new URL(req.url);
  const query = queueQuerySchema.parse({
    kind: url.searchParams.get("kind") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    exclude: url.searchParams.get("exclude") ?? undefined,
  });

  const counts = await getCleanupWizardCounts();
  if (!query.kind) {
    return ok({ data: { counts } });
  }

  const kind = parseCleanupWizardKind(query.kind);
  const excludeIds = (query.exclude ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 100);
  const items = await listCleanupWizardQueue(kind, query.limit ?? 8, excludeIds);
  return ok({
    data: {
      counts,
      kind,
      items,
    },
  });
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "asset", "edit");

  const body = actionSchema.parse(await req.json());
  const actor = { id: user.id, role: user.role };

  if (body.action === "set_qr") {
    const item = await applyCleanupWizardQr({
      assetId: body.assetId,
      code: body.code,
      actor,
    });
    return ok({ data: { item, counts: await getCleanupWizardCounts() } });
  }

  if (body.action === "set_serial") {
    const item = await applyCleanupWizardSerial({
      assetId: body.assetId,
      serialNumber: body.serialNumber,
      actor,
    });
    return ok({ data: { item, counts: await getCleanupWizardCounts() } });
  }

  if (body.action === "attach") {
    const item = await applyCleanupWizardAttach({
      assetId: body.assetId,
      parentAssetId: body.parentAssetId,
      actor,
    });
    return ok({ data: { item, counts: await getCleanupWizardCounts() } });
  }

  const result = await deferCleanupWizardItem({
    assetId: body.assetId,
    kind: body.kind,
    reason: body.reason,
    actor,
  });
  return ok({ data: { ...result, counts: await getCleanupWizardCounts() } });
});
