export type ResourceFilterKey =
  | "all"
  | "recent"
  | "my-area"
  | "assignments"
  | "area-video"
  | "area-photo"
  | "area-graphics"
  | "area-social"
  | "area-comms"
  | "area-live-production"
  | "contacts"
  | "building-numbers"
  | "media-drive"
  | "server-paths"
  | "sop"
  | "how-to"
  | "troubleshooting"
  | "account-note"
  | "event-ops"
  | "general";

export type ResourceSortKey = "personalized" | "recent" | "title";
export type ResourceLayoutKey = "cards" | "list";

const FILTER_PARAM_MAP: Record<string, ResourceFilterKey> = {
  recent: "recent",
  "my-area": "my-area",
  assignments: "assignments",
  "sport-assignments": "assignments",
  "area-video": "area-video",
  "area-photo": "area-photo",
  "area-graphics": "area-graphics",
  "area-social": "area-social",
  "area-comms": "area-comms",
  "area-live-production": "area-live-production",
  contacts: "contacts",
  "building-numbers": "building-numbers",
  "media-drive": "media-drive",
  "server-paths": "server-paths",
  sop: "sop",
  sops: "sop",
  "how-to": "how-to",
  troubleshooting: "troubleshooting",
  "account-note": "account-note",
  "account-notes": "account-note",
  "event-ops": "event-ops",
  general: "general",
};

const LEGACY_AREA_PARAM_MAP: Record<string, ResourceFilterKey> = {
  video: "area-video",
  photo: "area-photo",
  graphics: "area-graphics",
  social: "area-social",
  comms: "area-comms",
  "live-production": "area-live-production",
};

const SORT_PARAM_VALUES = new Set<ResourceSortKey>(["personalized", "recent", "title"]);
const LAYOUT_PARAM_VALUES = new Set<ResourceLayoutKey>(["cards", "list"]);

function normalizeParam(value: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

export function parseResourceFilter(params: { get(name: string): string | null }): ResourceFilterKey {
  const currentFilter = normalizeParam(params.get("filter"));
  if (FILTER_PARAM_MAP[currentFilter]) return FILTER_PARAM_MAP[currentFilter];

  const legacyView = normalizeParam(params.get("view"));
  if (FILTER_PARAM_MAP[legacyView]) return FILTER_PARAM_MAP[legacyView];

  const legacyArea = normalizeParam(params.get("area"));
  if (LEGACY_AREA_PARAM_MAP[legacyArea]) return LEGACY_AREA_PARAM_MAP[legacyArea];

  return "all";
}

export function parseResourceSort(value: string | null): ResourceSortKey {
  const normalized = normalizeParam(value);
  return SORT_PARAM_VALUES.has(normalized as ResourceSortKey)
    ? (normalized as ResourceSortKey)
    : "personalized";
}

export function parseResourceLayout(value: string | null): ResourceLayoutKey {
  const normalized = normalizeParam(value);
  return LAYOUT_PARAM_VALUES.has(normalized as ResourceLayoutKey)
    ? (normalized as ResourceLayoutKey)
    : "cards";
}

const RESOURCE_TYPE_FILTER_KEYS: Record<string, ResourceFilterKey> = {
  CONTACTS: "contacts",
  BUILDING_NUMBERS: "building-numbers",
  MEDIA_DRIVE: "media-drive",
  SERVER_PATHS: "server-paths",
  SOP: "sop",
  HOW_TO: "how-to",
  TROUBLESHOOTING: "troubleshooting",
  ACCOUNT_NOTE: "account-note",
  EVENT_OPS: "event-ops",
  GENERAL: "general",
};

/** Library URL that lists every guide of one type, for reader breadcrumbs. */
export function resourceTypeHref(type: string): string {
  const key = RESOURCE_TYPE_FILTER_KEYS[type];
  return key ? `/resources?filter=${key}` : "/resources";
}
