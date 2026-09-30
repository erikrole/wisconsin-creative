import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { withCron } from "@/lib/cron";

const originalCronSecret = process.env.CRON_SECRET;
const noParams = { params: Promise.resolve({}) };

function makeRequest(authHeader?: string) {
  return new Request("https://app.example.com/api/cron/test", {
    method: "GET",
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

afterEach(() => {
  process.env.CRON_SECRET = originalCronSecret;
});

describe("withCron", () => {
  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withCron(handler);

    const res = await wrapped(makeRequest("Bearer anything"), noParams);

    expect(res.status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(["Bearer wrong", "Bearer sécret-123"])("returns 401 for invalid token %s", async (token) => {
    process.env.CRON_SECRET = "secret-123";
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withCron(handler);

    const res = await wrapped(makeRequest(token), noParams);

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler for a matching bearer token", async () => {
    process.env.CRON_SECRET = "secret-123";
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withCron(handler);

    const res = await wrapped(makeRequest("Bearer secret-123"), noParams);

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
});
