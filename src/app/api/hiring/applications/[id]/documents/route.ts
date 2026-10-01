import { ApplicantDocumentKind } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  documentPathname,
  isApplicantFileType,
  matchesFileSignature,
  MAX_APPLICANT_FILE_BYTES,
  safeFileName,
} from "@/lib/hiring/files";
import { deleteApplicantFile, putApplicantFile } from "@/lib/hiring/storage";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "hiring", "manage");
  await enforceRateLimit(`hiring:upload:${user.id}`, SETTINGS_MUTATION_LIMIT);

  const application = await db.application.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!application) throw new HttpError(404, "Application not found.");

  const form = await req.formData();
  const file = form.get("file");
  const rawKind = String(form.get("kind") ?? "RESUME");
  if (!(file instanceof File)) throw new HttpError(400, "A file is required.");
  if (!(rawKind in ApplicantDocumentKind)) throw new HttpError(400, "Unknown document kind.");
  const kind = rawKind as ApplicantDocumentKind;

  if (file.size === 0) throw new HttpError(400, "The file is empty.");
  if (file.size > MAX_APPLICANT_FILE_BYTES) throw new HttpError(413, "Files must be 4 MB or smaller.");
  if (!isApplicantFileType(file.type)) throw new HttpError(415, "Upload a PDF, PNG, or JPEG.");

  const buffer = await file.arrayBuffer();
  if (!matchesFileSignature(new Uint8Array(buffer.slice(0, 16)), file.type)) {
    throw new HttpError(415, "The file contents do not match its type.");
  }

  const id = randomUUID();
  const pathname = documentPathname(params.id, kind, id, file.type);
  await putApplicantFile(pathname, buffer, file.type);

  try {
    const doc = await db.applicantDocument.create({
      data: {
        id,
        applicationId: params.id,
        kind,
        pathname,
        fileName: safeFileName(file.name),
        contentType: file.type,
        sizeBytes: file.size,
        uploadedById: user.id,
      },
      select: { id: true, kind: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true },
    });
    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "hiring_application",
      entityId: params.id,
      action: "document_add",
      after: { documentId: doc.id, kind },
    });
    return ok({ data: doc }, 201);
  } catch (error) {
    // Best effort: do not mask the original failure if cleanup also fails.
    await deleteApplicantFile(pathname).catch(() => undefined);
    throw error;
  }
});
