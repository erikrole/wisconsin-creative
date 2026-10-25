import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAppStoreVersion, loadLiveVersions, madisonDate } from "@/lib/apps-live-versions";

function stubFetch(routes: Record<string, unknown>) {
  const fetcher = vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((part) => url.includes(part));
    const value = key ? routes[key] : undefined;
    if (value instanceof Error) throw value;
    // A failing status still carries parseable JSON, so only the status check can reject it.
    if (value === undefined) return new Response(JSON.stringify({ results: [{ version: "9.9" }], tag_name: "9.9" }), { status: 503 });
    return new Response(JSON.stringify(value), { status: 200 });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

const appStore = { results: [{ version: "1.4.1", currentVersionReleaseDate: "2026-10-25T03:00:00Z", minimumOsVersion: "18.0" }] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadLiveVersions", () => {
  it("reads all three apps and asks GitHub for its JSON format", async () => {
    const fetcher = stubFetch({
      "itunes.apple.com": appStore,
      "offload-releases": { tag_name: "v3.2.0" },
      "fetch-releases": { tag_name: "1.1" },
    });

    expect(await loadLiveVersions()).toEqual({
      "wisconsin-creative": { version: "1.4.1", released: "2026-10-24", requires: "iOS 18.0 or later" },
      offload: { version: "3.2.0" },
      fetch: { version: "1.1" },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/repos/erikrole/offload-releases/releases/latest",
      expect.objectContaining({ headers: { accept: "application/vnd.github+json" } }),
    );
  });

  it("leaves out an app whose lookup fails or returns nonsense", async () => {
    stubFetch({
      "itunes.apple.com": new Error("offline"),
      "offload-releases": { tag_name: "nightly" },
      "fetch-releases": { tag_name: "2.0.0" },
    });

    expect(await loadLiveVersions()).toEqual({ fetch: { version: "2.0.0" } });
  });

  it("treats an error status as a failed lookup", async () => {
    stubFetch({});

    expect(await loadLiveVersions()).toEqual({});
  });
});

describe("loadAppStoreVersion", () => {
  it("returns the listing, or nothing when the lookup fails", async () => {
    stubFetch({ "itunes.apple.com": appStore });
    expect(await loadAppStoreVersion()).toEqual(expect.objectContaining({ version: "1.4.1" }));

    stubFetch({});
    expect(await loadAppStoreVersion()).toBeUndefined();
  });
});

describe("madisonDate", () => {
  it("returns nothing for a bad date", () => {
    expect(madisonDate("soon")).toBeUndefined();
  });
});
