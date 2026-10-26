import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  assertPublicHost: vi.fn(),
  fetchPublicUrl: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(async () => undefined) }));
vi.mock("@/lib/security/ssrf", () => ({
  assertPublicHost: mocks.assertPublicHost,
  fetchPublicUrl: mocks.fetchPublicUrl,
}));

import { POST } from "@/app/api/calendar-sources/test/route";

const admin = { id: "admin-1", email: "admin@example.com", name: "Admin", role: Role.ADMIN };

function probe(url: string) {
  return new Request("https://app.example.com/api/calendar-sources/test", {
    method: "POST",
    headers: { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" },
    body: JSON.stringify({ url }),
  });
}

async function run(url = "https://uwbadgers.com/calendar.ics") {
  const response = await POST(probe(url), { params: Promise.resolve({}) });
  return { response, body: await response.json() };
}

const ics = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "SUMMARY:Football vs Iowa",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "SUMMARY;LANGUAGE=en:  Volleyball vs Nebraska  ",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20261031T170000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(admin);
  mocks.assertPublicHost.mockResolvedValue(undefined);
  mocks.fetchPublicUrl.mockResolvedValue(new Response(ics, { status: 200, headers: { "content-type": "text/calendar" } }));
});

describe("POST /api/calendar-sources/test", () => {
  it("counts events and samples their titles", async () => {
    const { body } = await run();

    expect(body.data).toEqual({
      ok: true,
      status: 200,
      contentType: "text/calendar",
      byteSize: new TextEncoder().encode(ics).length,
      eventCount: 3,
      sampleSummaries: ["Football vs Iowa", "Volleyball vs Nebraska"],
    });
  });

  it("treats webcal links as HTTPS", async () => {
    await run("  WEBCAL://uwbadgers.com/calendar.ics ");

    expect(mocks.assertPublicHost).toHaveBeenCalledWith("uwbadgers.com");
    expect(mocks.fetchPublicUrl).toHaveBeenCalledWith("https://uwbadgers.com/calendar.ics", expect.anything());
  });

  it("samples at most five titles", async () => {
    const many = ["BEGIN:VCALENDAR", ...Array.from({ length: 7 }, (_, i) => `BEGIN:VEVENT\r\nSUMMARY:Game ${i}\r\nEND:VEVENT`), "END:VCALENDAR"].join("\r\n");
    mocks.fetchPublicUrl.mockResolvedValue(new Response(many, { status: 200 }));

    const { body } = await run();

    expect(body.data.eventCount).toBe(7);
    expect(body.data.sampleSummaries).toEqual(["Game 0", "Game 1", "Game 2", "Game 3", "Game 4"]);
  });

  it.each([
    ["not a URL", "calendar please", "That doesn't look like a valid URL."],
    ["another protocol", "ftp://uwbadgers.com/calendar.ics", "URL must use http or https."],
  ])("rejects %s", async (_label, url, message) => {
    const { response, body } = await run(url);

    expect(response.status).toBe(400);
    expect(body.error).toBe(message);
    expect(mocks.fetchPublicUrl).not.toHaveBeenCalled();
  });

  it("refuses a private host", async () => {
    mocks.assertPublicHost.mockRejectedValue(new Error("private"));

    const { response, body } = await run("http://10.0.0.5/calendar.ics");

    expect(response.status).toBe(400);
    expect(body.error).toBe("URL host is private or non-routable.");
    expect(mocks.fetchPublicUrl).not.toHaveBeenCalled();
  });

  it("reports an HTTP error from the feed", async () => {
    mocks.fetchPublicUrl.mockResolvedValue(new Response("gone", { status: 404, statusText: "Not Found" }));

    const { body } = await run();

    expect(body.data).toEqual(expect.objectContaining({ ok: false, status: 404, error: "HTTP 404 Not Found" }));
  });

  it("says when the page is reachable but is not a calendar", async () => {
    mocks.fetchPublicUrl.mockResolvedValue(new Response("<html>Schedule</html>", { status: 200, headers: { "content-type": "text/html" } }));

    const { body } = await run();

    expect(body.data).toEqual(expect.objectContaining({
      ok: false,
      contentType: "text/html",
      eventCount: 0,
      error: "Reachable, but the response doesn't look like an ICS feed (no BEGIN:VCALENDAR).",
    }));
  });

  it("stops reading a feed past 5 MB", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
      },
      cancel,
    });
    mocks.fetchPublicUrl.mockResolvedValue(new Response(stream, { status: 200 }));

    const { body } = await run();

    expect(body.data).toEqual(expect.objectContaining({ ok: false, byteSize: 6 * 1024 * 1024, error: "Feed exceeds 5 MB cap." }));
    expect(cancel).toHaveBeenCalled();
    expect(sent).toBeLessThan(10);
  });

  it("reports a timeout and a network failure as a failed probe", async () => {
    mocks.fetchPublicUrl.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    expect((await run()).body.data).toEqual(expect.objectContaining({ ok: false, status: 0, error: "Timed out after 8s." }));

    mocks.fetchPublicUrl.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"));
    expect((await run()).body.data.error).toBe("getaddrinfo ENOTFOUND");
  });

  it("is limited to people who can add calendar sources", async () => {
    mocks.requireAuth.mockResolvedValue({ ...admin, role: Role.STUDENT });

    const { response } = await run();

    expect(response.status).toBe(403);
    expect(mocks.fetchPublicUrl).not.toHaveBeenCalled();
  });
});
