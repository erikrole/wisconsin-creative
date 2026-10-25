import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebMcpTools, getWebMcpContext, getWebMcpPages, registerWebMcpTools } from "@/lib/webmcp-tools";

const fetchMock = vi.fn();
const navigate = vi.fn();
const signal = new AbortController().signal;

function tools(user: { role: string; capabilities?: string[] } = { role: "STAFF" }) {
  return createWebMcpTools({
    user,
    getPathname: () => "/items",
    getTitle: () => "Items",
    navigate,
  });
}

async function run(name: string, input: Record<string, unknown> = {}, user?: { role: string; capabilities?: string[] }) {
  const tool = tools(user).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  const result = await tool.execute(input, { signal });
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
}

function requestedUrl() {
  return new URL(fetchMock.mock.calls[0]?.[0] as string, "https://app.example.com");
}

beforeEach(() => {
  fetchMock.mockReset();
  navigate.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebMCP pages", () => {
  it("gives staff the operations pages and students only the internal set", () => {
    const staffKeys = getWebMcpPages({ role: "ADMIN" }).map((page) => page.key);
    const studentKeys = getWebMcpPages({ role: "STUDENT" }).map((page) => page.key);

    expect(staffKeys).toEqual(expect.arrayContaining(["operations", "battery-ops", "users", "reports", "settings"]));
    expect(studentKeys).not.toContain("settings");
    expect(studentKeys).toContain("accountability");
  });

  it("opens collaborator pages one capability at a time", () => {
    const keys = getWebMcpPages({
      role: "COLLABORATOR",
      capabilities: ["GEAR_CATALOG_VIEW", "MY_GEAR_VIEW", "PEOPLE_DIRECTORY_VIEW"],
    }).map((page) => page.key);

    expect(keys).toEqual(["dashboard", "items", "bookings", "checkouts", "reservations", "scoreboard", "notifications", "profile", "users"]);
  });
});

