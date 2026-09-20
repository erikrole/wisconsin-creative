import { ResourceType } from "@prisma/client";

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  CONTACTS: "Contacts",
  BUILDING_NUMBERS: "Building numbers",
  MEDIA_DRIVE: "Media Drive",
  SERVER_PATHS: "Server paths",
  SOP: "SOP",
  HOW_TO: "How-to",
  TROUBLESHOOTING: "Troubleshooting",
  ACCOUNT_NOTE: "Account note",
  EVENT_OPS: "Event ops",
  GENERAL: "General",
};

export const RESOURCE_TYPE_DESCRIPTIONS: Record<ResourceType, string> = {
  CONTACTS: "People, vendor numbers, escalation paths, and live team directory context.",
  BUILDING_NUMBERS: "Building, room, dock, phone, elevator, and location lookup guides.",
  MEDIA_DRIVE: "Focused guides for how the Creative file server is organized and maintained.",
  SERVER_PATHS: "Exact copyable paths, access requirements, and folder naming rules.",
  SOP: "Repeatable procedures with steps, checks, and handoff expectations.",
  HOW_TO: "Practical guides for recurring Creative workflows.",
  TROUBLESHOOTING: "Symptoms, likely causes, fixes, and escalation rules.",
  ACCOUNT_NOTE: "Account ownership, access notes, vendor references, and renewal context.",
  EVENT_OPS: "Event prep, venue operations, and handoff guides.",
  GENERAL: "Focused guide material that does not fit a narrower type.",
};

const RESOURCE_TYPE_CATEGORY_DEFAULTS: Record<ResourceType, string> = {
  CONTACTS: "Contacts",
  BUILDING_NUMBERS: "Building Numbers",
  MEDIA_DRIVE: "Media Drive",
  SERVER_PATHS: "Server Paths",
  SOP: "SOPs",
  HOW_TO: "How-To",
  TROUBLESHOOTING: "Troubleshooting",
  ACCOUNT_NOTE: "Accounts",
  EVENT_OPS: "Event Ops",
  GENERAL: "General Info",
};

export const RESOURCE_TYPE_OPTIONS = [
  ResourceType.CONTACTS,
  ResourceType.BUILDING_NUMBERS,
  ResourceType.MEDIA_DRIVE,
  ResourceType.SERVER_PATHS,
  ResourceType.SOP,
  ResourceType.HOW_TO,
  ResourceType.TROUBLESHOOTING,
  ResourceType.ACCOUNT_NOTE,
  ResourceType.EVENT_OPS,
  ResourceType.GENERAL,
] as const;

const KNOWLEDGE_BASE_CATEGORY_SUGGESTIONS = [
  "Contacts",
  "Building Numbers",
  "Media Drive",
  "Server Paths",
  "SOPs",
  "How-To",
  "General Info",
  "Troubleshooting",
  "Accounts",
  "Event Ops",
] as const;

export const GUIDE_CATEGORY_SUGGESTIONS = KNOWLEDGE_BASE_CATEGORY_SUGGESTIONS;

const CATEGORY_TYPE_ALIASES: Record<string, ResourceType> = {
  contacts: ResourceType.CONTACTS,
  contact: ResourceType.CONTACTS,
  "team contacts": ResourceType.CONTACTS,
  "building numbers": ResourceType.BUILDING_NUMBERS,
  "building number": ResourceType.BUILDING_NUMBERS,
  buildings: ResourceType.BUILDING_NUMBERS,
  "media drive": ResourceType.MEDIA_DRIVE,
  "media drives": ResourceType.MEDIA_DRIVE,
  "server paths": ResourceType.SERVER_PATHS,
  "server path": ResourceType.SERVER_PATHS,
  paths: ResourceType.SERVER_PATHS,
  sops: ResourceType.SOP,
  sop: ResourceType.SOP,
  "standard operating procedure": ResourceType.SOP,
  "standard operating procedures": ResourceType.SOP,
  "how-to": ResourceType.HOW_TO,
  "how to": ResourceType.HOW_TO,
  "how-to guides": ResourceType.HOW_TO,
  "how to guides": ResourceType.HOW_TO,
  troubleshooting: ResourceType.TROUBLESHOOTING,
  troubleshoot: ResourceType.TROUBLESHOOTING,
  accounts: ResourceType.ACCOUNT_NOTE,
  account: ResourceType.ACCOUNT_NOTE,
  "account notes": ResourceType.ACCOUNT_NOTE,
  "account note": ResourceType.ACCOUNT_NOTE,
  "event ops": ResourceType.EVENT_OPS,
  "event operations": ResourceType.EVENT_OPS,
  "event operation": ResourceType.EVENT_OPS,
};

export function inferResourceTypeFromCategory(category: string | null | undefined): ResourceType {
  const normalized = category?.trim().toLowerCase() ?? "";
  return CATEGORY_TYPE_ALIASES[normalized] ?? ResourceType.GENERAL;
}

export function defaultCategoryForResourceType(type: ResourceType): string {
  return RESOURCE_TYPE_CATEGORY_DEFAULTS[type];
}

export const GUIDE_ROLE_OPTIONS = [
  { value: "STUDENT", label: "Students" },
  { value: "STAFF", label: "Staff" },
  { value: "ADMIN", label: "Admins" },
] as const;

export const GUIDE_AREA_OPTIONS = [
  { value: "VIDEO", label: "Video" },
  { value: "PHOTO", label: "Photo" },
  { value: "GRAPHICS", label: "Graphics" },
  { value: "SOCIAL", label: "Social" },
  { value: "COMMS", label: "Comms" },
  { value: "LIVE_PRODUCTION", label: "Live Production" },
] as const;

export const GUIDE_AREA_LABELS = {
  VIDEO: "Video",
  PHOTO: "Photo",
  GRAPHICS: "Graphics",
  SOCIAL: "Social",
  COMMS: "Comms",
  LIVE_PRODUCTION: "Live Production",
} as const;

export const GUIDE_ROLE_LABELS = {
  STUDENT: "Students",
  STAFF: "Staff",
  ADMIN: "Admins",
  COLLABORATOR: "Collaborators",
} as const;
