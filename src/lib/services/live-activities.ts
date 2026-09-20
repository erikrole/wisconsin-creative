import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  endCheckoutReturnLiveActivityTokens,
  startCheckoutReturnLiveActivityTokens,
  updateCheckoutReturnLiveActivityTokens,
} from "@/lib/push/apns";
import { BookingKind, BookingStatus } from "@prisma/client";
import { unique } from "@/lib/utils";

const CHECKOUT_RETURN_ACTIVITY = "checkout_return";
const DEFAULT_LEAD_MS = 30 * 60_000;
const OVERDUE_START_WINDOW_MS = 6 * 60 * 60_000;
const OVERDUE_SWEEP_WINDOW_MS = 6 * 60_000;

function initialsFor(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return letters ? letters.toUpperCase() : "?";
}

function returnTimeText(date: Date): string {
  return `Return ${new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: env.appTimezone,
  }).format(date)}`;
}

function urgencyFor(endsAt: Date, now: Date): "normal" | "warning" | "critical" | "overdue" {
  const remaining = endsAt.getTime() - now.getTime();
  if (remaining <= 0) return "overdue";
  if (remaining <= 10 * 60_000) return "critical";
  if (remaining <= 30 * 60_000) return "warning";
  return "normal";
}

async function recordCheckoutReturnLiveActivityStartIfEligible(args: {
  userId: string;
  bookingId: string;
  expectedEndsAt: Date;
  candidateTokens: string[];
  now: Date;
}): Promise<boolean> {
  const candidateTokens = unique(args.candidateTokens);
  if (candidateTokens.length === 0) return false;

  return db.$transaction(async (tx) => {
    // Re-read every authority that deactivation or a concurrent booking close
    // can change. Serializable ordering means either this start records first
    // and cleanup observes it, or cleanup wins and this write is suppressed.
    const eligible = await tx.booking.findFirst({
      where: {
        id: args.bookingId,
        requesterUserId: args.userId,
        kind: BookingKind.CHECKOUT,
        status: BookingStatus.OPEN,
        endsAt: args.expectedEndsAt,
        requester: {
          active: true,
          liveActivityStartTokens: {
            some: {
              token: { in: candidateTokens },
              activity: CHECKOUT_RETURN_ACTIVITY,
              revokedAt: null,
            },
          },
        },
      },
      select: { id: true },
    });
    if (!eligible) return false;

    await tx.liveActivityStart.upsert({
      where: {
        userId_bookingId_activity: {
          userId: args.userId,
          bookingId: args.bookingId,
          activity: CHECKOUT_RETURN_ACTIVITY,
        },
      },
      update: {
        lastAttemptAt: args.now,
        endedAt: null,
      },
      create: {
        userId: args.userId,
        bookingId: args.bookingId,
        activity: CHECKOUT_RETURN_ACTIVITY,
        startedAt: args.now,
        lastAttemptAt: args.now,
      },
    });
    return true;
  }, { isolationLevel: "Serializable" });
}

