import bcrypt from "bcryptjs";
import { after } from "next/server";
import { cookies } from "next/headers";
import { Role, ShiftWorkerType } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { randomHex } from "@/lib/crypto";
import {
  capabilitiesForActor,
  collaboratorPolicyMetadataForActor,
  compatibilityCollaboratorProfile,
  requireActiveCollaboratorPolicy,
  type CollaboratorCapability,
  type CollaboratorPolicyMetadata,
} from "@/lib/collaborator-access";
import { collaboratorPolicyActorSelect } from "@/lib/services/collaborator-policies";
import {
  clearRolePreviewCookie,
  readRolePreviewCookie,
  rolePreviewCollaboratorPolicyMetadata,
  rolePreviewInfo,
  type RolePreviewInfo,
} from "@/lib/role-preview";

export { randomHex };

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  affiliation?: string | null;
  collaboratorProfile?: string | null;
  collaboratorPolicy?: CollaboratorPolicyMetadata | null;
  capabilities?: CollaboratorCapability[];
  staffingType?: ShiftWorkerType;
  avatarUrl: string | null;
  forcePasswordChange?: boolean;
  preview?: RolePreviewInfo;
};

const SESSION_12H_MS = 1000 * 60 * 60 * 12;
const SESSION_30D_MS = 1000 * 60 * 60 * 24 * 30;
const KIOSK_SESSION_MS = 1000 * 60 * 60 * 24 * 7;
export const LAST_ACTIVE_REFRESH_MS = 1000 * 60 * 5;

// How long a freshly issued kiosk activation code stays redeemable. Generous
// enough to carry an admin from generating the code to walking it over to the
// iPad, but bounded so a leaked/overheard code can't be redeemed weeks later.
// Codes are also single-use: redeeming one clears it (see requireKiosk activation).
export const KIOSK_ACTIVATION_CODE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

export async function tokenHash(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(token));
  const buf = new Uint8Array(signature);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(hash: string, password: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string, rememberMe = false) {
  const raw = randomHex(32);
  const hashed = await tokenHash(raw);
  const expiresAt = new Date(Date.now() + (rememberMe ? SESSION_30D_MS : SESSION_12H_MS));

  const cookieStore = await cookies();
  // A new login must never inherit a preview selected for a prior session.
  await clearRolePreviewCookie();

  // Rotate: if the caller already holds a session cookie (re-login while a
  // session is live), revoke that row so the prior token isn't left valid
  // until its natural expiry. No-op when there's no existing cookie.
  const existing = cookieStore.get(env.sessionCookieName)?.value;
  if (existing) {
    const existingHash = await tokenHash(existing);
    await db.session.deleteMany({ where: { tokenHash: existingHash } });
  }

  await db.session.create({
    data: {
      userId,
      tokenHash: hashed,
      expiresAt
    }
  });

  cookieStore.set(env.sessionCookieName, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt
  });
}

export function shouldRefreshLastActive(lastActiveAt: Date | null | undefined, now = new Date()): boolean {
  return !lastActiveAt || now.getTime() - lastActiveAt.getTime() >= LAST_ACTIVE_REFRESH_MS;
}

async function refreshUserLastActive(userId: string, lastActiveAt: Date | null | undefined, now = new Date()) {
  if (!shouldRefreshLastActive(lastActiveAt, now)) return;

  const staleBefore = new Date(now.getTime() - LAST_ACTIVE_REFRESH_MS);

  try {
    await db.user.updateMany({
      where: {
        id: userId,
        OR: [
          { lastActiveAt: null },
          { lastActiveAt: { lt: staleBefore } },
        ],
      },
      data: { lastActiveAt: now },
    });
  } catch (error) {
    console.error("Failed to update user last active timestamp", error);
  }
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(env.sessionCookieName)?.value;

  if (token) {
    const hashed = await tokenHash(token);
    await db.session.deleteMany({ where: { tokenHash: hashed } });
  }

  cookieStore.delete(env.sessionCookieName);
  await clearRolePreviewCookie();
}

export async function requireAuth(): Promise<AuthUser> {
  const cookieStore = await cookies();
  const token = cookieStore.get(env.sessionCookieName)?.value;

  if (!token) {
    throw new HttpError(401, "Authentication required");
  }

  const hashed = await tokenHash(token);
  const session = await db.session.findUnique({
    where: { tokenHash: hashed },
    include: {
      user: {
        include: {
          collaboratorPolicy: { select: collaboratorPolicyActorSelect },
        },
      },
    },
  });

  if (!session || session.expiresAt < new Date()) {
    throw new HttpError(401, "Session expired");
  }

  if (!session.user.active) {
    throw new HttpError(401, "Account deactivated");
  }

  requireActiveCollaboratorPolicy(session.user);

  const preview = session.user.role === Role.ADMIN ? await readRolePreviewCookie() : null;
  if (!preview) {
    await refreshUserLastActive(session.user.id, session.user.lastActiveAt);
  }

  const actualCollaboratorPolicy = collaboratorPolicyMetadataForActor(session.user);
  const collaboratorPolicy = preview?.role === Role.COLLABORATOR
    ? rolePreviewCollaboratorPolicyMetadata(preview.collaboratorAffiliation)
    : session.user.role === Role.COLLABORATOR
      ? actualCollaboratorPolicy
      : null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: preview?.role ?? session.user.role,
    affiliation: preview ? collaboratorPolicy?.affiliationKey ?? null : collaboratorPolicy?.affiliationKey ?? session.user.affiliation,
    collaboratorProfile: compatibilityCollaboratorProfile(
      collaboratorPolicy,
      preview ? null : session.user.collaboratorProfile,
    ),
    collaboratorPolicy,
    capabilities: preview?.capabilities ?? capabilitiesForActor(session.user),
    staffingType: session.user.staffingType,
    avatarUrl: session.user.avatarUrl ?? null,
    forcePasswordChange: session.user.forcePasswordChange,
    preview: preview ? rolePreviewInfo(preview) : undefined,
  };
}

