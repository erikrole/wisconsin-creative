import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apps-live-versions", () => ({ loadLiveVersions: vi.fn(async () => ({ "wisconsin-creative": { version: "1.2", requires: "iOS 26.0 or later" } })) }));

import { GET } from "@/app/apps/[slug]/route";
import { loadLiveVersions } from "@/lib/apps-live-versions";

describe("public app detail routes", () => {
  for (const slug of ["wisconsin-creative", "radio-clip", "media-lab"]) {
    it(`serves ${slug} as public noindex HTML with the request nonce`, async () => {
      const response = await GET(new Request(`https://wisconsincreative.com/apps/${slug}`, { headers: { "x-nonce": "test-nonce" } }), { params: Promise.resolve({ slug }) });
      expect(response.status).toBe(200);
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      expect(response.headers.get("cache-control")).toBe("no-store");
      const html = await response.text();
      expect(html).toContain('<script nonce="test-nonce">');
      expect(html).not.toContain("Sign in to continue");
      expect(html).toContain("/apps/shots/");
    });
  }

  it("returns 404 for an unknown app without fetching release data", async () => {
    vi.mocked(loadLiveVersions).mockClear();
    const response = await GET(new Request("https://wisconsincreative.com/apps/unknown"), { params: Promise.resolve({ slug: "unknown" }) });
    expect(response.status).toBe(404);
    expect(loadLiveVersions).not.toHaveBeenCalled();
  });
});
