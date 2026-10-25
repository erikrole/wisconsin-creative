import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (event: Record<string, unknown>) => void;
type ClientModule = typeof import("@/lib/error-reporting/client");

class FakeElement {
  constructor(
    public tagName: string,
    private attributes: Record<string, string> = {},
    public textContent = "",
    private parent: FakeElement | null = null,
  ) {}

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  closest(selector: string): FakeElement | null {
    const matches = selector === "[data-private]" ? "data-private" in this.attributes : this.isControl();
    if (matches) return this;
    return this.parent ? this.parent.closest(selector) : null;
  }

  private isControl() {
    return ["BUTTON", "A"].includes(this.tagName) || "role" in this.attributes;
  }
}

class FakeAnchor extends FakeElement {}

let windowListeners: Record<string, Listener>;
let documentListeners: Record<string, Listener>;
let sentFetch: ReturnType<typeof vi.fn>;
let pageFetch: ReturnType<typeof vi.fn>;
let consoleSink: ReturnType<typeof vi.fn>;
let fakeDocument: { visibilityState: string; addEventListener: (type: string, listener: Listener) => void };

async function loadClient(): Promise<ClientModule> {
  vi.resetModules();
  return import("@/lib/error-reporting/client");
}

function postedReports(mock = sentFetch) {
  return mock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string) as {
    client: Record<string, unknown>;
    reports: Array<Record<string, unknown>>;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  windowListeners = {};
  documentListeners = {};
  sentFetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  pageFetch = vi.fn(async () => new Response(null, { status: 202 }));
  consoleSink = vi.fn();
  fakeDocument = {
    visibilityState: "visible",
    addEventListener: (type, listener) => {
      documentListeners[type] = listener;
    },
  };
  vi.stubGlobal("window", {
    location: { pathname: "/bookings/cmabc123def456ghi789jkl0", href: "https://app.example.com/bookings?tab=open", origin: "https://app.example.com" },
    fetch: pageFetch,
    addEventListener: (type: string, listener: Listener) => {
      windowListeners[type] = listener;
    },
  });
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("fetch", sentFetch);
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("HTMLAnchorElement", FakeAnchor);
  vi.stubGlobal("console", { ...console, error: consoleSink });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reportClientError", () => {
  it("batches reports into one post a second later, with the screen and recent actions", async () => {
    const client = await loadClient();
    client.addBreadcrumb("click", "button \"Save\"");

    client.reportClientError(new TypeError("x is undefined"));
    client.reportClientError("plain text failure", { kind: "unhandled_rejection" });
    client.reportClientError({ code: 7 }, { kind: "render_error", digest: "abc" });
    expect(sentFetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(sentFetch).toHaveBeenCalledTimes(1);
    expect(sentFetch.mock.calls[0]?.[0]).toBe("/api/errors");
    const [payload] = postedReports();
    expect(payload?.client).toEqual(expect.objectContaining({ platform: "web" }));
    expect(payload?.reports).toEqual([
      expect.objectContaining({ kind: "error", name: "TypeError", message: "x is undefined", screen: "/bookings/cmabc123def456ghi789jkl0" }),
      expect.objectContaining({ kind: "unhandled_rejection", message: "plain text failure" }),
      expect.objectContaining({ kind: "render_error", message: "{\"code\":7}", digest: "abc" }),
    ]);
    expect(payload?.reports[0]?.breadcrumbs).toEqual([expect.objectContaining({ type: "click", message: "button \"Save\"" })]);
  });

  it("sends five reports per post and schedules the rest", async () => {
    const client = await loadClient();
    for (let index = 0; index < 7; index += 1) client.reportClientError(new Error(`failure ${index}`));

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(postedReports().map((post) => post.reports.length)).toEqual([5, 2]);
  });

  it("stops repeating the same failure after three and caps a page at twenty", async () => {
    const client = await loadClient();
    for (let index = 0; index < 5; index += 1) client.reportClientError(new Error("same"));
    for (let index = 0; index < 30; index += 1) client.reportClientError(new Error(`distinct ${index}`));

    await vi.advanceTimersByTimeAsync(10_000);

    const reports = postedReports().flatMap((post) => post.reports);
    expect(reports.filter((report) => report.message === "same")).toHaveLength(3);
    expect(reports).toHaveLength(20);
  });

  it("drops browser noise", async () => {
    const client = await loadClient();
    client.reportClientError("Script error.");
    client.reportClientError(new Error("ResizeObserver loop completed with undelivered notifications."));
    client.reportClientError(new Error("signal is aborted without reason"));
    client.reportClientError(new Error("boom"), { filename: "chrome-extension://abc/content.js" });

    await vi.advanceTimersByTimeAsync(2_000);

    expect(sentFetch).not.toHaveBeenCalled();
  });

  it("ignores a failed post instead of throwing", async () => {
    sentFetch.mockRejectedValue(new TypeError("offline"));
    const client = await loadClient();
    client.reportClientError(new Error("boom"));

    await expect(vi.advanceTimersByTimeAsync(1_000)).resolves.not.toThrow();
  });

  it("does nothing on the server", async () => {
    vi.stubGlobal("window", undefined);
    const client = await loadClient();
    client.reportClientError(new Error("boom"));
    client.installErrorReporting();

    await vi.advanceTimersByTimeAsync(2_000);

    expect(sentFetch).not.toHaveBeenCalled();
    expect(client.supportContext().screen).toBeNull();
  });
});

