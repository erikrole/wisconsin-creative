import { cookies } from "next/headers";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { PasskeyCeremonyType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { createSession, randomHex, tokenHash, verifyPassword } from "@/lib/auth";
import { capabilitiesForActor, collaboratorPolicyMetadataForActor, compatibilityCollaboratorProfile, requireActiveCollaboratorPolicy } from "@/lib/collaborator-access";
import { collaboratorPolicyActorSelect } from "@/lib/services/collaborator-policies";

export const PASSKEY_CEREMONY_COOKIE = "passkey_ceremony";
export const PASSKEY_CEREMONY_TTL_MS = 5 * 60 * 1000;

type PasskeyRegistrationResponse = RegistrationResponseJSON;
type PasskeyAuthenticationResponse = AuthenticationResponseJSON;

function transportValues(values: string[] | undefined): AuthenticatorTransportFuture[] {
  return (values ?? []).filter((value): value is AuthenticatorTransportFuture =>
    ["ble", "hybrid", "internal", "nfc", "usb"].includes(value),
  );
}

function passkeyCredentialForVerification(credential: {
  credentialId: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string[];
}) {
  return {
    id: credential.credentialId,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: transportValues(credential.transports),
  };
}

/**
 * A blank name used to save every credential as "This device", which reads the
 * same for every row once someone enrolls more than one. Fall back to the
 * enrolling client instead so the list is scannable without a rename flow.
 */
export function describeEnrollingClient(userAgent: string | null | undefined): string {
  const ua = userAgent?.trim();
  if (!ua) return "This device";
  if (/WisconsinApp/i.test(ua)) return /iPad/i.test(ua) ? "iPad" : "iPhone";

  const platform = /iPhone/i.test(ua)
    ? "iPhone"
    : /iPad/i.test(ua)
      ? "iPad"
      : /Android/i.test(ua)
        ? "Android"
        : /Windows NT/i.test(ua)
          ? "Windows"
          : /Mac OS X/i.test(ua)
            ? "macOS"
            : /CrOS/i.test(ua)
              ? "ChromeOS"
              : /Linux/i.test(ua)
                ? "Linux"
                : null;

  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\/|Opera/i.test(ua)
      ? "Opera"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua)
            ? "Safari"
            : null;

  if (browser && platform) return `${browser} on ${platform}`;
  return browser ?? platform ?? "This device";
}

function normalizePasskeyName(name: string | undefined, userAgent?: string | null): string {
  const trimmed = name?.trim();
  return trimmed || describeEnrollingClient(userAgent);
}

async function saveCeremony(input: {
  type: PasskeyCeremonyType;
  userId?: string;
  challenge: string;
  rememberMe?: boolean;
}) {
  const rawToken = randomHex(32);
  const now = new Date();

  await db.passkeyChallenge.deleteMany({ where: { expiresAt: { lte: now } } });
  await db.passkeyChallenge.create({
    data: {
      ceremonyTokenHash: await tokenHash(rawToken),
      challenge: input.challenge,
      type: input.type,
      userId: input.userId,
      rememberMe: input.rememberMe ?? false,
      expiresAt: new Date(now.getTime() + PASSKEY_CEREMONY_TTL_MS),
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(PASSKEY_CEREMONY_COOKIE, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.ceil(PASSKEY_CEREMONY_TTL_MS / 1000),
  });
}

async function loadCeremony(type: PasskeyCeremonyType, userId?: string) {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(PASSKEY_CEREMONY_COOKIE)?.value;
  if (!rawToken) throw new HttpError(400, "Passkey ceremony expired. Start again.");

  const ceremony = await db.passkeyChallenge.findUnique({
    where: { ceremonyTokenHash: await tokenHash(rawToken) },
  });
  if (
    !ceremony ||
    ceremony.type !== type ||
    ceremony.expiresAt <= new Date() ||
    (userId !== undefined && ceremony.userId !== userId)
  ) {
    cookieStore.delete(PASSKEY_CEREMONY_COOKIE);
    throw new HttpError(400, "Passkey ceremony expired. Start again.");
  }

  return ceremony;
}

async function clearCeremonyCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(PASSKEY_CEREMONY_COOKIE);
}

export async function verifyCurrentPassword(userId: string, currentPassword: string) {
  const record = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!record?.passwordHash || !(await verifyPassword(record.passwordHash, currentPassword))) {
    throw new HttpError(400, "Current password is incorrect.");
  }
}

export async function createPasskeyRegistrationOptions(user: {
  id: string;
  email: string;
  name: string;
}) {
  const credentials = await db.passkeyCredential.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });
  const options = await generateRegistrationOptions({
    rpName: env.passkeyRpName,
    rpID: env.passkeyRpId,
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: transportValues(credential.transports),
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    timeout: 60_000,
  });

  await saveCeremony({
    type: PasskeyCeremonyType.REGISTRATION,
    userId: user.id,
    challenge: options.challenge,
  });
  return options;
}

