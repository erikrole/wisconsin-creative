type WebMcpUser = {
  role: string;
  capabilities?: string[];
};

export type WebMcpToolResult = {
  content: [{ type: "text"; text: string }];
};

export type WebMcpTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: object;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (
    input: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => WebMcpToolResult | Promise<WebMcpToolResult>;
};

export interface WebMcpModelContext {
  registerTool(
    tool: WebMcpTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ): Promise<void>;
}

type ApiRecord = Record<string, unknown>;

type AssetsResponse = {
  data?: unknown;
  bulkItems?: unknown;
  total?: unknown;
};

type BookingsResponse = {
  data?: unknown;
  total?: unknown;
};

type DashboardResponse = {
  data?: unknown;
};

export const WEBMCP_ITEM_TYPES = [
  "all",
  "serialized",
  "unit-tracked",
  "quantity-tracked",
] as const;

export type WebMcpItemType = (typeof WEBMCP_ITEM_TYPES)[number];

export const WEBMCP_PAGE_DEFINITIONS = [
  { key: "dashboard", label: "Dashboard", href: "/" },
  { key: "schedule", label: "Schedule", href: "/schedule" },
  { key: "events", label: "Events", href: "/events" },
  { key: "items", label: "Items", href: "/items" },
  { key: "bookings", label: "Bookings", href: "/bookings" },
  { key: "checkouts", label: "Checkouts", href: "/bookings?tab=checkouts" },
  { key: "reservations", label: "Reservations", href: "/bookings?tab=reservations" },
  { key: "scoreboard", label: "Scoreboard", href: "/scoreboard" },
  { key: "accountability", label: "Accountability", href: "/accountability" },
  { key: "resources", label: "Resources", href: "/resources" },
  { key: "notifications", label: "Notifications", href: "/notifications" },
  { key: "profile", label: "Profile", href: "/profile" },
  { key: "operations", label: "Operations", href: "/operations" },
  { key: "battery-ops", label: "Battery Ops", href: "/bulk-inventory/batteries" },
  { key: "users", label: "Users", href: "/users" },
  { key: "reports", label: "Reports", href: "/reports" },
  { key: "settings", label: "Settings", href: "/settings" },
] as const;

export type WebMcpPageKey = (typeof WEBMCP_PAGE_DEFINITIONS)[number]["key"];

const INTERNAL_PAGE_KEYS: WebMcpPageKey[] = [
  "dashboard",
  "schedule",
  "events",
  "items",
  "bookings",
  "checkouts",
  "reservations",
  "scoreboard",
  "accountability",
  "resources",
  "notifications",
  "profile",
];

const STAFF_PAGE_KEYS: WebMcpPageKey[] = [
  ...INTERNAL_PAGE_KEYS,
  "operations",
  "battery-ops",
  "users",
  "reports",
  "settings",
];

function hasCapability(user: WebMcpUser, capability: string) {
  return user.capabilities?.includes(capability) === true;
}

export function getWebMcpPages(user: WebMcpUser): Array<(typeof WEBMCP_PAGE_DEFINITIONS)[number]> {
  const visibleKeys = user.role === "ADMIN" || user.role === "STAFF"
    ? STAFF_PAGE_KEYS
    : user.role === "COLLABORATOR"
      ? [
          "dashboard",
          "scoreboard",
          "notifications",
          "profile",
          ...(hasCapability(user, "PUBLISHED_SCHEDULE_VIEW") ? ["schedule"] : []),
          ...(hasCapability(user, "GEAR_CATALOG_VIEW") ? ["items"] : []),
          ...(hasCapability(user, "MY_GEAR_VIEW") ? ["bookings", "checkouts", "reservations"] : []),
          ...(hasCapability(user, "PEOPLE_DIRECTORY_VIEW") ? ["users"] : []),
        ] as WebMcpPageKey[]
      : INTERNAL_PAGE_KEYS;

  return WEBMCP_PAGE_DEFINITIONS.filter((page) => visibleKeys.includes(page.key));
}