describe("breadcrumbs", () => {
  it("keeps the last thirty actions and trims long messages", async () => {
    const client = await loadClient();
    for (let index = 0; index < 35; index += 1) client.addBreadcrumb("log", `entry ${index}`);
    client.addBreadcrumb("log", "x".repeat(500));

    const crumbs = client.supportContext().breadcrumbs;
    expect(crumbs).toHaveLength(30);
    expect(crumbs[0]?.message).toBe("entry 6");
    expect(crumbs.at(-1)?.message).toHaveLength(200);
  });
});

describe("installErrorReporting", () => {
  it("installs once and reports uncaught errors and rejections", async () => {
    const client = await loadClient();
    client.installErrorReporting();
    const firstFetch = (window as unknown as { fetch: unknown }).fetch;
    client.installErrorReporting();
    expect((window as unknown as { fetch: unknown }).fetch).toBe(firstFetch);

    windowListeners.error?.({ error: new Error("uncaught"), message: "uncaught", filename: "https://app.example.com/app.js" });
    windowListeners.unhandledrejection?.({ reason: new Error("rejected") });
    await vi.advanceTimersByTimeAsync(1_000);

    // Once installed, reports go out through the page's own fetch, unwrapped.
    expect(sentFetch).not.toHaveBeenCalled();
    expect(postedReports(pageFetch)[0]?.reports).toEqual([
      expect.objectContaining({ kind: "error", message: "uncaught" }),
      expect.objectContaining({ kind: "unhandled_rejection", message: "rejected" }),
    ]);
    expect(postedReports(pageFetch)[0]?.reports[0]?.breadcrumbs).toEqual([
      expect.objectContaining({ type: "lifecycle", message: "page loaded", data: { screen: "/bookings/[id]" } }),
    ]);
  });

  it("sends queued reports right away when the app is hidden", async () => {
    const client = await loadClient();
    client.installErrorReporting();
    client.reportClientError(new Error("before hide"));

    fakeDocument.visibilityState = "hidden";
    documentListeners.visibilitychange?.({});

    expect(pageFetch).toHaveBeenCalledWith("/api/errors", expect.objectContaining({ method: "POST", keepalive: true }));
    const crumbs = client.supportContext().breadcrumbs;
    expect(crumbs.at(-1)).toEqual(expect.objectContaining({ type: "lifecycle", message: "app hidden" }));
  });

  it("records app API calls by route template, with the request id on failures", async () => {
    pageFetch.mockResolvedValueOnce(new Response(null, { status: 500, headers: { "x-vercel-id": "iad1::abc" } }));
    pageFetch.mockResolvedValueOnce(new Response(null, { status: 200, headers: { "x-vercel-id": "iad1::def" } }));
    pageFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const client = await loadClient();
    client.installErrorReporting();
    const wrapped = (window as unknown as { fetch: typeof fetch }).fetch;

    await wrapped("/api/bookings/cmabc123def456ghi789jkl0?tab=open", { method: "patch" });
    await wrapped(new URL("https://app.example.com/api/dashboard"));
    await expect(wrapped("/api/assets")).rejects.toThrow("Failed to fetch");
    await wrapped("/api/product-events", { method: "POST" });
    await wrapped("https://cdn.example.com/api/thing");

    const api = client.supportContext().breadcrumbs.filter((crumb) => crumb.type === "api");
    expect(api.map((crumb) => crumb.message)).toEqual([
      "PATCH /api/bookings/[id] → 500",
      "GET /api/dashboard → 200",
      "GET /api/assets → failed",
    ]);
    expect(api[0]?.data).toEqual(expect.objectContaining({ requestId: "iad1::abc" }));
    expect(api[1]?.data).not.toHaveProperty("requestId");
    expect(api[2]?.data).toEqual(expect.objectContaining({ error: "Failed to fetch" }));
    expect(pageFetch).toHaveBeenCalledTimes(5);
  });

  it("logs console errors as breadcrumbs and still prints them", async () => {
    const client = await loadClient();
    client.installErrorReporting();

    console.error(new RangeError("too far"), "extra");
    console.error("plain message");
    console.error({ code: 9 });

    const logs = client.supportContext().breadcrumbs.filter((crumb) => crumb.type === "log").map((crumb) => crumb.message);
    expect(logs).toEqual(["RangeError: too far", "plain message", "{\"code\":9}"]);
    expect(consoleSink).toHaveBeenCalledTimes(3);
    expect(consoleSink).toHaveBeenCalledWith(expect.any(RangeError), "extra");
  });

  it("names pressed controls without reading private areas", async () => {
    const client = await loadClient();
    client.installErrorReporting();
    const click = documentListeners.click!;

    const icon = new FakeElement("SPAN", {}, "", new FakeElement("BUTTON", { "aria-label": "Close dialog" }, "×"));
    click({ target: icon });
    click({ target: new FakeAnchor("A", { href: "/items/cmabc123def456ghi789jkl0?tab=history" }, "  ROAM2\n camera ") });
    click({ target: new FakeElement("DIV", { role: "tab" }, "") });
    const privateForm = new FakeElement("FORM", { "data-private": "" });
    click({ target: new FakeElement("BUTTON", {}, "Reveal code", privateForm) });
    click({ target: new FakeElement("P", {}, "just text") });
    click({ target: "not an element" });

    const clicks = client.supportContext().breadcrumbs.filter((crumb) => crumb.type === "click");
    expect(clicks).toEqual([
      expect.objectContaining({ message: "button \"Close dialog\"" }),
      expect.objectContaining({ message: "link \"ROAM2 camera\"", data: { href: "/items/[id]" } }),
      expect.objectContaining({ message: "tab" }),
    ]);
  });
});
