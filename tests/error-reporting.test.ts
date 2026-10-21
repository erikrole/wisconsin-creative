import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    errorIssue: { upsert: vi.fn(), updateMany: vi.fn() },
    errorEvent: { findFirst: vi.fn(), update: vi.fn(), count: vi.fn(), create: vi.fn() },
    user: { findMany: vi.fn() },
    notification: { createMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn() }));

import { errorTitle, normalizeMessage, routeTemplate, stripQuery, summarizeUserAgent } from "@/lib/error-reporting/grouping";
import { fingerprintFor } from "@/lib/error-reporting/fingerprint";
import { buildServerErrorReport } from "@/lib/error-reporting/server";
import { isIgnorableError } from "@/lib/error-reporting/client";
import { recordErrorReport } from "@/lib/services/error-reports";
import { HttpError } from "@/lib/http";

describe("grouping", () => {
  it("strips the values that change between occurrences of one failure", () => {
    expect(normalizeMessage("Booking clx0abc123def456ghi789jkl not found for user 42 (a@b.com)")).toBe(
      "Booking <id> not found for user <n> (<email>)",
    );
    // Property names in quotes are what makes a TypeError useful, so they stay.
    expect(normalizeMessage("Cannot read properties of undefined (reading 'id')")).toBe(
      "Cannot read properties of undefined (reading 'id')",
    );
  });

  it("turns record paths into route templates and drops query strings", () => {
    expect(routeTemplate("/bookings/clx0abc123def456ghi789jkl/edit?tab=gear")).toBe("/bookings/[id]/edit");
    expect(routeTemplate("/items/12345")).toBe("/items/[id]");
    expect(routeTemplate("/schedule")).toBe("/schedule");
    expect(stripQuery("/search?q=secret")).toBe("/search");
  });

  it("gives two occurrences of the same failure on different records one fingerprint", () => {
    const base = { platform: "web" as const, kind: "error", name: "TypeError", culprit: "/bookings/[id]" };
    expect(fingerprintFor({ ...base, message: "No kit 1234 for booking clx0abc123def456ghi789jkl" })).toBe(
      fingerprintFor({ ...base, message: "No kit 98 for booking clz9xyz987wvu654tsr321qpo" }),
    );
    expect(fingerprintFor({ ...base, message: "a" })).not.toBe(fingerprintFor({ ...base, culprit: "/items", message: "a" }));
  });

  it("titles a report without repeating a generic Error name", () => {
    expect(errorTitle({ name: "Error", message: "Boom 12" })).toBe("Boom <n>");
    expect(errorTitle({ name: "TypeError", message: "x is not a function" })).toBe("TypeError: x is not a function");
  });

  it("summarizes a user agent without the frozen macOS version", () => {
    expect(
      summarizeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15"),
    ).toEqual({ browser: "Safari 18.2", os: "macOS" });
    expect(
      summarizeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1"),
    ).toEqual({ browser: "Chrome 130", os: "iOS 18.1" });
  });
});

describe("server capture", () => {
  it("records unexpected failures with the request id and route", () => {
    const report = buildServerErrorReport(new TypeError("boom"), {
      kind: "api_error",
      method: "post",
      path: "/api/bookings/clx0abc123def456ghi789jkl/extend",
      headers: new Headers({ "x-vercel-id": "iad1::abc-123" }),
    });
    expect(report).toEqual(
      expect.objectContaining({
        platform: "server",
        name: "TypeError",
        culprit: "POST /api/bookings/[id]/extend",
        requestId: "iad1::abc-123",
      }),
    );
  });

  it("skips expected HTTP outcomes and Next control flow", () => {
    expect(buildServerErrorReport(new HttpError(401, "Authentication required"), { kind: "render_error" })).toBeNull();
    expect(buildServerErrorReport(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }), { kind: "render_error" })).toBeNull();
    expect(buildServerErrorReport(new HttpError(503, "Down"), { kind: "render_error" })).not.toBeNull();
  });
});

