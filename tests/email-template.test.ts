import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { appUrl: "https://creative.example.test", appTimezone: "America/Chicago", emailReplyTo: "" },
}));

import { EMAIL_THEME, renderEmail } from "@/lib/email-template";

describe("renderEmail", () => {
  it("renders the shared shell with logo, headline, facts, and one button", () => {
    const { html } = renderEmail({
      preheader: "Preview line",
      eyebrow: "Shift update",
      headline: "Your call time moved",
      paragraphs: ["Hi Maya, it changed."],
      facts: [{ label: "Event", value: "Wisconsin vs. Iowa" }],
      action: { label: "View your schedule", url: "https://creative.example.test/schedule" },
      manageNotifications: true,
    });
    expect(html).toContain('src="https://creative.example.test/icon-192.png"');
    expect(html).toContain("Wisconsin Creative");
    expect(html).toContain("Preview line");
    expect(html).toContain('name="color-scheme" content="light"');
    expect(html).toContain(`bgcolor="${EMAIL_THEME.brand}"`);
    expect(html.match(/<a href=/g)?.filter((tag) => tag).length).toBe(2); // button + manage link
    expect(html).toContain("https://creative.example.test/settings/notifications");
    expect(html).not.toMatch(/display:\s*flex/);
  });

  it("escapes every dynamic field and keeps urls attribute-safe", () => {
    const { html, text } = renderEmail({
      eyebrow: "<e>",
      headline: "<h>",
      paragraphs: ["<p>"],
      facts: [{ label: "<l>", value: "<v>" }],
      steps: { heading: "<s>", items: ["<i>"] },
      action: { label: "<a>", url: 'https://x.test/?a="b"' },
      note: "<n>",
      footer: ["<f>"],
    });
    expect(html).not.toMatch(/<(e|h|p|l|v|s|i|a|n|f)>/);
    expect(html).toContain("https://x.test/?a=&quot;b&quot;");
    expect(text).toContain("<h>");
  });

  it("writes a plain-text version with the link, facts, and steps", () => {
    const { text } = renderEmail({
      headline: "Welcome",
      paragraphs: ["Hello."],
      steps: { heading: "Set up", items: ["One", "Two"] },
      facts: [{ label: "Due", value: "Today" }],
      action: { label: "Open", url: "https://creative.example.test" },
      footer: ["Questions? Reply."],
    });
    expect(text).toContain("Welcome");
    expect(text).toContain("1. One");
    expect(text).toContain("2. Two");
    expect(text).toContain("Due: Today");
    expect(text).toContain("Open: https://creative.example.test");
    expect(text).toContain("Questions? Reply.");
  });

  it("shows the fallback link and uses the danger color for urgent eyebrows", () => {
    const { html } = renderEmail({
      eyebrow: "Overdue",
      urgent: true,
      headline: "Your gear is overdue",
      paragraphs: ["Return it."],
      action: { label: "View checkout", url: "https://creative.example.test/checkouts" },
      showFallbackLink: true,
    });
    expect(html).toContain("Button not working?");
    expect(html).toContain(`color: ${EMAIL_THEME.danger}`);
  });
});