describe("WebMCP navigation tools", () => {
  it("reports the current page", async () => {
    vi.stubGlobal("window", { location: { href: "https://app.example.com/items?q=cam" } });

    expect(await run("gear-tracker.get-current-page")).toEqual({
      path: "/items",
      title: "Items",
      url: "https://app.example.com/items?q=cam",
    });
  });

  it("opens only a page the role can see", async () => {
    expect(await run("gear-tracker.open-page", { page: " reports " })).toEqual({ opened: "Reports", href: "/reports" });
    expect(navigate).toHaveBeenCalledWith("/reports");

    navigate.mockReset();
    expect(await run("gear-tracker.open-page", { page: "reports" }, { role: "STUDENT" }))
      .toEqual({ error: "That page is not available for the signed-in user's role." });
    expect(await run("gear-tracker.open-page", { page: 42 })).toHaveProperty("error");
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("WebMCP read tools", () => {
  it("compacts the dashboard and caps each list at five rows", async () => {
    respond({
      data: {
        role: "STAFF",
        stats: { checkedOut: 4, overdue: 1, reserved: "many", dueToday: Number.NaN },
        myCheckouts: Array.from({ length: 7 }, (_, index) => ({ id: `co-${index}`, title: `Checkout ${index}`, serializedItems: [{}, {}], bulkItems: [{}] })),
        teamCheckouts: { items: [{ id: "co-team", requester: { name: "Ada" }, itemCount: 9 }, { title: "no id" }] },
        upcomingEvents: [{ id: "event 1", summary: "Football vs Iowa", allDay: true, location: { name: "Camp Randall" } }],
      },
    });

    const snapshot = await run("gear-tracker.get-dashboard-snapshot");

    expect(requestedUrl().pathname).toBe("/api/dashboard");
    expect(snapshot.stats).toEqual({ checkedOut: 4, overdue: 1, reserved: null, dueToday: null });
    expect(snapshot.myCheckouts).toHaveLength(5);
    expect((snapshot.myCheckouts as Array<Record<string, unknown>>)[0]).toEqual(expect.objectContaining({
      id: "co-0",
      itemCount: 3,
      href: "/bookings/co-0",
    }));
    expect(snapshot.teamCheckouts).toEqual([expect.objectContaining({ id: "co-team", requesterName: "Ada", itemCount: 9 })]);
    expect(snapshot.myReservations).toEqual([]);
    expect(snapshot.upcomingEvents).toEqual([expect.objectContaining({
      id: "event 1",
      allDay: true,
      location: "Camp Randall",
      href: "/events/event%201",
    })]);
  });

  it("falls back to the signed-in role when the dashboard omits it", async () => {
    respond({ data: null });

    expect((await run("gear-tracker.get-dashboard-snapshot", {}, { role: "STUDENT" })).role).toBe("STUDENT");
  });

  it("searches items with a clamped limit and a known item type", async () => {
    respond({
      data: [
        { id: "a1", assetTag: "ROAM2", name: "Camera", computedStatus: "AVAILABLE", location: { name: "Cage" } },
        { assetTag: "no id" },
      ],
      bulkItems: [{ id: "b1", name: "Batteries", trackByNumber: true, availableQuantity: 12, locationName: "Shelf" }],
    });

    const result = await run("gear-tracker.search-items", { query: "  cam  ", itemType: "vault", limit: 99.7 });

    expect(Object.fromEntries(requestedUrl().searchParams)).toEqual({
      q: "cam",
      item_type: "all",
      limit: "20",
      offset: "0",
      sort: "assetTag",
    });
    expect(result.total).toBe(2);
    expect(result.items).toEqual([
      expect.objectContaining({ kind: "serialized", id: "a1", status: "AVAILABLE", location: "Cage", href: "/items/a1" }),
      expect.objectContaining({ kind: "bulk", id: "b1", trackByNumber: true, availableQuantity: 12, location: "Shelf", href: "/bulk-inventory/b1" }),
    ]);
  });

  it("requires a search query for items and keeps the result count to the limit", async () => {
    expect(await run("gear-tracker.search-items", { query: "   " })).toEqual({ error: "query is required." });
    expect(fetchMock).not.toHaveBeenCalled();

    respond({ data: [{ id: "a1" }, { id: "a2" }, { id: "a3" }], total: 30 });
    const result = await run("gear-tracker.search-items", { query: "cam", itemType: "serialized", limit: 0 });
    expect(requestedUrl().searchParams.get("limit")).toBe("1");
    expect(requestedUrl().searchParams.get("item_type")).toBe("serialized");
    expect(result.total).toBe(30);
    expect(result.items).toHaveLength(1);
  });

  it("searches active bookings and leaves q off when no query is given", async () => {
    respond({ data: [{ id: "res-1", kind: "RESERVATION", refNumber: "R-12" }] });

    const result = await run("gear-tracker.search-bookings", {});

    expect(Object.fromEntries(requestedUrl().searchParams)).toEqual({ active: "true", limit: "8", offset: "0" });
    expect(result).toEqual({
      query: null,
      total: 1,
      bookings: [expect.objectContaining({ id: "res-1", refNumber: "R-12", itemCount: 0 })],
    });
  });
});

describe("WebMCP read failures", () => {
  it.each([
    [401, "Your Wisconsin Creative session has expired. Sign in again before using this tool."],
    [403, "This read is not available to the signed-in user's role or capabilities."],
    [500, "Wisconsin Creative could not complete the read. Try again from the open page."],
  ])("turns a %i into a readable error", async (status, message) => {
    respond({ error: "nope" }, status);

    expect(await run("gear-tracker.search-bookings", { query: "R-12" })).toEqual({ error: message });
  });

  it("treats a network failure and a body that is not JSON as a failed read", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect((await run("gear-tracker.get-dashboard-snapshot")).error).toContain("could not complete the read");

    respond("<html>");
    expect((await run("gear-tracker.get-dashboard-snapshot")).error).toContain("could not complete the read");
  });

  it("lets an abort through instead of reporting it as a failed read", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));

    await expect(run("gear-tracker.get-dashboard-snapshot")).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("WebMCP registration", () => {
  it("finds the model context on document first, then navigator", () => {
    expect(getWebMcpContext()).toBeNull();

    const fromNavigator = { registerTool: vi.fn() };
    vi.stubGlobal("document", {});
    vi.stubGlobal("navigator", { modelContext: fromNavigator });
    expect(getWebMcpContext()).toBe(fromNavigator);

    const fromDocument = { registerTool: vi.fn() };
    vi.stubGlobal("document", { modelContext: fromDocument });
    expect(getWebMcpContext()).toBe(fromDocument);
  });

  it("keeps registering after one tool is rejected and stops once aborted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const controller = new AbortController();
    const registerTool = vi.fn()
      .mockRejectedValueOnce(new Error("unsupported"))
      .mockImplementationOnce(async () => {
        controller.abort();
      })
      .mockResolvedValue(undefined);

    await registerWebMcpTools({ registerTool }, tools(), controller.signal);

    expect(registerTool).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith("[WebMCP] Could not register gear-tracker.get-current-page", expect.any(Error));
    warn.mockRestore();
  });
});
