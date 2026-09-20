import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownReader } from "@/components/resources/MarkdownReader";

describe("MarkdownReader", () => {
  it("preserves each Markdown image's intrinsic aspect ratio", () => {
    const html = renderToStaticMarkup(createElement(MarkdownReader, {
      markdown: "![Portrait screenshot](https://example.com/portrait.png)",
    }));

    expect(html).toContain('src="https://example.com/portrait.png"');
    expect(html).toContain('alt="Portrait screenshot"');
    expect(html).toContain('class="block h-auto max-w-full w-auto"');
    expect(html).not.toContain('width="1400"');
    expect(html).not.toContain('height="900"');
  });

  it("uses visible rich heading text for rendered heading ids", () => {
    const html = renderToStaticMarkup(createElement(MarkdownReader, {
      markdown: "## **Server** [Paths](https://example.com)",
    }));

    expect(html).toContain('id="server-paths"');
    expect(html).toContain('href="#server-paths"');
    expect(html).not.toContain("object-object");
  });

  it("renders a GitHub-style alert as a callout card", () => {
    const html = renderToStaticMarkup(createElement(MarkdownReader, {
      markdown: "> [!WARNING]\n> Do not unplug the drive mid-transfer.",
    }));

    expect(html).toContain("guide-alert-warning");
    expect(html).toContain("Warning");
    expect(html).toContain("Do not unplug the drive mid-transfer.");
    expect(html).not.toContain("[!WARNING]");
  });

  it("renders a shortcut callout and keyboard chips", () => {
    const html = renderToStaticMarkup(createElement(MarkdownReader, {
      markdown: "> [!SHORTCUT]\n> Press `⌘K` to search.\n\n1. Open Finder.\n2. Paste `smb://server/share`.",
    }));

    expect(html).toContain("guide-alert-shortcut");
    expect(html).toContain("Shortcut");
    expect(html).toContain("guide-kbd-combo");
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Keyboard shortcut Command K"');
    expect(html).toContain("guide-kbd");
    expect(html).toContain("⌘");
    expect(html).toContain("guide-markdown-steps");
    expect(html).toContain("guide-markdown-inline-code");
    expect(html).toContain("smb://server/share");
    expect(html).not.toContain("[!SHORTCUT]");
    expect(html).not.toContain("guide-kbd-plus");
  });

  it("still recognises an escaped alert marker", () => {
    const html = renderToStaticMarkup(createElement(MarkdownReader, {
      markdown: "> \\[!IMPORTANT]\n> Connect to VPN first.",
    }));

    expect(html).toContain("guide-alert-important");
    expect(html).toContain("Important");
    expect(html).toContain("Connect to VPN first.");
  });

  it("renders a plain blockquote when there is no alert marker", () => {
    const html = renderToStaticMarkup(createElement(MarkdownReader, {
      markdown: "> Just a quote.",
    }));

    expect(html).toContain("guide-markdown-quote");
    expect(html).not.toContain("guide-alert");
  });

  it("renders an embed fence as a trusted iframe", () => {
    const html = renderToStaticMarkup(createElement(MarkdownReader, {
      markdown: "```embed\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n```",
    }));

    expect(html).toContain('src="https://www.youtube.com/embed/dQw4w9WgXcQ"');
    expect(html).toContain("guide-embed-frame");
  });

  it("falls back to a link for non-allowlisted embed URLs", () => {
    const html = renderToStaticMarkup(createElement(MarkdownReader, {
      markdown: "```embed\nhttps://evil.example.com/clip\n```",
    }));

    expect(html).not.toContain("<iframe");
    expect(html).toContain("https://evil.example.com/clip");
  });

  it("renders copy and path fences as one-tap copy controls", () => {
    const copy = renderToStaticMarkup(createElement(MarkdownReader, {
      markdown: "```copy\nsmb://ath01-nas.uwia.wisc.edu/users/\n```",
    }));
    expect(copy).toContain("guide-copy-snippet");
    expect(copy).toContain("smb://ath01-nas.uwia.wisc.edu/users/");
    expect(copy).toContain("Copy");
    expect(copy).not.toContain("guide-markdown-code-block");

    const path = renderToStaticMarkup(createElement(MarkdownReader, {
      markdown: "```path\n/Volumes/users/shares/Media/RESOURCES/VIDEO/LUTs\n```",
    }));
    expect(path).toContain("guide-copy-snippet");
    expect(path).toContain("/Volumes/users/shares/Media/RESOURCES/VIDEO/LUTs");
  });

  it("continues numbered steps after a figure using the list start value", () => {
    const html = renderToStaticMarkup(createElement(MarkdownReader, {
      markdown: "1. Open Finder.\n\n![Go menu](https://example.com/go.png)\n\n2. Paste the address.",
    }));
    expect(html).toContain("guide-markdown-steps");
    expect(html).toContain('start="2"');
    expect(html).toMatch(/counter-reset:\s*guide-step\s+1/);
  });
});