describe("browser noise", () => {
  it("ignores extension and cross-origin script errors", () => {
    expect(isIgnorableError("Script error.")).toBe(true);
    expect(isIgnorableError("x is undefined", "at foo (chrome-extension://abc/content.js:1:1)")).toBe(true);
    expect(isIgnorableError("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
    expect(isIgnorableError("Cannot read properties of null (reading 'map')")).toBe(false);
  });
});

describe("recordErrorReport", () => {
  const input = { platform: "web" as const, kind: "error", name: "TypeError", message: "boom", culprit: "/items" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.errorEvent.findFirst.mockResolvedValue(null);
    mocks.db.errorEvent.count.mockResolvedValue(0);
    mocks.db.errorEvent.create.mockResolvedValue({});
    mocks.db.errorIssue.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.user.findMany.mockResolvedValue([{ id: "admin-1" }]);
    mocks.db.notification.createMany.mockResolvedValue({ count: 1 });
  });

  it("opens an issue, stores the occurrence with the person, and tells admins once", async () => {
    mocks.db.errorIssue.upsert.mockResolvedValue({ id: "issue-1", status: "open", eventCount: 1, resolvedAt: null });
    const result = await recordErrorReport(input, { id: "user-1", role: "STUDENT" });
    expect(result).toEqual({ issueId: "issue-1", stored: true, isNew: true, regressed: false });
    expect(mocks.db.errorEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ issueId: "issue-1", userId: "user-1", role: "STUDENT", message: "boom" }),
    });
    expect(mocks.db.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ userId: "admin-1", type: "error_issue", dedupeKey: "error_issue:issue-1:new:admin-1" })],
        skipDuplicates: true,
      }),
    );
  });

  it("reopens a fixed issue only for an occurrence after the fix", async () => {
    const resolvedAt = new Date("2026-10-20T12:00:00Z");
    mocks.db.errorIssue.upsert.mockResolvedValue({ id: "issue-1", status: "resolved", eventCount: 5, resolvedAt });

    const late = await recordErrorReport({ ...input, occurredAt: new Date("2026-10-20T08:00:00Z") });
    expect(late.regressed).toBe(false);
    expect(mocks.db.errorIssue.updateMany).not.toHaveBeenCalled();

    const fresh = await recordErrorReport({ ...input, occurredAt: new Date("2026-10-20T13:00:00Z") });
    expect(fresh.regressed).toBe(true);
    expect(mocks.db.errorIssue.updateMany).toHaveBeenCalledWith({
      where: { id: "issue-1", status: "resolved" },
      data: expect.objectContaining({ status: "open" }),
    });
  });

  it("counts a flood but stops storing details past the hourly cap", async () => {
    mocks.db.errorIssue.upsert.mockResolvedValue({ id: "issue-1", status: "open", eventCount: 400, resolvedAt: null });
    mocks.db.errorEvent.count.mockResolvedValue(20);
    const result = await recordErrorReport(input);
    expect(result.stored).toBe(false);
    expect(mocks.db.errorEvent.create).not.toHaveBeenCalled();
  });

  it("adds browser context to the server render failure with the same digest instead of a new issue", async () => {
    mocks.db.errorEvent.findFirst.mockResolvedValue({ id: "event-9", issueId: "issue-9", userId: null, screen: null, breadcrumbs: null, context: null });
    const result = await recordErrorReport(
      { ...input, kind: "render_error", digest: "12345", screen: "/items/abc", breadcrumbs: [{ at: "2026-10-20T00:00:00Z", type: "nav", message: "/items/[id]" }] },
      { id: "user-1", role: "STAFF" },
    );
    expect(result.issueId).toBe("issue-9");
    expect(mocks.db.errorIssue.upsert).not.toHaveBeenCalled();
    expect(mocks.db.errorEvent.update).toHaveBeenCalledWith({
      where: { id: "event-9" },
      data: expect.objectContaining({ userId: "user-1", screen: "/items/abc" }),
    });
  });
});

describe("failRequest", () => {
  it("records only failures it answers with a 5xx", async () => {
    const { failRequest } = await import("@/lib/api-handler");
    const { captureServerError } = await import("@/lib/error-reporting/server");
    const req = new Request("https://app.example.com/api/items/1", { method: "PATCH" });

    expect(failRequest(new HttpError(404, "Not found"), req).status).toBe(404);
    expect(captureServerError).not.toHaveBeenCalled();

    expect(failRequest(new Error("db down"), req, { id: "user-1", role: "ADMIN" }).status).toBe(500);
    expect(captureServerError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      kind: "api_error",
      method: "PATCH",
      path: "/api/items/1",
      user: { id: "user-1", role: "ADMIN" },
    }));
  });
});
