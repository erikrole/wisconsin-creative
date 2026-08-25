import { cookies } from "next/headers";
import { Role } from "@prisma/client";
import {
  COLLABORATOR_CAPABILITIES,
  isCollaboratorCapability,
  type CollaboratorPolicyMetadata,
  type CollaboratorCapability,
} from "@/lib/collaborator-access";
import { env } from "@/lib/env";

export const ROLE_PREVIEW_COOKIE = "gear_tracker_role_preview";
export const ROLE_PREVIEW_TTL_SECONDS = 2 * 60 * 60;
export const ROLE_PREVIEW_ROLES = [Role.STAFF, Role.STUDENT, Role.COLLABORATOR] as const;
export const ROLE_PREVIEW_COLLABORATOR_AFFILIATIONS = [
  { key: "BIG_TEN_NETWORK", displayName: "Big Ten Network", badgeLabel: "BTN" },
  { key: "LEARFIELD", displayName: "Learfield", badgeLabel: "Learfield" },
] as const;

export type RolePreviewRole = (typeof ROLE_PREVIEW_ROLES)[number];
export type RolePreviewCollaboratorAffiliation = (typeof ROLE_PREVIEW_COLLABORATOR_AFFILIATIONS)[number]["key"];

export type RolePreviewState = {
  role: RolePreviewRole;
  capabilities: CollaboratorCapability[];
  collaboratorAffiliation?: RolePreviewCollaboratorAffiliation;
  expiresAt: number;
};

export type RolePreviewInfo = {
  actualRole: "ADMIN";
  role: RolePreviewRole;
  readOnly: true;
  expiresAt: number;
};

function isRolePreviewRole(value: unknown): value is RolePreviewRole {
  return typeof value === "string" && ROLE_PREVIEW_ROLES.includes(value as RolePreviewRole);
}

function isRolePreviewCollaboratorAffiliation(value: unknown): value is RolePreviewCollaboratorAffiliation {
  return typeof value === "string" && ROLE_PREVIEW_COLLABORATOR_AFFILIATIONS.some((entry) => entry.key === value);
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

async function signingKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(payload: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(),
    new TextEncoder().encode(payload),
  );
  return Buffer.from(signature).toString("base64url");
}

function normalizedCapabilities(role: RolePreviewRole, values: unknown): CollaboratorCapability[] {
  if (role !== Role.COLLABORATOR || !Array.isArray(values)) return [];
  const capabilities = new Set(
    values.filter((value): value is CollaboratorCapability => typeof value === "string" && isCollaboratorCapability(value)),
  );
  return COLLABORATOR_CAPABILITIES.filter((capability) => capabilities.has(capability));
}

export function rolePreviewCollaboratorPolicyMetadata(
  key: RolePreviewCollaboratorAffiliation = "BIG_TEN_NETWORK",
): CollaboratorPolicyMetadata {
  const affiliation = ROLE_PREVIEW_COLLABORATOR_AFFILIATIONS.find((entry) => entry.key === key)
    ?? ROLE_PREVIEW_COLLABORATOR_AFFILIATIONS[0];
  return {
    id: `role-preview-${affiliation.key.toLowerCase()}`,
    affiliationKey: affiliation.key,
    displayName: affiliation.displayName,
    badgeLabel: affiliation.badgeLabel,
    status: "ACTIVE",
    version: 0,
  };
}

export function createRolePreviewState(
  role: RolePreviewRole,
  now = Date.now(),
  collaboratorAffiliation: RolePreviewCollaboratorAffiliation = "BIG_TEN_NETWORK",
): RolePreviewState {
  return {
    role,
    capabilities: role === Role.COLLABORATOR ? [...COLLABORATOR_CAPABILITIES] : [],
    ...(role === Role.COLLABORATOR ? { collaboratorAffiliation } : {}),
    expiresAt: now + ROLE_PREVIEW_TTL_SECONDS * 1000,
  };
}

export async function encodeRolePreview(state: RolePreviewState) {
  const payload = encodeBase64Url(JSON.stringify({
    role: state.role,
    capabilities: state.capabilities,
    collaboratorAffiliation: state.collaboratorAffiliation,
    expiresAt: state.expiresAt,
  }));
  return `${payload}.${await sign(payload)}`;
}

export async function decodeRolePreview(value: string | undefined, now = Date.now()): Promise<RolePreviewState | null> {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      Buffer.from(signature, "base64url"),
      new TextEncoder().encode(payload),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as {
      role?: unknown;
      capabilities?: unknown;
      collaboratorAffiliation?: unknown;
      expiresAt?: unknown;
    };
    if (!isRolePreviewRole(parsed.role) || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= now) return null;
    const collaboratorAffiliation = parsed.role === Role.COLLABORATOR
      ? (isRolePreviewCollaboratorAffiliation(parsed.collaboratorAffiliation)
        ? parsed.collaboratorAffiliation
        : "BIG_TEN_NETWORK")
      : undefined;
    return {
      role: parsed.role,
      capabilities: normalizedCapabilities(parsed.role, parsed.capabilities),
      ...(collaboratorAffiliation ? { collaboratorAffiliation } : {}),
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function rolePreviewInfo(state: RolePreviewState): RolePreviewInfo {
  return {
    actualRole: Role.ADMIN,
    role: state.role,
    readOnly: true,
    expiresAt: state.expiresAt,
  };
}

export async function readRolePreviewCookie() {
  const cookieStore = await cookies();
  return decodeRolePreview(cookieStore.get(ROLE_PREVIEW_COOKIE)?.value);
}

export async function readRolePreviewFromRequest(req: Request) {
  const cookieHeader = req.headers.get("cookie");
  const value = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ROLE_PREVIEW_COOKIE}=`))
    ?.slice(ROLE_PREVIEW_COOKIE.length + 1);
  return decodeRolePreview(value);
}

export async function setRolePreviewCookie(state: RolePreviewState) {
  const cookieStore = await cookies();
  cookieStore.set(ROLE_PREVIEW_COOKIE, await encodeRolePreview(state), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ROLE_PREVIEW_TTL_SECONDS,
  });
}

export async function clearRolePreviewCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(ROLE_PREVIEW_COOKIE);
}

export function isRolePreviewControlRequest(req: Request) {
  const pathname = new URL(req.url).pathname;
  return pathname === "/api/admin/role-preview" && (req.method === "POST" || req.method === "DELETE");
}

export function isRolePreviewBlockedRequest(req: Request) {
  if (isRolePreviewControlRequest(req)) return false;

  const url = new URL(req.url);
  const pathname = url.pathname;

  // Logging out is safe and must remain available while previewing.
  if (pathname === "/api/auth/logout" && req.method === "POST") return false;
  if (req.method !== "GET" && req.method !== "HEAD") return true;

  // Preview may inspect read models, but it must not retrieve protected files
  // or any server-owned export attachment.
  return (
    url.searchParams.get("download") === "1" ||
    url.searchParams.get("format") === "csv" ||
    pathname.includes("/export") ||
    pathname.includes("/download") ||
    pathname.includes("/ics/") ||
    pathname.startsWith("/api/signatures/artifacts/") ||
    pathname.includes("/units/labels")
  );
}