export function getWebMcpContext(): WebMcpModelContext | null {
  if (typeof document === "undefined") return null;

  // document.modelContext is the current WebMCP draft surface. The navigator
  // alias keeps this progressive enhancement useful in early preview builds.
  return document.modelContext
    ?? (typeof navigator !== "undefined" ? navigator.modelContext : undefined)
    ?? null;
}

export function webMcpTextResult(value: unknown): WebMcpToolResult {
  return {
    content: [{
      type: "text",
      text: JSON.stringify(value) ?? String(value),
    }],
  };
}

function asRecord(value: unknown): ApiRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ApiRecord
    : null;
}

function asRecords(value: unknown): ApiRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).filter((item): item is ApiRecord => item !== null);
}

function readString(record: ApiRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(record: ApiRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNestedString(record: ApiRecord, parentKey: string, key: string): string | null {
  const parent = asRecord(record[parentKey]);
  return parent ? readString(parent, key) : null;
}

function readInputRecord(input: Record<string, unknown>): ApiRecord {
  return input;
}

function readInputString(input: ApiRecord, key: string, maxLength: number): string | null {
  const value = input[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function readLimit(input: ApiRecord, fallback = 8) {
  const value = input.limit;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(20, Math.max(1, Math.floor(value)));
}

function readItemType(input: ApiRecord): WebMcpItemType {
  const value = input.itemType;
  return typeof value === "string" && (WEBMCP_ITEM_TYPES as readonly string[]).includes(value)
    ? value as WebMcpItemType
    : "all";
}

function compactAsset(record: ApiRecord) {
  const id = readString(record, "id");
  if (!id) return null;

  const location = readNestedString(record, "location", "name");
  return {
    kind: "serialized" as const,
    id,
    assetTag: readString(record, "assetTag"),
    name: readString(record, "name"),
    brand: readString(record, "brand"),
    model: readString(record, "model"),
    status: readString(record, "computedStatus") ?? readString(record, "availability"),
    location,
    href: `/items/${encodeURIComponent(id)}`,
  };
}

function compactBulkItem(record: ApiRecord) {
  const id = readString(record, "id");
  if (!id) return null;

  return {
    kind: "bulk" as const,
    id,
    name: readString(record, "name"),
    category: readString(record, "category"),
    unit: readString(record, "unit"),
    trackByNumber: record.trackByNumber === true,
    availableQuantity: readNumber(record, "availableQuantity"),
    location: readString(record, "locationName") ?? readNestedString(record, "location", "name"),
    status: readString(record, "availability"),
    href: `/bulk-inventory/${encodeURIComponent(id)}`,
  };
}

function compactBooking(record: ApiRecord) {
  const id = readString(record, "id");
  if (!id) return null;

  const serializedItems = Array.isArray(record.serializedItems) ? record.serializedItems.length : 0;
  const bulkItems = Array.isArray(record.bulkItems) ? record.bulkItems.length : 0;
  return {
    id,
    kind: readString(record, "kind"),
    title: readString(record, "title"),
    refNumber: readString(record, "refNumber"),
    status: readString(record, "status"),
    startsAt: readString(record, "startsAt"),
    endsAt: readString(record, "endsAt"),
    requesterName: readString(record, "requesterName") ?? readNestedString(record, "requester", "name"),
    itemCount: readNumber(record, "itemCount") ?? serializedItems + bulkItems,
    href: `/bookings/${encodeURIComponent(id)}`,
  };
}

function compactEvent(record: ApiRecord) {
  const id = readString(record, "id");
  if (!id) return null;

  return {
    id,
    summary: readString(record, "summary"),
    sportCode: readString(record, "sportCode"),
    opponent: readString(record, "opponent"),
    startsAt: readString(record, "startsAt"),
    endsAt: readString(record, "endsAt"),
    allDay: record.allDay === true,
    location: readNestedString(record, "location", "name"),
    href: `/events/${encodeURIComponent(id)}`,
  };
}

class WebMcpRequestError extends Error {
  constructor(public readonly status: number) {
    super("WebMCP request failed");
  }
}

async function fetchJson<T>(path: string, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new WebMcpRequestError(0);
  }

  if (!response.ok) throw new WebMcpRequestError(response.status);

  try {
    return await response.json() as T;
  } catch {
    throw new WebMcpRequestError(502);
  }
}

function toolFailure(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  if (error instanceof WebMcpRequestError) {
    if (error.status === 401) return webMcpTextResult({ error: "Your Wisconsin Creative session has expired. Sign in again before using this tool." });
    if (error.status === 403) return webMcpTextResult({ error: "This read is not available to the signed-in user's role or capabilities." });
  }
  return webMcpTextResult({ error: "Wisconsin Creative could not complete the read. Try again from the open page." });
}

function safeExecute(
  execute: WebMcpTool["execute"],
): WebMcpTool["execute"] {
  return async (input, options) => {
    try {
      return await execute(input, options);
    } catch (error) {
      return toolFailure(error);
    }
  };
}

const EMPTY_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export function createWebMcpTools({
  user,
  getPathname,
  getTitle,
  navigate,
}: {
  user: WebMcpUser;
  getPathname: () => string;
  getTitle: () => string;
  navigate: (href: string) => void;
}): WebMcpTool[] {
  const pages = getWebMcpPages(user);
  const tools: WebMcpTool[] = [
    {
      name: "gear-tracker.get-current-page",
      title: "Get current Wisconsin Creative page",
      description: "Returns the current Wisconsin Creative route and document title without changing data or navigation.",
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: () => webMcpTextResult({
        path: getPathname(),
        title: getTitle(),
        url: window.location.href,
      }),
    },
    {
      name: "gear-tracker.open-page",
      title: "Open a Wisconsin Creative page",
      description: "Navigates the open Wisconsin Creative tab to one role-visible internal page. It does not create, edit, delete, check out, return, or reserve anything.",
      inputSchema: {
        type: "object",
        properties: {
          page: {
            type: "string",
            enum: pages.map((page) => page.key),
            description: "The role-visible page to open.",
          },
        },
        required: ["page"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: (input) => {
        const pageKey = readInputString(readInputRecord(input), "page", 40) as WebMcpPageKey | null;
        const page = pages.find((candidate) => candidate.key === pageKey);
        if (!page) return webMcpTextResult({ error: "That page is not available for the signed-in user's role." });
        navigate(page.href);
        return webMcpTextResult({ opened: page.label, href: page.href });
      },
    },
    {
      name: "gear-tracker.get-dashboard-snapshot",
      title: "Get Wisconsin Creative dashboard snapshot",
      description: "Returns a compact, read-only snapshot of dashboard counts and current operational rows already visible to the signed-in user.",
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: safeExecute(async (_input, { signal }) => {
        const response = await fetchJson<DashboardResponse>("/api/dashboard", signal);
        const data = asRecord(response.data) ?? {};
        const stats = asRecord(data.stats) ?? {};
        const compactList = (key: string) => {
          const section = asRecord(data[key]);
          const rows = Array.isArray(data[key])
            ? asRecords(data[key])
            : section
              ? asRecords(section.items)
              : [];
          return rows.map(compactBooking).filter((item): item is NonNullable<ReturnType<typeof compactBooking>> => item !== null).slice(0, 5);
        };

        return webMcpTextResult({
          role: readString(data, "role") ?? user.role,
          stats: {
            checkedOut: readNumber(stats, "checkedOut"),
            overdue: readNumber(stats, "overdue"),
            reserved: readNumber(stats, "reserved"),
            dueToday: readNumber(stats, "dueToday"),
          },
          myCheckouts: compactList("myCheckouts"),
          myReservations: compactList("myReservations"),
          pendingPickups: compactList("pendingPickups"),
          teamCheckouts: compactList("teamCheckouts"),
          teamReservations: compactList("teamReservations"),
          upcomingEvents: asRecords(data.upcomingEvents).map(compactEvent).filter((item): item is NonNullable<ReturnType<typeof compactEvent>> => item !== null).slice(0, 5),
        });
      }),
    },
  ];

  if (user.role !== "COLLABORATOR" || hasCapability(user, "GEAR_CATALOG_VIEW")) {
    tools.push({
      name: "gear-tracker.search-items",
      title: "Search Wisconsin Creative items",
      description: "Searches role-visible serialized gear and item families by tag, name, brand, model, category, or location. Read-only; results omit serial numbers, notes, QR values, and private vault data.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "A gear tag, name, brand, model, category, or location to search." },
          itemType: { type: "string", enum: [...WEBMCP_ITEM_TYPES], description: "Optional item kind filter." },
          limit: { type: "integer", minimum: 1, maximum: 20, description: "Maximum results to return; defaults to 8." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: safeExecute(async (input, { signal }) => {
        const args = readInputRecord(input);
        const query = readInputString(args, "query", 80);
        if (!query) return webMcpTextResult({ error: "query is required." });
        const limit = readLimit(args);
        const params = new URLSearchParams({
          q: query,
          item_type: readItemType(args),
          limit: String(limit),
          offset: "0",
          sort: "assetTag",
        });
        const response = await fetchJson<AssetsResponse>(`/api/assets?${params.toString()}`, signal);
        const assets = asRecords(response.data).map(compactAsset).filter((item): item is NonNullable<ReturnType<typeof compactAsset>> => item !== null);
        const bulkItems = asRecords(response.bulkItems).map(compactBulkItem).filter((item): item is NonNullable<ReturnType<typeof compactBulkItem>> => item !== null);
        return webMcpTextResult({
          query,
          total: readNumber(response as ApiRecord, "total") ?? assets.length + bulkItems.length,
          items: [...assets, ...bulkItems].slice(0, limit),
        });
      }),
    });
  }

  if (user.role !== "COLLABORATOR" || hasCapability(user, "MY_GEAR_VIEW")) {
    tools.push({
      name: "gear-tracker.search-bookings",
      title: "Search Wisconsin Creative bookings",
      description: "Searches active reservations and checkouts visible to the signed-in user. Students and collaborators remain limited by the same server-side ownership and capability rules as the website.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional booking title, reference number, or visible requester name." },
          limit: { type: "integer", minimum: 1, maximum: 20, description: "Maximum results to return; defaults to 8." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: safeExecute(async (input, { signal }) => {
        const args = readInputRecord(input);
        const limit = readLimit(args);
        const params = new URLSearchParams({ active: "true", limit: String(limit), offset: "0" });
        const query = readInputString(args, "query", 80);
        if (query) params.set("q", query);
        const response = await fetchJson<BookingsResponse>(`/api/bookings?${params.toString()}`, signal);
        const bookings = asRecords(response.data).map(compactBooking).filter((item): item is NonNullable<ReturnType<typeof compactBooking>> => item !== null).slice(0, limit);
        return webMcpTextResult({
          query,
          total: readNumber(response as ApiRecord, "total") ?? bookings.length,
          bookings,
        });
      }),
    });
  }

  return tools;
}

export async function registerWebMcpTools(
  context: WebMcpModelContext,
  tools: WebMcpTool[],
  signal: AbortSignal,
) {
  for (const tool of tools) {
    if (signal.aborted) return;
    try {
      await context.registerTool(tool, { signal });
    } catch (error) {
      if (signal.aborted) return;
      // WebMCP is progressive enhancement. One unsupported or rejected tool
      // must not prevent the rest of the page's safe tools from registering.
      console.warn(`[WebMCP] Could not register ${tool.name}`, error);
    }
  }
}
