import { CollaboratorPolicyStatus, Role } from "@prisma/client";
import { HttpError } from "@/lib/http";

export const COLLABORATOR_CAPABILITIES = [
  "GEAR_CATALOG_VIEW",
  "MY_GEAR_VIEW",
  "RESERVATION_CREATE",
  "RESERVATION_EDIT_OWN",
  "RESERVATION_CANCEL_OWN",
  "RESERVATION_EXTEND_OWN",
  "PUBLISHED_SCHEDULE_VIEW",
  "PEOPLE_DIRECTORY_VIEW",
  "SOFTWARE_VAULT_VIEW",
  "SCHEDULE_FOLLOW",
  "KIOSK_ROSTER_ELIGIBLE",
  "TEAM_GEAR_VIEW",
  "BRAND_ASSETS_VIEW",
] as const;

export type CollaboratorCapability = (typeof COLLABORATOR_CAPABILITIES)[number];

export const COLLABORATOR_CAPABILITY_CATALOG: ReadonlyArray<{
  key: CollaboratorCapability;
  label: string;
  group: "SEE" | "DO" | "KIOSK";
  description: string;
}> = [
  { key: "GEAR_CATALOG_VIEW", label: "Gear catalog", group: "SEE", description: "Browse sanitized reservable gear." },
  { key: "MY_GEAR_VIEW", label: "My Gear", group: "SEE", description: "See only the collaborator's reservations and checkouts." },
  { key: "PUBLISHED_SCHEDULE_VIEW", label: "Published Schedule", group: "SEE", description: "See snapshot-backed published events and crew." },
  { key: "PEOPLE_DIRECTORY_VIEW", label: "People directory", group: "SEE", description: "See active teammates and minimized work profiles." },
  { key: "SOFTWARE_VAULT_VIEW", label: "Shared software", group: "SEE", description: "See software logins explicitly shared with collaborators." },
  { key: "TEAM_GEAR_VIEW", label: "Team gear activity", group: "SEE", description: "See everyone's reservations and checkouts, and who has each item, by full name. View only." },
  { key: "BRAND_ASSETS_VIEW", label: "Brand assets", group: "SEE", description: "Browse and download logos, fonts and brand files. Internal guides and contacts stay hidden." },
  { key: "RESERVATION_CREATE", label: "Create reservations", group: "DO", description: "Reserve gear for the collaborator's own use." },
  { key: "RESERVATION_EDIT_OWN", label: "Edit own reservations", group: "DO", description: "Change eligible owned reservations." },
  { key: "RESERVATION_CANCEL_OWN", label: "Cancel own reservations", group: "DO", description: "Cancel eligible owned reservations." },
  { key: "RESERVATION_EXTEND_OWN", label: "Request extensions", group: "DO", description: "Request more time for eligible owned reservations." },
  { key: "SCHEDULE_FOLLOW", label: "Follow events", group: "DO", description: "Follow or unfollow published events." },
  { key: "KIOSK_ROSTER_ELIGIBLE", label: "Kiosk roster", group: "KIOSK", description: "Appear in every staffed kiosk name picker." },
];

const CAPABILITY_SET = new Set<string>(COLLABORATOR_CAPABILITIES);

const CAPABILITY_DEPENDENCIES: Partial<Record<CollaboratorCapability, readonly CollaboratorCapability[]>> = {
  RESERVATION_CREATE: ["GEAR_CATALOG_VIEW", "MY_GEAR_VIEW"],
  RESERVATION_EDIT_OWN: ["MY_GEAR_VIEW"],
  RESERVATION_CANCEL_OWN: ["MY_GEAR_VIEW"],
  RESERVATION_EXTEND_OWN: ["MY_GEAR_VIEW"],
  SCHEDULE_FOLLOW: ["PUBLISHED_SCHEDULE_VIEW"],
  KIOSK_ROSTER_ELIGIBLE: ["MY_GEAR_VIEW"],
  TEAM_GEAR_VIEW: ["GEAR_CATALOG_VIEW", "MY_GEAR_VIEW"],
};

type PolicyLike = {
  id: string;
  status: CollaboratorPolicyStatus | "ACTIVE" | "SUSPENDED";
  version: number;
  affiliation: {
    key: string;
    displayName: string;
    badgeLabel: string;
  };
  grants: Array<{ capabilityKey: string }>;
};