export async function revokeCheckoutReturnLiveActivityStartTokens(userId: string) {
  await db.liveActivityStartToken.updateMany({
    where: {
      userId,
      activity: CHECKOUT_RETURN_ACTIVITY,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

type CheckoutReturnEndToken = {
  token: string;
  bookingId: string;
};

async function dispatchCheckoutReturnLiveActivityEnds(
  rows: CheckoutReturnEndToken[],
) {
  if (rows.length === 0) {
    return { selected: 0, ended: 0, pending: 0 };
  }

  const tokens = rows.map((row) => row.token);
  const { accepted, revoked } = await endCheckoutReturnLiveActivityTokens(tokens);
  const completedTokens = unique([...accepted, ...revoked]);
  const bookingIds = unique(rows.map((row) => row.bookingId));
  const endedAt = new Date();

  if (completedTokens.length > 0) {
    await db.liveActivityToken.updateMany({
      where: {
        activity: CHECKOUT_RETURN_ACTIVITY,
        endedAt: null,
        token: { in: completedTokens },
      },
      data: { endedAt },
    });
  }

  const pending = await db.liveActivityToken.count({
    where: {
      bookingId: { in: bookingIds },
      activity: CHECKOUT_RETURN_ACTIVITY,
      endedAt: null,
    },
  });
  await db.liveActivityStart.updateMany({
    where: {
      bookingId: { in: bookingIds },
      activity: CHECKOUT_RETURN_ACTIVITY,
      endedAt: null,
      booking: {
        liveActivityTokens: {
          none: {
            activity: CHECKOUT_RETURN_ACTIVITY,
            endedAt: null,
          },
        },
      },
    },
    data: { endedAt },
  });

  return {
    selected: tokens.length,
    ended: completedTokens.length,
    pending,
  };
}

export async function endCheckoutReturnLiveActivities(bookingId: string) {
  try {
    const rows = await db.liveActivityToken.findMany({
      where: {
        bookingId,
        activity: CHECKOUT_RETURN_ACTIVITY,
        endedAt: null,
      },
      select: { token: true, bookingId: true },
    });

    if (rows.length === 0) {
      await db.liveActivityStart.updateMany({
        where: {
          bookingId,
          activity: CHECKOUT_RETURN_ACTIVITY,
          endedAt: null,
        },
        data: { endedAt: new Date() },
      });
      return { selected: 0, ended: 0, pending: 0 };
    }

    return await dispatchCheckoutReturnLiveActivityEnds(rows);
  } catch (error) {
    console.error("[LiveActivity] failed to end checkout return activity", {
      bookingId,
      error,
    });
    return { selected: 0, ended: 0, pending: null };
  }
}

export async function retryPendingCheckoutReturnLiveActivityEnds(args: {
  limit?: number;
} = {}) {
  const rows = await db.liveActivityToken.findMany({
    where: {
      activity: CHECKOUT_RETURN_ACTIVITY,
      endedAt: null,
      OR: [
        { user: { active: false } },
        { booking: { status: { not: BookingStatus.OPEN } } },
        {
          user: {
            liveActivityStartTokens: {
              none: {
                activity: CHECKOUT_RETURN_ACTIVITY,
                revokedAt: null,
              },
            },
          },
        },
      ],
    },
    select: { token: true, bookingId: true },
    orderBy: { lastSeenAt: "asc" },
    take: args.limit ?? 200,
  });

  const result = await dispatchCheckoutReturnLiveActivityEnds(rows);
  await db.liveActivityStart.updateMany({
    where: {
      activity: CHECKOUT_RETURN_ACTIVITY,
      endedAt: null,
      OR: [
        { user: { active: false } },
        { booking: { status: { not: BookingStatus.OPEN } } },
        {
          user: {
            liveActivityStartTokens: {
              none: {
                activity: CHECKOUT_RETURN_ACTIVITY,
                revokedAt: null,
              },
            },
          },
        },
      ],
      booking: {
        liveActivityTokens: {
          none: {
            activity: CHECKOUT_RETURN_ACTIVITY,
            endedAt: null,
          },
        },
      },
    },
    data: { endedAt: new Date() },
  });
  return {
    scanned: new Set(rows.map((row) => row.bookingId)).size,
    pending: result.pending,
  };
}

export async function startDueCheckoutReturnLiveActivities(args: {
  now?: Date;
  leadMs?: number;
  overdueWindowMs?: number;
  limit?: number;
} = {}) {
  const now = args.now ?? new Date();
  const leadMs = args.leadMs ?? DEFAULT_LEAD_MS;
  const overdueWindowMs = args.overdueWindowMs ?? OVERDUE_START_WINDOW_MS;
  const leadCutoff = new Date(now.getTime() + leadMs);
  const overdueCutoff = new Date(now.getTime() - overdueWindowMs);

  const dueCheckouts = await db.booking.findMany({
    where: {
      kind: BookingKind.CHECKOUT,
      status: BookingStatus.OPEN,
      endsAt: {
        gte: overdueCutoff,
        lte: leadCutoff,
      },
      liveActivityTokens: {
        none: {
          activity: CHECKOUT_RETURN_ACTIVITY,
          endedAt: null,
        },
      },
      liveActivityStarts: {
        none: {
          activity: CHECKOUT_RETURN_ACTIVITY,
          endedAt: null,
        },
      },
      requester: {
        active: true,
        liveActivityStartTokens: {
          some: {
            activity: CHECKOUT_RETURN_ACTIVITY,
            revokedAt: null,
          },
        },
      },
    },
    select: {
      id: true,
      title: true,
      endsAt: true,
      requesterUserId: true,
      requester: {
        select: {
          name: true,
          avatarUrl: true,
          liveActivityStartTokens: {
            where: {
              activity: CHECKOUT_RETURN_ACTIVITY,
              revokedAt: null,
              user: { active: true },
            },
            select: { token: true },
          },
        },
      },
    },
    orderBy: { endsAt: "asc" },
    take: args.limit ?? 5,
  });

  const scanned = dueCheckouts.length;
  const outcomes = await Promise.allSettled(dueCheckouts.map(async (booking) => {
    const tokens = booking.requester.liveActivityStartTokens.map((row) => row.token);
    const result = await startCheckoutReturnLiveActivityTokens(
      tokens,
      {
        bookingId: booking.id,
        bookingTitle: booking.title,
        requesterName: booking.requester.name,
        requesterInitials: initialsFor(booking.requester.name),
        requesterAvatarUrl: booking.requester.avatarUrl,
        returnTimeText: returnTimeText(booking.endsAt),
      },
      {
        endsAt: booking.endsAt,
        nextNeedAt: null,
        allowsExtend: true,
        urgency: urgencyFor(booking.endsAt, now),
      },
    );

    if (result.revoked.length > 0) {
      await db.liveActivityStartToken.updateMany({
        where: { token: { in: result.revoked } },
        data: { revokedAt: new Date() },
      });
    }

    const revokedTokens = new Set(result.revoked);
    const recorded = result.ok > 0 && await recordCheckoutReturnLiveActivityStartIfEligible({
      userId: booking.requesterUserId,
      bookingId: booking.id,
      expectedEndsAt: booking.endsAt,
      candidateTokens: tokens.filter((token) => !revokedTokens.has(token)),
      now,
    });

    return {
      started: recorded ? result.ok : 0,
      revoked: result.revoked.length,
    };
  }));

  let started = 0;
  let revoked = 0;
  for (const outcome of outcomes) {
    if (outcome.status === "fulfilled") {
      started += outcome.value.started;
      revoked += outcome.value.revoked;
    } else {
      console.error("[LiveActivity] scheduled start failed", outcome.reason);
    }
  }

  return {
    scanned,
    started,
    revoked,
  };
}

export async function startCheckoutReturnLiveActivityForBooking(args: {
  bookingId: string;
  expectedEndsAt: Date;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const booking = await db.booking.findFirst({
    where: {
      id: args.bookingId,
      kind: BookingKind.CHECKOUT,
      status: BookingStatus.OPEN,
      endsAt: args.expectedEndsAt,
      liveActivityTokens: {
        none: { activity: CHECKOUT_RETURN_ACTIVITY, endedAt: null },
      },
      liveActivityStarts: {
        none: { activity: CHECKOUT_RETURN_ACTIVITY, endedAt: null },
      },
      requester: {
        active: true,
        liveActivityStartTokens: {
          some: { activity: CHECKOUT_RETURN_ACTIVITY, revokedAt: null },
        },
      },
    },
    select: {
      id: true,
      title: true,
      endsAt: true,
      requesterUserId: true,
      requester: {
        select: {
          name: true,
          avatarUrl: true,
          liveActivityStartTokens: {
            where: {
              activity: CHECKOUT_RETURN_ACTIVITY,
              revokedAt: null,
              user: { active: true },
            },
            select: { token: true },
          },
        },
      },
    },
  });

  if (!booking) return { started: 0, revoked: 0, skipped: true };

  const tokens = booking.requester.liveActivityStartTokens.map((row) => row.token);
  const result = await startCheckoutReturnLiveActivityTokens(
    tokens,
    {
      bookingId: booking.id,
      bookingTitle: booking.title,
      requesterName: booking.requester.name,
      requesterInitials: initialsFor(booking.requester.name),
      requesterAvatarUrl: booking.requester.avatarUrl,
      returnTimeText: returnTimeText(booking.endsAt),
    },
    {
      endsAt: booking.endsAt,
      nextNeedAt: null,
      allowsExtend: true,
      urgency: urgencyFor(booking.endsAt, now),
    },
  );

  if (result.revoked.length > 0) {
    await db.liveActivityStartToken.updateMany({
      where: { token: { in: result.revoked } },
      data: { revokedAt: now },
    });
  }

  const revokedTokens = new Set(result.revoked);
  const recorded = result.ok > 0 && await recordCheckoutReturnLiveActivityStartIfEligible({
    userId: booking.requesterUserId,
    bookingId: booking.id,
    expectedEndsAt: booking.endsAt,
    candidateTokens: tokens.filter((token) => !revokedTokens.has(token)),
    now,
  });

  return {
    started: recorded ? result.ok : 0,
    revoked: result.revoked.length,
    skipped: result.ok > 0 && !recorded,
  };
}

export async function sweepOverdueCheckoutReturnLiveActivities(args: {
  now?: Date;
  windowMs?: number;
  limit?: number;
} = {}) {
  const now = args.now ?? new Date();
  const windowMs = args.windowMs ?? OVERDUE_SWEEP_WINDOW_MS;
  const windowStart = new Date(now.getTime() - windowMs);

  const overdueCheckouts = await db.booking.findMany({
    where: {
      kind: BookingKind.CHECKOUT,
      status: BookingStatus.OPEN,
      endsAt: {
        gte: windowStart,
        lte: now,
      },
      liveActivityTokens: {
        some: {
          activity: CHECKOUT_RETURN_ACTIVITY,
          endedAt: null,
          user: { active: true },
        },
      },
      requester: { active: true },
    },
    select: {
      id: true,
      title: true,
      endsAt: true,
      liveActivityTokens: {
        where: {
          activity: CHECKOUT_RETURN_ACTIVITY,
          endedAt: null,
          user: { active: true },
        },
        select: { token: true },
      },
    },
    orderBy: { endsAt: "asc" },
    take: args.limit ?? 5,
  });

  const scanned = overdueCheckouts.length;
  const outcomes = await Promise.allSettled(overdueCheckouts.map(async (booking) => {
    const tokens = booking.liveActivityTokens.map((row) => row.token);
    if (tokens.length === 0) return { notified: 0, revoked: 0 };

    const result = await updateCheckoutReturnLiveActivityTokens(
      tokens,
      {
        endsAt: booking.endsAt,
        nextNeedAt: null,
        allowsExtend: false,
        urgency: urgencyFor(booking.endsAt, now),
      },
      {
        alert: {
          title: "Overdue",
          body: `${booking.title} is overdue for return`,
        },
      },
    );

    if (result.revoked.length > 0) {
      await db.liveActivityToken.updateMany({
        where: { token: { in: result.revoked } },
        data: { endedAt: now },
      });
    }

    return {
      notified: result.ok,
      revoked: result.revoked.length,
    };
  }));

  let notified = 0;
  let revoked = 0;
  for (const outcome of outcomes) {
    if (outcome.status === "fulfilled") {
      notified += outcome.value.notified;
      revoked += outcome.value.revoked;
    } else {
      console.error("[LiveActivity] overdue update failed", outcome.reason);
    }
  }

  return {
    scanned,
    notified,
    revoked,
  };
}

export async function updateCheckoutReturnLiveActivities(args: {
  bookingId: string;
  endsAt: Date;
}) {
  try {
    const rows = await db.liveActivityToken.findMany({
      where: {
        bookingId: args.bookingId,
        activity: CHECKOUT_RETURN_ACTIVITY,
        endedAt: null,
        user: { active: true },
      },
      select: { token: true },
    });

    if (rows.length === 0) return;

    const now = new Date();
    const remaining = args.endsAt.getTime() - now.getTime();
    const urgency =
      remaining <= 0
        ? "overdue"
        : remaining <= 10 * 60_000
          ? "critical"
          : remaining <= 30 * 60_000
            ? "warning"
            : "normal";

    const { revoked } = await updateCheckoutReturnLiveActivityTokens(
      rows.map((row) => row.token),
      {
        endsAt: args.endsAt,
        nextNeedAt: null,
        allowsExtend: true,
        urgency,
      },
    );

    if (revoked.length > 0) {
      await db.liveActivityToken.updateMany({
        where: { token: { in: revoked } },
        data: { endedAt: new Date() },
      });
    }
  } catch (error) {
    console.error("[LiveActivity] failed to update checkout return activity", {
      bookingId: args.bookingId,
      error,
    });
  }
}
