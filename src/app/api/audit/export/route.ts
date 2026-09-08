import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { csvField } from "@/lib/csv";
import { parseOptionalDate, assertDateOrder } from "@/lib/api-dates";

const EXPORT_LIMIT = 5000;

export const GET = withAuth(async (req, { user }) => {
  if (user.role !== "ADMIN") throw new HttpError(403, "Admin access required");
  await enforceRateLimit(`audit:export:${user.id}`, { max: 5, windowMs: 60_000 });

  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const entityTypeParam = searchParams.get("entity_type");

  const from = parseOptionalDate(fromParam, "from");
  const to = parseOptionalDate(toParam, "to");
  assertDateOrder(from, to, "to must be on or after from");

  const where = {
    ...(entityTypeParam ? { entityType: entityTypeParam } : {}),
    ...(from || to ? {
      createdAt: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      },
    } : {}),
  };

  const [logs, totalCount] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { actor: { select: { name: true, email: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: EXPORT_LIMIT,
    }),
    db.auditLog.count({ where }),
  ]);

  const truncated = totalCount > EXPORT_LIMIT;

  const headers = [
    "Timestamp", "Entity Type", "Entity ID", "Action",
    "Actor", "Actor Email", "Before", "After",
  ];

  const rows = logs.map((l) => [
    csvField(l.createdAt.toISOString()),
    csvField(l.entityType),
    csvField(l.entityId),
    csvField(l.action),
    csvField(l.actor?.name ?? ""),
    csvField(l.actor?.email ?? ""),
    csvField(l.beforeJson != null ? JSON.stringify(l.beforeJson) : ""),
    csvField(l.afterJson != null ? JSON.stringify(l.afterJson) : ""),
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-export-${date}.csv"`,
      ...(truncated ? { "X-Total-Count": String(totalCount), "X-Truncated": "true" } : {}),
    },
  });
});
