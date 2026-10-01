import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { safeFileName } from "@/lib/hiring/files";
import { deleteApplicantFile, getApplicantFile } from "@/lib/hiring/storage";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";

function contentDisposition(name: string, inline: boolean): string {
  const safe = safeFileName(name);
  const fallback = safe.replace(/[^a-zA-Z0-9._-]/g, "-") || "document";
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export const GET = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "hiring", "view");
  const doc = await db.applicantDocument.findUnique({
    where: { id: params.id },
    select: { id: true, applicationId: true, pathname: true, fileName: true, contentType: true },
  });
  if (!doc) throw new HttpError(404, "Document not found.");

  const blob = await getApplicantFile(doc.pathname);
  if (!blob) throw new HttpError(404, "The file could not be found.");

  const inline = new URL(req.url).searchParams.get("download") !== "1";

  // Reads of applicant files are audited (D-065); the pathname is never logged.
  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "hiring_application",
    entityId: doc.applicationId,
    action: "document_view",
    after: { documentId: doc.id, download: !inline },
  });

  return new NextResponse(blob.stream, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDisposition(doc.fileName, inline),
      "Content-Length": String(blob.blob.size),
      "Content-Type": doc.contentType,
      "X-Content-Type-Options": "nosniff",
      // next.config applies DENY globally; the inline resume viewer needs a
      // same-origin exception so the PDF can render in an iframe.
      "X-Frame-Options": inline ? "SAMEORIGIN" : "DENY",
    },
  });
});

export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "hiring", "manage");
  await enforceRateLimit(`hiring:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const doc = await db.applicantDocument.findUnique({
    where: { id: params.id },
    select: { id: true, applicationId: true, pathname: true, kind: true },
  });
  if (!doc) throw new HttpError(404, "Document not found.");

  await db.applicantDocument.delete({ where: { id: doc.id } });
  await deleteApplicantFile(doc.pathname);

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "hiring_application",
    entityId: doc.applicationId,
    action: "document_delete",
    after: { documentId: doc.id, kind: doc.kind },
  });

  return ok({ deleted: true });
});
