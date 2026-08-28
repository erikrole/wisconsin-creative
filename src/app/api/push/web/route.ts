import { Prisma } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { getWebPushPublicKey, isWebPushConfigured } from "@/lib/push/web";

const MAX_ACTIVE_WEB_PUSH_SUBSCRIPTIONS_PER_USER = 8;

const endpointSchema = z.string().url().max(2048).refine(
  (value) => new URL(value).protocol === "https:",
  "Browser push endpoints must use HTTPS",
);

const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(128),
  }).strict(),
}).strict();

const deleteSchema = z.object({ endpoint: endpointSchema }).strict();

export const GET = withAuth(async (_req, { user }) => {
  const configured = isWebPushConfigured();
  const subscription = configured
    ? await db.webPushSubscription.findFirst({
        where: { userId: user.id, revokedAt: null },
        select: { id: true },
      })
    : null;

  return ok({ data: {
    configured,
    publicKey: configured ? getWebPushPublicKey() : null,
    subscribed: Boolean(subscription),
  } });
});

export const POST = withAuth(async (req, { user }) => {
  if (!isWebPushConfigured()) {
    throw new HttpError(503, "Browser notifications are not configured on this deployment yet.");
  }

  await enforceRateLimit(`web-push:register:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = subscriptionSchema.parse(await req.json());
  const now = new Date();

  await db.$transaction(async (tx) => {
    const activeUser = await tx.user.findUnique({
      where: { id: user.id },
      select: { active: true },
    });
    if (!activeUser?.active) throw new HttpError(401, "Account deactivated");

    await tx.webPushSubscription.upsert({
      where: { endpoint: body.endpoint },
      update: {
        userId: user.id,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        lastSeenAt: now,
        revokedAt: null,
      },
      create: {
        userId: user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    });

    const kept = await tx.webPushSubscription.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: [
        { lastSeenAt: "desc" },
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: MAX_ACTIVE_WEB_PUSH_SUBSCRIPTIONS_PER_USER,
      select: { id: true },
    });
    await tx.webPushSubscription.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
        id: { notIn: kept.map((row) => row.id) },
      },
      data: { revokedAt: now },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return ok({ data: { subscribed: true } });
});

export const DELETE = withAuth(async (req, { user }) => {
  await enforceRateLimit(`web-push:revoke:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const rawBody = await req.text();
  let endpoint: string | undefined;
  if (rawBody.trim().length > 0) {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      throw new HttpError(400, "Request body must be valid JSON");
    }
    endpoint = deleteSchema.parse(parsedBody).endpoint;
  }

  if (endpoint) {
    await db.webPushSubscription.updateMany({
      where: { userId: user.id, endpoint },
      data: { revokedAt: new Date() },
    });
  } else {
    await db.webPushSubscription.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  return ok({ data: { subscribed: false } });
});