export async function verifyPasskeyRegistration(
  userId: string,
  response: PasskeyRegistrationResponse,
  name?: string,
  userAgent?: string | null,
) {
  const ceremony = await loadCeremony(PasskeyCeremonyType.REGISTRATION, userId);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: env.passkeyOrigins,
      expectedRPID: env.passkeyRpId,
      requireUserVerification: true,
    });
  } catch {
    throw new HttpError(400, "Passkey registration could not be verified. Try again.");
  }

  if (!verification.verified) {
    throw new HttpError(400, "Passkey registration could not be verified. Try again.");
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const created = await db.$transaction(async (tx) => {
    const consumed = await tx.passkeyChallenge.deleteMany({
      where: {
        id: ceremony.id,
        type: PasskeyCeremonyType.REGISTRATION,
        userId,
        expiresAt: { gt: new Date() },
      },
    });
    if (consumed.count !== 1) throw new HttpError(409, "Passkey ceremony was already used. Start again.");

    return tx.passkeyCredential.create({
      data: {
        credentialId: credential.id,
        userId,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: transportValues(response.response.transports),
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name: normalizePasskeyName(name, userAgent),
      },
    });
  }, { isolationLevel: "Serializable" }).catch(async (error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await db.passkeyChallenge.deleteMany({ where: { id: ceremony.id } });
      await clearCeremonyCookie();
      throw new HttpError(409, "This passkey is already registered.");
    }
    throw error;
  });

  await clearCeremonyCookie();
  return created;
}

export async function createPasskeyAuthenticationOptions(rememberMe = false) {
  const options = await generateAuthenticationOptions({
    rpID: env.passkeyRpId,
    userVerification: "required",
    timeout: 60_000,
  });
  await saveCeremony({
    type: PasskeyCeremonyType.AUTHENTICATION,
    challenge: options.challenge,
    rememberMe,
  });
  return options;
}

export async function verifyPasskeyAuthentication(
  response: PasskeyAuthenticationResponse,
  ip?: string,
) {
  const ceremony = await loadCeremony(PasskeyCeremonyType.AUTHENTICATION);
  const stored = await db.passkeyCredential.findUnique({
    where: { credentialId: response.id },
  });
  if (!stored) throw new HttpError(401, "Passkey sign-in could not be verified.");

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: env.passkeyOrigins,
      expectedRPID: env.passkeyRpId,
      requireUserVerification: true,
      credential: passkeyCredentialForVerification({
        credentialId: stored.credentialId,
        publicKey: new Uint8Array(stored.publicKey) as unknown as Uint8Array<ArrayBuffer>,
        counter: stored.counter,
        transports: stored.transports,
      }),
    });
  } catch {
    throw new HttpError(401, "Passkey sign-in could not be verified.");
  }

  if (!verification.verified) throw new HttpError(401, "Passkey sign-in could not be verified.");

  const user = await db.user.findUnique({
    where: { id: stored.userId },
    include: { collaboratorPolicy: { select: collaboratorPolicyActorSelect } },
  });
  if (!user?.active) throw new HttpError(401, "Passkey sign-in could not be verified.");
  requireActiveCollaboratorPolicy(user);

  await db.$transaction(async (tx) => {
    const consumed = await tx.passkeyChallenge.deleteMany({
      where: {
        id: ceremony.id,
        type: PasskeyCeremonyType.AUTHENTICATION,
        expiresAt: { gt: new Date() },
      },
    });
    if (consumed.count !== 1) throw new HttpError(401, "Passkey sign-in could not be verified.");

    const updated = await tx.passkeyCredential.updateMany({
      where: { id: stored.id, counter: stored.counter },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
        deviceType: verification.authenticationInfo.credentialDeviceType,
        backedUp: verification.authenticationInfo.credentialBackedUp,
      },
    });
    if (updated.count !== 1) throw new HttpError(401, "Passkey sign-in could not be verified.");
  }, { isolationLevel: "Serializable" });

  await clearCeremonyCookie();
  await createSession(user.id, ceremony.rememberMe);

  const collaboratorPolicy = collaboratorPolicyMetadataForActor(user);
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      affiliation: collaboratorPolicy?.affiliationKey ?? user.affiliation,
      collaboratorProfile: compatibilityCollaboratorProfile(collaboratorPolicy, user.collaboratorProfile),
      collaboratorPolicy,
      capabilities: capabilitiesForActor(user),
      staffingType: user.staffingType,
      forcePasswordChange: user.forcePasswordChange,
    },
    credentialId: stored.id,
    ip,
  };
}

export async function listPasskeys(userId: string) {
  return db.passkeyCredential.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      createdAt: true,
      lastUsedAt: true,
      deviceType: true,
      backedUp: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokePasskey(userId: string, passkeyId: string) {
  const result = await db.passkeyCredential.deleteMany({ where: { id: passkeyId, userId } });
  if (result.count !== 1) throw new HttpError(404, "Passkey not found.");
}
