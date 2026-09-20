import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { unique } from "@/lib/utils";

const ITEM_CHANGE_LIMIT = { max: 180, windowMs: 60_000 };
const MAX_CHANGE_ROWS = 100;
const EMPTY_CURSOR_DATE = new Date(0);
const ITEM_AUDIT_ENTITY_TYPES = ["asset", "bulk_sku"] as const;

type ItemChangeCursor = {
  at: string;
};

function encodeCursor(date: Date): string {
  return Buffer.from(JSON.stringify({ at: date.toISOString() } satisfies ItemChangeCursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | null): Date | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ItemChangeCursor>;
    if (typeof parsed.at === "string") return parseDate(parsed.at);
  } catch {
    // Accept ISO timestamps too so the route remains easy to probe locally.
  }

  return parseDate(value);
}

function parseDate(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new HttpError(400, "Invalid item change cursor");
  return date;
}

function latestDate(dates: Date[]): Date {
  if (dates.length === 0) return EMPTY_CURSOR_DATE;
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "asset", "view");
  requirePermission(user.role, "bulk_sku", "view");

  const { allowed } = await checkRateLimit(`items:changes:${user.id}`, ITEM_CHANGE_LIMIT);
  if (!allowed) throw new HttpError(429, "Too many requests. Please wait a moment.");

  const { searchParams } = new URL(req.url);
  const since = decodeCursor(searchParams.get("since"));

  if (!since) {
    const [latestAsset, latestBulkSku, latestAudit] = await Promise.all([
      db.asset.findFirst({
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
      db.bulkSku.findFirst({
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
      db.auditLog.findFirst({
        where: { entityType: { in: [...ITEM_AUDIT_ENTITY_TYPES] } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);
    const cursorDate = latestDate([
      latestAsset?.updatedAt ?? EMPTY_CURSOR_DATE,
      latestBulkSku?.updatedAt ?? EMPTY_CURSOR_DATE,
      latestAudit?.createdAt ?? EMPTY_CURSOR_DATE,
    ]);
    return ok({ data: { cursor: encodeCursor(cursorDate), changedAssetIds: [], changedBulkSkuIds: [] } });
  }

  const [assetRows, bulkSkuRows, auditRows] = await Promise.all([
    db.asset.findMany({
      where: { updatedAt: { gt: since } },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: { id: true, updatedAt: true },
      take: MAX_CHANGE_ROWS,
    }),
    db.bulkSku.findMany({
      where: { updatedAt: { gt: since } },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: { id: true, updatedAt: true },
      take: MAX_CHANGE_ROWS,
    }),
    db.auditLog.findMany({
      where: { entityType: { in: [...ITEM_AUDIT_ENTITY_TYPES] }, createdAt: { gt: since } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { entityType: true, entityId: true, createdAt: true },
      take: MAX_CHANGE_ROWS,
    }),
  ]);

  const changedAssetIds = unique([
    ...assetRows.map((row) => row.id),
    ...auditRows.filter((row) => row.entityType === "asset").map((row) => row.entityId),
  ]);
  const changedBulkSkuIds = unique([
    ...bulkSkuRows.map((row) => row.id),
    ...auditRows.filter((row) => row.entityType === "bulk_sku").map((row) => row.entityId),
  ]);
  const cursorDate = latestDate([
    since,
    ...assetRows.map((row) => row.updatedAt),
    ...bulkSkuRows.map((row) => row.updatedAt),
    ...auditRows.map((row) => row.createdAt),
  ]);

  return ok({ data: { cursor: encodeCursor(cursorDate), changedAssetIds, changedBulkSkuIds } });
});