export type CollaboratorPolicyMetadata = {
  id: string;
  affiliationKey: string;
  displayName: string;
  badgeLabel: string;
  status: "ACTIVE" | "SUSPENDED";
  version: number;
};

export type CollaboratorActor = {
  role: Role;
  collaboratorProfile?: string | null;
  capabilities?: readonly string[] | null;
  collaboratorPolicy?: PolicyLike | CollaboratorPolicyMetadata | null;
};

export function isCollaboratorCapability(value: string): value is CollaboratorCapability {
  return CAPABILITY_SET.has(value);
}

export function normalizeCollaboratorCapabilities(values: readonly string[]) {
  const unknown = values.filter((value) => !isCollaboratorCapability(value));
  if (unknown.length > 0) {
    throw new HttpError(400, `Unsupported collaborator capability: ${unknown[0]}`);
  }

  const normalized = new Set(values as readonly CollaboratorCapability[]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const capability of [...normalized]) {
      for (const dependency of CAPABILITY_DEPENDENCIES[capability] ?? []) {
        if (!normalized.has(dependency)) {
          normalized.add(dependency);
          changed = true;
        }
      }
    }
  }
  return COLLABORATOR_CAPABILITIES.filter((capability) => normalized.has(capability));
}

export function capabilitiesForActor(actor: CollaboratorActor): CollaboratorCapability[] {
  if (actor.role !== Role.COLLABORATOR) return [];
  if (actor.capabilities) {
    return actor.capabilities.filter(isCollaboratorCapability);
  }
  if (actor.collaboratorPolicy) {
    if (actor.collaboratorPolicy.status !== CollaboratorPolicyStatus.ACTIVE) return [];
    if (!("grants" in actor.collaboratorPolicy)) return [];
    return actor.collaboratorPolicy.grants
      .map((grant) => grant.capabilityKey)
      .filter(isCollaboratorCapability);
  }
  return [];
}

export function collaboratorPolicyMetadataForActor(actor: CollaboratorActor): CollaboratorPolicyMetadata | null {
  const policy = actor.collaboratorPolicy;
  if (!policy) return null;
  if (!("affiliation" in policy)) return policy;
  return {
    id: policy.id,
    affiliationKey: policy.affiliation.key,
    displayName: policy.affiliation.displayName,
    badgeLabel: policy.affiliation.badgeLabel,
    status: policy.status,
    version: policy.version,
  };
}

export function compatibilityCollaboratorProfile(
  policy: CollaboratorPolicyMetadata | null,
  legacy: string | null | undefined,
) {
  if (!policy) return legacy ?? null;
  return policy.affiliationKey === "BIG_TEN_NETWORK" ? "BTN_STANDARD" : `${policy.affiliationKey}_STANDARD`;
}

export function hasCollaboratorCapability(actor: CollaboratorActor, capability: CollaboratorCapability) {
  return capabilitiesForActor(actor).includes(capability);
}

export function requireCollaboratorCapability(actor: CollaboratorActor, capability: CollaboratorCapability) {
  if (!hasCollaboratorCapability(actor, capability)) {
    throw new HttpError(403, "Forbidden");
  }
}

export function requireActiveCollaboratorPolicy(actor: CollaboratorActor) {
  if (actor.role !== Role.COLLABORATOR) return;
  if (!actor.collaboratorPolicy) {
    throw new HttpError(403, "Your account is not assigned to a collaborator affiliation");
  }
  if (actor.collaboratorPolicy.status !== CollaboratorPolicyStatus.ACTIVE) {
    throw new HttpError(403, "Your affiliation access is suspended");
  }
}

export function isGlobalKioskCollaborator(actor: CollaboratorActor) {
  return actor.role === Role.COLLABORATOR && hasCollaboratorCapability(actor, "KIOSK_ROSTER_ELIGIBLE");
}

/** Read-only team-wide gear visibility: the signed admin preview, or the TEAM_GEAR_VIEW grant. */
export function seesTeamGear(actor: CollaboratorActor & { preview?: { role?: string } | null }) {
  if (actor.role !== Role.COLLABORATOR) return true;
  return actor.preview?.role === "COLLABORATOR" || hasCollaboratorCapability(actor, "TEAM_GEAR_VIEW");
}
