import type { BlastSeverity, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { sendPush } from "@/lib/push/apns";
import { sendWebPushToUsers } from "@/lib/push/web";
import { deferPush } from "@/lib/services/notifications";
import { normalizePrefs, shouldDeliverPush } from "@/lib/services/notification-prefs";
import {
  MAX_BLAST_RECIPIENTS,
  resolveBlastTargets,
  type BlastTargetSpec,
} from "@/lib/services/blast-targeting";

export { MAX_BLAST_RECIPIENTS } from "@/lib/services/blast-targeting";
const MAX_ACTIVE_TOKENS_PER_BLAST_RECIPIENT = 8;
const MAX_DELIVERY_TOKENS_PER_BLAST_RECIPIENT = 2;
const MAX_BLAST_PUSH_TOKEN_ROWS =
  MAX_BLAST_RECIPIENTS * MAX_ACTIVE_TOKENS_PER_BLAST_RECIPIENT;

export type CreateBlastInput = {
  title: string;
  body: string;
  severity: BlastSeverity;
  requiresAck: boolean;
  expiresAt: Date | null;
  spec: BlastTargetSpec;
};

export type CreateBlastResult = {
  id: string;
  recipientCount: number;
  targetSummary: string;
  sentAt: Date;
};

/**
 * Resolves the target, freezes the recipient set, writes inbox copies, and hands
 * the push off to a deferred batched send.
 *
 * The recipient set is frozen deliberately: the tracking page reports "21 of 34
 * acknowledged", and a denominator that shifts as the crew changes makes that
 * number meaningless. Drift is surfaced on the tracking page instead.
 */
export async function createAndSendBlast(
  input: CreateBlastInput,
  actor: { id: string; role: Role },
): Promise<CreateBlastResult> {
  const target = await resolveBlastTargets(input.spec);

  if (target.userIds.length === 0) {
    throw new HttpError(400, "That target matches nobody right now.");
  }
  if (target.userIds.length > MAX_BLAST_RECIPIENTS) {
    throw new HttpError(
      400,
      `That target reaches more than ${MAX_BLAST_RECIPIENTS} people. Narrow it first.`,
    );
  }

  const sentAt = new Date();
  const blast = await db.$transaction(async (tx) => {
    const created = await tx.blast.create({
      data: {
        title: input.title,
        body: input.body,
        severity: input.severity,
        status: "SENDING",
        targetKind: input.spec.kind,
        targetSpec: input.spec as unknown as Prisma.InputJsonValue,
        targetSummary: target.summary,
        eventId: target.eventId,
        requiresAck: input.requiresAck,
        expiresAt: input.expiresAt,
        recipientCount: target.userIds.length,
        createdById: actor.id,
      },
      select: { id: true },
    });
    await tx.blastRecipient.createMany({
      data: target.userIds.map((userId) => ({ blastId: created.id, userId })),
      skipDuplicates: true,
    });
    return created;
  });

  await writeInboxCopies(blast.id, input, target.userIds);

  await db.blast.update({
    where: { id: blast.id },
    data: { status: "SENT", sentAt },
  });

  deferPush(sendBlastPush(blast.id));

  return {
    id: blast.id,
    recipientCount: target.userIds.length,
    targetSummary: target.summary,
    sentAt,
  };
}

/**
 * Archive copies in the existing inbox, so the web notifications page, the unread
 * badge, and the iOS notifications sheet pick blasts up without new wiring.
 * `BlastRecipient` remains the authoritative acknowledgment ledger.
 */
async function writeInboxCopies(
  blastId: string,
  input: Pick<CreateBlastInput, "title" | "body">,
  userIds: string[],
): Promise<void> {
  const sentAt = new Date();
  await db.$transaction(async (tx) => {
    await tx.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: "blast",
        title: input.title,
        body: input.body,
        payload: { blastId },
        channel: "IN_APP",
        sentAt,
        // The prefix keeps this globally unique from schedule and trade rows.
        dedupeKey: `blast:${blastId}:${userId}`,
      })),
      skipDuplicates: true,
    });

    // `notificationId` is a soft pointer. Link every frozen recipient in one
    // set-based statement instead of issuing two Neon writes per recipient.
    await tx.$executeRaw`
      UPDATE "blast_recipients" AS br
      SET "notification_id" = n."id"
      FROM "notifications" AS n
      WHERE br."blast_id" = ${blastId}
        AND n."dedupe_key" = 'blast:' || br."blast_id" || ':' || br."user_id"
        AND br."notification_id" IS DISTINCT FROM n."id"
    `;
  });
}