// ── Kiosk Device Auth ────────────────────────────────────

const KIOSK_COOKIE = "kiosk_session";

export type KioskContext = {
  kioskId: string;
  name: string;
  locationId: string;
  locationName: string;
};

/**
 * Create a kiosk session. Called after activation code is validated.
 * The session expires server-side after seven days and is also bounded by the
 * HTTP-only cookie expiry. Admin deactivation can revoke it earlier.
 */
export async function createKioskSession(kioskId: string): Promise<string> {
  const raw = randomHex(64);
  const hashed = await tokenHash(raw);
  const expiresAt = new Date(Date.now() + KIOSK_SESSION_MS);

  await db.kioskDevice.update({
    where: { id: kioskId },
    data: {
      sessionToken: hashed,
      sessionExpiresAt: expiresAt,
      activatedAt: new Date(),
      lastSeenAt: new Date(),
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(KIOSK_COOKIE, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });

  return raw;
}

/**
 * Validate kiosk session cookie.
 * Returns kiosk context (kioskId, locationId, locationName).
 */
export async function requireKiosk(): Promise<KioskContext> {
  const cookieStore = await cookies();
  const token = cookieStore.get(KIOSK_COOKIE)?.value;

  if (!token) {
    throw new HttpError(401, "Kiosk session required");
  }

  const hashed = await tokenHash(token);
  const device = await db.kioskDevice.findUnique({
    where: { sessionToken: hashed },
    include: { location: { select: { id: true, name: true } } },
  });

  if (!device) {
    throw new HttpError(401, "Invalid kiosk session");
  }

  if (!device.active) {
    throw new HttpError(401, "Kiosk device deactivated");
  }

  const now = new Date();
  if (!device.sessionExpiresAt || device.sessionExpiresAt <= now) {
    await db.kioskDevice.update({
      where: { id: device.id },
      data: { sessionToken: null, sessionExpiresAt: null },
    });
    cookieStore.delete(KIOSK_COOKIE);
    throw new HttpError(401, "Kiosk session expired");
  }

  // Sliding session: kiosks are always-on appliances, so authenticated
  // activity pushes expiry back out to the full window. Throttled to roughly
  // one UPDATE per day (only once a day of the window has been consumed).
  // Admin deactivation (`active: false`) still revokes immediately; only an
  // iPad that goes dark for a full 7 days has to re-enter an activation code.
  const slideAfterMs = 1000 * 60 * 60 * 24;
  const shouldSlide =
    device.sessionExpiresAt.getTime() - now.getTime() < KIOSK_SESSION_MS - slideAfterMs;
  const sessionExpiresAt = shouldSlide
    ? new Date(now.getTime() + KIOSK_SESSION_MS)
    : device.sessionExpiresAt;

  // Keep the cookie aligned to the server-side session expiry — the DB
  // remains the trust window; the cookie never outlives it.
  cookieStore.set(KIOSK_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: sessionExpiresAt,
  });

  // `lastSeenAt` is throttled the same way the session slide above is, and for
  // the same reason: it was writing on EVERY kiosk request, including pure
  // reads. That turned every dashboard poll, roster load, and heartbeat into a
  // write, and write traffic — not read traffic — is what keeps a Neon compute
  // endpoint from suspending. Minute-level "last seen" precision was never
  // worth a WAL record per request; five minutes is well inside what the admin
  // Kiosk Devices column needs to distinguish a live device from a dark one.
  const lastSeenThrottleMs = 1000 * 60 * 5;
  const shouldTouchLastSeen =
    !device.lastSeenAt || now.getTime() - device.lastSeenAt.getTime() > lastSeenThrottleMs;

  const kioskContext = {
    kioskId: device.id,
    name: device.name,
    locationId: device.location.id,
    locationName: device.location.name,
  };

  // Nothing to persist: skip the round trip entirely rather than issuing an
  // UPDATE that would set every column to the value it already holds.
  if (!shouldSlide && !shouldTouchLastSeen) {
    return kioskContext;
  }

  // Update last seen + slid expiry after the response is sent -- after()
  // keeps the serverless function alive until this completes, unlike
  // fire-and-forget.
  after(async () => {
    try {
      await db.kioskDevice.update({
        where: { id: device.id },
        data: {
          ...(shouldTouchLastSeen ? { lastSeenAt: now } : {}),
          ...(shouldSlide ? { sessionExpiresAt } : {}),
        },
      });

      // The kiosk request has already woken Neon. Publish only after the
      // deferred last-seen write commits so the companion never receives an
      // older heartbeat, and never needs to poll a database-backed route.
      if (shouldTouchLastSeen && process.env.NODE_ENV !== "test") {
        const { refreshCompanionProjection } = await import("@/lib/services/companion-projection");
        await refreshCompanionProjection({ notify: true });
      }
    } catch (error) {
      console.error("[Kiosk] deferred activity update failed", error);
    }
  });

  return kioskContext;
}
