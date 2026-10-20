import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderProductPage } from "@/lib/app-product-page";
import { fetchPage, offloadPage, productPages } from "@/lib/app-product-pages";
import { appEntries, renderAppsPage } from "@/lib/apps-page";

describe("app product pages", () => {
  for (const page of productPages) {
    it(`${page.name} page is public, noindex, nonced and links the download`, () => {
      const html = renderProductPage(page, "abc");
      expect(html).toContain('content="noindex"');
      expect(html).not.toMatch(/<script(?![^>]*nonce=)/i);
      expect(html).not.toMatch(/\son[a-z]+=/i);
      if (page.download) expect(html).toContain(page.download);
      expect(html).toContain(`canonical" href="https://wisconsincreative.com/apps/${page.slug}"`);
    });
  }

  it("uses the release download links and live versions", () => {
    expect(fetchPage.download).toBe("https://github.com/erikrole/fetch-releases/releases/latest/download/Fetch.dmg");
    expect(offloadPage.download).toBe("https://github.com/erikrole/offload-releases/releases/download/v1.5.3/Offload-1.5.3.dmg");
    expect(renderProductPage(fetchPage, undefined, { version: "9.9.9", requires: "macOS 28 or later" })).toContain("Version 9.9.9");
  });

  it("the /apps cards link to the pages", () => {
    const html = renderAppsPage();
    for (const { slug } of productPages) {
      expect(appEntries.some((a) => a.page === `/apps/${slug}`)).toBe(true);
      expect(html).toContain(`href="/apps/${slug}"`);
    }
  });
  it("ships real, correctly named screenshots instead of silently missing assets", async () => {
    for (const page of productPages) {
      expect(page.shots.length).toBeGreaterThan(0);
      const html = renderProductPage(page);
      for (const shot of page.shots) {
        const path = `public/apps/shots/${shot.file}`;
        expect(existsSync(path), path).toBe(true);
        const bytes = readFileSync(path);
        const signature = shot.file.endsWith(".png") ? [137,80,78,71] : [255,216,255];
        expect([...bytes.subarray(0,signature.length)], shot.file).toEqual(signature);
        const metadata = await sharp(bytes).metadata();
        expect([metadata.width, metadata.height], shot.file).toEqual([shot.width, shot.height]);
        expect(html).toContain(`href="/apps/shots/${shot.file}"`);
        expect(html).toContain(`alt="${shot.alt}"`);
      }
    }
  });

  it("keeps development previews separate from downloadable releases", () => {
    for (const page of productPages.filter((p) => p.status === "In development")) {
      const html = renderProductPage(page);
      expect(html).toContain("Development preview");
      expect(html).not.toContain('class="btn"');
      expect(html).not.toContain("Version undefined");
      expect(html).not.toMatch(/Version \d/);
    }
    const ios = productPages.find((p) => p.slug === "wisconsin-creative")!;
    expect(renderProductPage(ios)).toContain("View on the App Store");
    expect(renderProductPage(ios)).not.toContain("Download for macOS");
    expect(renderProductPage(ios)).toContain("invitation-only");
  });

  it("uses the release-matched asset when live release metadata supplies one", () => {
    const href = "https://github.com/erikrole/offload-releases/releases/download/v9.9.9/Offload-9.9.9.dmg";
    expect(renderProductPage(offloadPage, undefined, { version: "9.9.9", href })).toContain(`href="${href}"`);
  });

  it("does not carry old compatibility or a missing release asset into a newer version", () => {
    const html = renderProductPage(offloadPage, undefined, { version: "9.9.9" });
    expect(html).not.toContain("Requires macOS 15.0 or later");
    expect(html).not.toContain('class="btn"');
    expect(html).toContain("This overview and its screenshots describe version 1.5.3");
    expect(renderProductPage(offloadPage, undefined, { version: "1.5.3" })).toContain("Requires macOS 15.0 or later");
  });

  it("escapes page copy and exposes keyboard navigation to the content and screenshots", () => {
    const html = renderProductPage({ ...fetchPage, intro: '<script>alert("copy")</script>' }, "nonce");
    expect(html).toContain("&lt;script&gt;alert(&quot;copy&quot;)&lt;/script&gt;");
    expect(html).toContain('href="#content"');
    expect(html).toContain('id="content"');
    expect(html).toContain('aria-label="On this page"');
    expect(html).toContain('aria-label="View full-size screenshot:');
  });
});