/**
 * Batched native/browser send for a whole blast: the native path remains one
 * bounded APNs dispatch and the browser path remains one subscription query.
 * Looping `sendPushToUser` would be two queries and one dispatch per person,
 * all held open by `after()`.
 *
 * Never throws -- this runs inside `deferPush`/`after()`, where an unhandled
 * rejection is fatal in modern Node.
 */
export async function sendBlastPush(blastId: string): Promise<void> {
  try {
    const blast = await db.blast.findUnique({
      where: { id: blastId },
      select: { title: true, body: true, status: true },
    });
    if (!blast || blast.status === "CANCELLED") return;

    const attemptedAt = new Date();
    await db.blastRecipient.updateMany({
      where: { blastId, user: { active: false } },
      data: { pushStatus: "NO_DEVICE", pushAttemptedAt: attemptedAt },
    });

    const recipients = await db.blastRecipient.findMany({
      where: { blastId, user: { active: true } },
      select: { userId: true, user: { select: { notificationPrefs: true } } },
    });
    if (recipients.length === 0) return;

    const eligible: string[] = [];
    const skipped: string[] = [];
    for (const recipient of recipients) {
      const prefs = normalizePrefs(recipient.user.notificationPrefs);
      // The in-app banner always shows; only the push honors pause and channel prefs.
      (shouldDeliverPush(prefs) ? eligible : skipped).push(recipient.userId);
    }

    const registeredTokens = eligible.length
      ? await db.deviceToken.findMany({
          where: {
            userId: { in: eligible },
            platform: "IOS",
            revokedAt: null,
            user: { active: true },
          },
          select: { token: true, userId: true },
          orderBy: { lastSeenAt: "desc" },
          take: MAX_BLAST_PUSH_TOKEN_ROWS,
        })
      : [];
    const selectedPerUser = new Map<string, number>();
    const tokens = registeredTokens.filter((token) => {
      const selected = selectedPerUser.get(token.userId) ?? 0;
      if (selected >= MAX_DELIVERY_TOKENS_PER_BLAST_RECIPIENT) return false;
      selectedPerUser.set(token.userId, selected + 1);
      return true;
    });

    let accepted: string[] = [];
    let revoked: string[] = [];
    if (tokens.length > 0) {
      ({ accepted, revoked } = await sendPush(
        tokens.map((t) => t.token),
        // `GT_BLAST` adds the "Got it" action, which posts the same
        // idempotent acknowledgement the in-app banner button does.
        {
          title: blast.title,
          body: blast.body,
          payload: { blastId },
          category: "GT_BLAST",
          interruptionLevel: "active",
        },
      ));
    }

    const webDeliveries = await sendWebPushToUsers(eligible, {
      title: blast.title,
      body: blast.body,
      payload: { blastId },
    });

    const acceptedSet = new Set(accepted);
    const withAnyToken = new Set(tokens.map((t) => t.userId));
    const withLiveToken = new Set(
      tokens.filter((t) => acceptedSet.has(t.token)).map((t) => t.userId),
    );
    const withAnyWebSubscription = new Set(
      [...webDeliveries.entries()]
        .filter(([, delivery]) => delivery.devices > 0)
        .map(([userId]) => userId),
    );
    const withLiveWebSubscription = new Set(
      [...webDeliveries.entries()]
        .filter(([, delivery]) => delivery.delivered > 0)
        .map(([userId]) => userId),
    );

    const sentIds = eligible.filter((id) => withLiveToken.has(id) || withLiveWebSubscription.has(id));
    // Had tokens, but APNs accepted none of them. Permanent revocation and
    // transient provider failures must not read as delivered. The same status
    // rule applies to browser subscriptions.
    const failedIds = eligible.filter((id) =>
      (withAnyToken.has(id) || withAnyWebSubscription.has(id)) && !sentIds.includes(id),
    );
    const noDeviceIds = eligible.filter((id) => !withAnyToken.has(id) && !withAnyWebSubscription.has(id));

    await Promise.all([
      updatePushStatus(blastId, skipped, "SKIPPED_PREFS", attemptedAt),
      updatePushStatus(blastId, noDeviceIds, "NO_DEVICE", attemptedAt),
      updatePushStatus(blastId, sentIds, "SENT", attemptedAt),
      updatePushStatus(blastId, failedIds, "FAILED", attemptedAt),
    ]);

    if (revoked.length > 0) {
      await db.deviceToken.updateMany({
        where: { token: { in: revoked } },
        data: { revokedAt: new Date() },
      });
    }
  } catch (err) {
    console.error(`[BLAST] push for ${blastId} failed:`, err);
  }
}

