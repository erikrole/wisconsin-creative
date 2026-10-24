import { appTzDateKey } from "@/lib/app-time";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { listAllCodes } from "@/lib/services/licenses";
import { csvField } from "@/lib/csv";
import { createAuditEntry } from "@/lib/audit";

const EXPORT_LIMIT = { max: 5, windowMs: 60_000 };

export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "license", "manage");
  const { allowed } = await checkRateLimit(`license:export:${user.id}`, EXPORT_LIMIT);
  if (!allowed) throw new HttpError(429, "Too many requests. Please wait a moment.");

  const codes = await listAllCodes();

  const header = [
    "code",
    "label",
    "account_email",
    "status",
    "holder_1",
    "holder_2",
    "expires_at",
    "created_at",
  ].join(",");

  const rows = codes.map((c) => {
    const holders = c.claims.map((claim) => claim.user?.name ?? claim.occupantLabel ?? "Unknown");
    return [
      csvField(c.code),
      csvField(c.label),
      csvField(c.accountEmail),
      csvField(c.status),
      csvField(holders[0]),
      csvField(holders[1]),
      csvField(c.expiresAt?.toISOString()),
      csvField(c.createdAt.toISOString()),
    ].join(",");
  });

  const body = [header, ...rows].join("\n");
  const filename = `licenses-${appTzDateKey(new Date())}.csv`;

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "license_code",
    entityId: "all",
    action: "export",
    after: { rowCount: codes.length },
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
