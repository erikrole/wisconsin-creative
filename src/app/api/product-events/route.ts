import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  PRODUCT_EVENT_DURATION_BUCKETS,
  PRODUCT_EVENT_NAMES,
  PRODUCT_EVENT_OUTCOMES,
  PRODUCT_EVENT_PLATFORMS,
  PRODUCT_EVENT_SURFACES,
  PRODUCT_RELEASE_CHANNELS,
  coarseWebClient,
  pseudonymousAnalyticsKey,
  pseudonymousInstallationKey,
} from "@/lib/usage-analytics";

const productEventSchema = z.object({
  eventName: z.enum(PRODUCT_EVENT_NAMES),
  platform: z.enum(PRODUCT_EVENT_PLATFORMS),
  surface: z.enum(PRODUCT_EVENT_SURFACES),
  outcome: z.enum(PRODUCT_EVENT_OUTCOMES).optional(),
  appVersion: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9._+-]+$/).optional(),
  appBuild: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9._+-]+$/).optional(),
  osVersion: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9._+-]+$/).optional(),
  deviceModel: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9._,+-]+$/).optional(),
  releaseChannel: z.enum(PRODUCT_RELEASE_CHANNELS).optional(),
  installationKey: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/).optional(),
  durationBucket: z.enum(PRODUCT_EVENT_DURATION_BUCKETS).optional(),
  sessionKey: z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  properties: z.record(z.enum(["source", "mode", "reason"]), z.string().max(32).regex(/^[a-z0-9_-]+$/)).optional(),
}).strict();

export const POST = withAuth(async (req, { user }) => {
  const limit = await checkRateLimit(`product-events:${user.id}`, { max: 240, windowMs: 60 * 60_000 });
  if (!limit.allowed) throw new HttpError(429, "Too many usage events");
  const body = productEventSchema.parse(await req.json());
  const occurredAt = new Date();
  const actorHash = pseudonymousAnalyticsKey(user.id, occurredAt);
  if (!actorHash) throw new HttpError(503, "Usage counting is not configured");

  const sessionHash = body.sessionKey
    ? pseudonymousAnalyticsKey(`session:${body.sessionKey}`, occurredAt)
    : null;

  await db.productEvent.create({
    data: {
      actorHash,
      eventName: body.eventName,
      platform: body.platform,
      surface: body.surface,
      outcome: body.outcome,
      appVersion: body.appVersion,
      durationBucket: body.durationBucket,
      sessionHash,
      properties: body.properties,
      occurredAt,
    },
  });

  // Web clients can't name their device in the body; read the family from the request.
  const deviceModel = body.platform === "web" ? coarseWebClient(req.headers.get("user-agent")) ?? undefined : body.deviceModel;

  if (body.installationKey) {
    const installationHash = pseudonymousInstallationKey(body.installationKey);
    if (installationHash) {
      try {
        await db.userAppInstallation.upsert({
          where: {
            userId_installationHash_platform: {
              userId: user.id,
              installationHash,
              platform: body.platform,
            },
          },
          create: {
            userId: user.id,
            installationHash,
            platform: body.platform,
            appVersion: body.appVersion,
            appBuild: body.appBuild,
            osVersion: body.osVersion,
            deviceModel,
            releaseChannel: body.releaseChannel,
            firstSeenAt: occurredAt,
            lastSeenAt: occurredAt,
            lastOpenedAt: body.eventName === "app_opened" ? occurredAt : null,
          },
          update: {
            appVersion: body.appVersion,
            appBuild: body.appBuild,
            osVersion: body.osVersion,
            deviceModel,
            releaseChannel: body.releaseChannel,
            lastSeenAt: occurredAt,
            ...(body.eventName === "app_opened" ? { lastOpenedAt: occurredAt } : {}),
          },
        });
      } catch (error) {
        // Presence is diagnostic context; never let it block the product event.
        console.error("Failed to update app activity presence", error);
      }
    }
  }

  return ok({ accepted: true }, 202);
});
