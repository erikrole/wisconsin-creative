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
    expect(html).toContain('class="block h-auto w-full"');
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
});
