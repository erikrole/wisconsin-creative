import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { ResourceAssetUploadStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { assertResourceAssetStorageConfigured } from "@/lib/resource-assets-storage";

const clientPayloadSchema = z.object({
  intentId: z.string().trim().min(1).max(100),
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "resource", "edit");
  const token = assertResourceAssetStorageConfigured();
  const body = (await req.json()) as HandleUploadBody;

  const result = await handleUpload({
    token,
    request: req,
    body,
    onBeforeGenerateToken: async (pathname, clientPayload) => {
      let payload: z.infer<typeof clientPayloadSchema>;
      try {
        payload = clientPayloadSchema.parse(JSON.parse(clientPayload ?? "{}"));
      } catch {
        throw new HttpError(400, "Invalid brand asset upload payload.");
      }

      const intent = await db.resourceAssetUpload.findUnique({ where: { id: payload.intentId } });
      if (!intent || intent.actorId !== user.id) throw new HttpError(404, "Upload intent not found.");
      if (intent.status !== ResourceAssetUploadStatus.PENDING) throw new HttpError(409, "Upload intent is no longer active.");
      if (intent.expiresAt.getTime() <= Date.now()) throw new HttpError(410, "Upload intent expired.");
      if (pathname !== intent.storagePath) throw new HttpError(400, "Upload path does not match the pending intent.");

      return {
        allowedContentTypes: [intent.contentType],
        maximumSizeInBytes: intent.sizeBytes,
        validUntil: intent.expiresAt.getTime(),
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 60,
      };
    },
  });

  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  });
});
