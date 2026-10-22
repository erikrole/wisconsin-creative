import { Role } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";

/** Custody moves only: gear leaving at the kiosk and checkouts fully returned. */
const HOME_ACTIVITY_ACTIONS = {
  kiosk_checkout: "out",
  kiosk_pickup: "out",
  checkin_completed: "returned",
} as const;

const WINDOW_MS = 24 * 3_600_000;
const LIMIT = 8;

type HomeActivityRow = {
  id: string;
  kind: "out" | "returned";
  bookingId: string;
  title: string;
  person: { id: string; name: string; avatarUrl: string | null } | null;
  at: string;
};

/**
 * GET /api/dashboard/activity — the latest pickups and returns for Home.
 * Staff and admins already see every checkout on Bookings; this is the same
 * information in time order. Students and collaborators are refused.
 */
export const GET = withAuth(async (_req, { user }) => {
  requireRole(user.role, [Role.ADMIN, Role.STAFF]);

  const logs = await db.auditLog.findMany({
    where: {
      entityType: "booking",
      action: { in: Object.keys(HOME_ACTIVITY_ACTIONS) },
      createdAt: { gte: new Date(Date.now() - WINDOW_MS) },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIMIT,
    select: { id: true, action: true, entityId: true, createdAt: true },
  });

  const bookings = logs.length
    ? await db.booking.findMany({
        where: { id: { in: [...new Set(logs.map((l) => l.entityId))] } },
        select: { id: true, title: true, requester: { select: { id: true, name: true, avatarUrl: true } } },
      })
    : [];
  const byId = new Map(bookings.map((b) => [b.id, b]));

  const data: HomeActivityRow[] = [];
  for (const log of logs) {
    const booking = byId.get(log.entityId);
    if (!booking) continue;
    data.push({
      id: log.id,
      kind: HOME_ACTIVITY_ACTIONS[log.action as keyof typeof HOME_ACTIVITY_ACTIONS],
      bookingId: booking.id,
      title: booking.title,
      person: booking.requester
        ? { id: booking.requester.id, name: booking.requester.name, avatarUrl: booking.requester.avatarUrl ?? null }
        : null,
      at: log.createdAt.toISOString(),
    });
  }
  return ok({ data });
});