async function updatePushStatus(
  blastId: string,
  userIds: string[],
  pushStatus: "SENT" | "SKIPPED_PREFS" | "NO_DEVICE" | "FAILED",
  attemptedAt: Date,
): Promise<void> {
  if (userIds.length === 0) return;
  await db.blastRecipient.updateMany({
    where: { blastId, userId: { in: userIds } },
    data: { pushStatus, pushAttemptedAt: attemptedAt },
  });
}

/**
 * Idempotent: cancelling an already-cancelled blast is a no-op, not an error.
 * Cancelling stops the banner on the next fetch; already-delivered APNs alerts
 * cannot be recalled.
 */
export async function cancelBlast(blastId: string, actor: { id: string }): Promise<void> {
  const blast = await db.blast.findUnique({
    where: { id: blastId },
    select: { id: true, cancelledAt: true },
  });
  if (!blast) throw new HttpError(404, "Blast not found");
  if (blast.cancelledAt) return;

  await db.blast.update({
    where: { id: blastId },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.id },
  });
}

export type ActiveBlastForUser = {
  id: string;
  title: string;
  body: string;
  severity: BlastSeverity;
  sentAt: Date | null;
  senderName: string | null;
  requiresAck: boolean;
  readAt: Date | null;
};

/**
 * The unacknowledged blasts the iOS dashboard banner renders, most severe first.
 * Expiry and cancellation are filtered server-side so the client never has to be
 * trusted with the clock.
 */
export async function listActiveBlastsForUser(
  userId: string,
  now: Date = new Date(),
): Promise<ActiveBlastForUser[]> {
  const rows = await db.blastRecipient.findMany({
    where: {
      userId,
      acknowledgedAt: null,
      blast: {
        status: "SENT",
        cancelledAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    },
    select: {
      readAt: true,
      blast: {
        select: {
          id: true,
          title: true,
          body: true,
          severity: true,
          sentAt: true,
          requiresAck: true,
          createdBy: { select: { name: true } },
        },
      },
    },
    orderBy: [{ blast: { severity: "desc" } }, { blast: { sentAt: "desc" } }],
    take: 5,
  });

  return rows.map((row) => ({
    id: row.blast.id,
    title: row.blast.title,
    body: row.blast.body,
    severity: row.blast.severity,
    sentAt: row.blast.sentAt,
    senderName: row.blast.createdBy?.name ?? null,
    requiresAck: row.blast.requiresAck,
    readAt: row.readAt,
  }));
}
