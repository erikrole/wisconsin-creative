import { withAuth } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { getResourceAssetVersion } from "@/lib/resource-assets";
import { getResourceAssetBlob } from "@/lib/resource-assets-storage";
import { NextResponse } from "next/server";

function safeDownloadName(name: string): string {
  const leaf = name.split(/[\\/]/).pop()?.trim() || "brand-asset";
  return leaf.replace(/[\u0000-\u001f\u007f"\\]/g, "-").slice(0, 180) || "brand-asset";
}

function contentDisposition(name: string, inline: boolean): string {
  const safeName = safeDownloadName(name);
  const fallback = safeName.replace(/[^a-zA-Z0-9._-]/g, "-") || "brand-asset";
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

function isInlineType(contentType: string): boolean {
  return contentType === "application/pdf"
    || contentType.startsWith("image/")
    || contentType.startsWith("font/")
    || contentType === "application/x-font-opentype"
    || contentType === "application/x-font-ttf"
    || contentType === "application/vnd.ms-fontobject";
}

export const GET = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "resource", "view");
  const searchParams = new URL(req.url).searchParams;
  const versionId = searchParams.get("versionId");
  const forceDownload = searchParams.get("download") === "1";
  const version = await getResourceAssetVersion(params.id, versionId);
  const blob = await getResourceAssetBlob(version.storagePath);
  if (!blob) throw new HttpError(404, "Brand asset file not found.");
  const inline = !forceDownload && isInlineType(version.contentType);

  return new NextResponse(blob.stream, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDisposition(version.originalName, inline),
      // Trust the stored object's own length. The version row's size is written
      // from the same HEAD, but a mismatch here would truncate or hang the
      // response rather than fail loudly.
      "Content-Length": String(blob.blob.size),
      "Content-Type": version.contentType,
      "X-Content-Type-Options": "nosniff",
      // SVG is the one uploadable type that becomes an active document when it
      // is opened top-level on our own origin. Sandbox it so a hostile upload
      // cannot run script against the signed-in session; <img> rendering, which
      // never executes SVG script, is unaffected.
      ...(version.contentType === "image/svg+xml"
        ? { "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:" }
        : {}),
      // next.config applies DENY globally; inline authenticated previews need
      // a same-origin exception so PDF iframes can render inside the dialog.
      "X-Frame-Options": inline ? "SAMEORIGIN" : "DENY",
    },
  });
});
