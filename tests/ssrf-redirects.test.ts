import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) =>
    host === "internal.example"
      ? { address: "169.254.169.254", family: 4 }
      : host === "mapped.example"
        ? { address: "::ffff:7f00:1", family: 6 }
        : { address: "93.184.216.34", family: 4 },
  ),
}));

import { assertPublicHost, fetchPublicUrl } from "@/lib/security/ssrf";

afterEach(() => vi.unstubAllGlobals());

describe("fetchPublicUrl", () => {
  it("refuses a redirect from a public host to an internal one", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "http://internal.example/meta" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchPublicUrl("https://public.example/a.ics")).rejects.toThrow(/private/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect between public hosts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/b.ics" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchPublicUrl("https://public.example/a.ics");
    expect(await res.text()).toBe("ok");
  });

  it("treats hex IPv4-mapped IPv6 loopback as private", async () => {
    await expect(assertPublicHost("mapped.example")).rejects.toThrow(/private/);
  });
});
