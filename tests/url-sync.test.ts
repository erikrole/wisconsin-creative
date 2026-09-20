import { afterEach, describe, expect, it, vi } from "vitest";
import { syncUrl } from "@/lib/url-sync";

afterEach(() => vi.unstubAllGlobals());

describe("syncUrl", () => {
  it("preserves history metadata and unrelated URL state when filters change", () => {
    const state = { __NA: true, tree: ["items"], scroll: 480 };
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      location: { href: "https://app.example.com/items?other=1&page=2#section" },
      history: { state, replaceState },
    });

    syncUrl({ page: 0, q: "camera" });

    expect(replaceState).toHaveBeenCalledWith(state, "", "https://app.example.com/items?other=1&q=camera#section");
  });
});
