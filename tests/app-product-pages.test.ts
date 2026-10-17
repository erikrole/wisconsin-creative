import { describe, expect, it } from "vitest";
import { renderProductPage } from "@/lib/app-product-page";
import { fetchPage, offloadPage } from "@/lib/app-product-pages";
import { appEntries, renderAppsPage } from "@/lib/apps-page";

describe("app product pages", () => {
  for (const page of [fetchPage, offloadPage]) {
    it(`${page.name} page is public, noindex, nonced and links the download`, () => {
      const html = renderProductPage(page, "abc");
      expect(html).toContain('content="noindex"');
      expect(html).not.toMatch(/<script(?![^>]*nonce=)/i);
      expect(html).not.toMatch(/\son[a-z]+=/i);
      expect(html).toContain(page.download);
      expect(html).toContain(`canonical" href="https://wisconsincreative.com/apps/${page.slug}"`);
    });
  }

  it("uses the release download links and live versions", () => {
    expect(fetchPage.download).toBe("https://github.com/erikrole/fetch-releases/releases/latest/download/Fetch.dmg");
    expect(offloadPage.download).toBe("https://github.com/erikrole/offload-releases/releases/latest/download/Offload.dmg");
    expect(renderProductPage(fetchPage, undefined, { version: "9.9.9", requires: "macOS 28 or later" })).toContain("Version 9.9.9");
  });

  it("the /apps cards link to the pages", () => {
    const html = renderAppsPage();
    for (const slug of ["fetch", "offload"]) {
      expect(appEntries.some((a) => a.page === `/apps/${slug}`)).toBe(true);
      expect(html).toContain(`href="/apps/${slug}"`);
    }
  });
});
