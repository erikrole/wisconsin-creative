import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { isGlobalKioskCollaborator } from "@/lib/collaborator-access";
import { collaboratorPolicyActorSelect } from "@/lib/services/collaborator-policies";
import { normalizeTeamAbbreviations } from "@/lib/title-normalization";

/** Get a student's active checkouts, pending pickups, and upcoming reservations */
export const GET = withKiosk<{ userId: string }>(async (req, { kiosk, params }) => {
  const ip = getClientIp(req);
  await enforceRateLimit(`kiosk:student:${kiosk.kioskId}:${ip}`, { max: 120, windowMs: 60_000 });
  await enforceRateLimit(`kiosk:student:${kiosk.kioskId}:${ip}:${params.userId}`, { max: 30, windowMs: 60_000 });

  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      active: true,
      hiddenFromRoster: true,
      role: true,
      affiliation: true,
      collaboratorProfile: true,
      collaboratorPolicy: { select: collaboratorPolicyActorSelect },
    },
  });

  if (!user || !user.active || user.hiddenFromRoster) {
    throw new HttpError(404, "User not found");
  }

  // Person discovery is global, but collaborators still need explicit kiosk
  // roster eligibility. Kiosk custody data is global too; check-in is the
  // event that transfers returned gear to this kiosk.
  if (user.role === "COLLABORATOR" && !isGlobalKioskCollaborator(user)) {
    throw new HttpError(404, "User not found");
  }

  const now = new Date();

  const [checkouts, pendingPickups, dueReservations, reservations] = await Promise.all([
    // Active checkouts (OPEN)
    db.booking.findMany({
      where: {
        requesterUserId: params.userId,
        kind: "CHECKOUT",
        status: "OPEN",
      },
      orderBy: { endsAt: "asc" },
      select: {
        id: true,
        title: true,
        refNumber: true,
        endsAt: true,
        serializedItems: {
          where: { allocationStatus: "active" },
          select: {
            asset: {
              select: { assetTag: true, name: true },
            },
          },
        },
        bulkItems: {
          select: {
            checkedOutQuantity: true,
            plannedQuantity: true,
            bulkSku: { select: { name: true } },
          },
        },
      },
    }),

    // Pending pickups (PENDING_PICKUP)
    db.booking.findMany({
      where: {
        requesterUserId: params.userId,
        kind: "CHECKOUT",
        status: "PENDING_PICKUP",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        refNumber: true,
        startsAt: true,
        serializedItems: {
          select: {
            asset: {
              select: { id: true, assetTag: true, name: true },
            },
          },
        },
        bulkItems: {
          select: {
            plannedQuantity: true,
            bulkSku: { select: { name: true } },
          },
        },
      },
    }),

    // Due reservations become kiosk pickup work. They stay reservations until
    // scans pass and confirmation creates the linked checkout custody record.
    db.booking.findMany({
      where: {
        requesterUserId: params.userId,
        kind: "RESERVATION",
        status: "BOOKED",
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        title: true,
        refNumber: true,
        startsAt: true,
        serializedItems: {
          where: { allocationStatus: "active" },
          select: {
            asset: {
              select: { id: true, assetTag: true, name: true },
            },
          },
        },
        bulkItems: {
          select: {
            plannedQuantity: true,
            checkedOutQuantity: true,
            bulkSku: { select: { name: true } },
          },
        },
      },
    }),

    // Upcoming reservations (next 7 days)
    db.booking.findMany({
      where: {
        requesterUserId: params.userId,
        kind: "RESERVATION",
        status: "BOOKED",
        startsAt: {
          gt: now,
          lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { startsAt: "asc" },
      take: 5,
      select: {
        id: true,
        title: true,
        startsAt: true,
      },
    }),
  ]);

  return ok({
    checkouts: checkouts.map((c) => ({
      id: c.id,
      title: normalizeTeamAbbreviations(c.title),
      refNumber: c.refNumber,
      items: c.serializedItems.map((si) => ({
        name: si.asset.name || si.asset.assetTag,
        tagName: si.asset.assetTag,
      })).concat(c.bulkItems.map((bi) => {
        const quantity = bi.checkedOutQuantity || bi.plannedQuantity;
        return {
          name: quantity === 1 ? bi.bulkSku.name : `${bi.bulkSku.name} x${quantity}`,
          tagName: `x${quantity}`,
        };
      })),
      endsAt: c.endsAt,
      isOverdue: c.endsAt < now,
    })),
    pendingPickups: [
      ...pendingPickups.map((p) => ({
        id: p.id,
        title: normalizeTeamAbbreviations(p.title),
        refNumber: p.refNumber,
        startsAt: p.startsAt,
        serializedItems: p.serializedItems.map((si) => ({
          id: si.asset.id,
          tagName: si.asset.assetTag,
          name: si.asset.name || si.asset.assetTag,
        })),
        bulkItems: p.bulkItems.map((bi) => ({
          name: bi.bulkSku.name,
          quantity: bi.plannedQuantity,
        })),
      })),
      ...dueReservations.map((p) => ({
        id: p.id,
        title: normalizeTeamAbbreviations(p.title),
        refNumber: p.refNumber,
        startsAt: p.startsAt,
        serializedItems: p.serializedItems.map((si) => ({
          id: si.asset.id,
          tagName: si.asset.assetTag,
          name: si.asset.name || si.asset.assetTag,
        })),
        bulkItems: p.bulkItems
          .map((bi) => ({
            name: bi.bulkSku.name,
            quantity: Math.max(0, bi.plannedQuantity - (bi.checkedOutQuantity ?? 0)),
          }))
          .filter((bi) => bi.quantity > 0),
      })),
    ],
    reservations: reservations.map((r) => ({
      id: r.id,
      title: normalizeTeamAbbreviations(r.title),
      startsAt: r.startsAt,
    })),
  });
});
