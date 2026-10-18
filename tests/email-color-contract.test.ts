import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EMAIL_THEME, buildNotificationEmail, escapeEmailHtml, renderEmail } from "@/lib/email";

const producerPaths = [
  "src/lib/services/shift-trade-emails.ts",
  "src/app/api/auth/forgot-password/route.ts",
  "src/lib/services/invite-email.ts",
] as const;

function rgb(hex: string): [number, number, number] {
  return [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(
    (channel) => Number.parseInt(channel, 16) / 255
  ) as [number, number, number];
}

function luminance(hex: string): number {
  const [red, green, blue] = rgb(hex).map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrast(first: string, second: string): number {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("transactional email color contract", () => {
  it("keeps every text role at WCAG AA contrast", () => {
    for (const role of ["text", "body", "muted"] as const) {
      expect(contrast(EMAIL_THEME[role], EMAIL_THEME.background), role).toBeGreaterThanOrEqual(4.5);
    }
    // Footer and eyebrow text sit directly on the page color, not the card.
    expect(contrast(EMAIL_THEME.muted, EMAIL_THEME.page), "muted on page").toBeGreaterThanOrEqual(4.5);
    expect(contrast(EMAIL_THEME.muted, EMAIL_THEME.surface), "muted on surface").toBeGreaterThanOrEqual(4.5);
    expect(contrast(EMAIL_THEME.brand, EMAIL_THEME.page), "link on page").toBeGreaterThanOrEqual(4.5);
    expect(contrast(EMAIL_THEME.danger, EMAIL_THEME.background), "urgent eyebrow").toBeGreaterThanOrEqual(4.5);

    expect(contrast(EMAIL_THEME.onBrand, EMAIL_THEME.brand), "button label").toBeGreaterThanOrEqual(4.5);
  });

  it("keeps email HTML on the shared shell and palette", () => {
    for (const path of producerPaths) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("renderEmail");
      expect(source, path).not.toContain("<!DOCTYPE html>");
      expect(source, path).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });

  it("escapes dynamic content and emits the accessible footer color", () => {
    expect(escapeEmailHtml('<unsafe & "quoted">')).toBe("&lt;unsafe &amp; &quot;quoted&quot;&gt;");

    const notification = buildNotificationEmail({
      title: "Gear <return>",
      body: "Bring A & B",
      bookingTitle: 'Camera "A"',
    });
    expect(notification.html).toContain("Gear &lt;return&gt;");
    expect(notification.html).toContain("Bring A &amp; B");
    expect(notification.html).toContain("Camera &quot;A&quot;");
    expect(notification.html).toContain(`color: ${EMAIL_THEME.muted}`);
    expect(notification.text).toContain("Booking: Camera \"A\"");

    const document = renderEmail({ headline: "Safe", paragraphs: ["Trusted content"] });
    expect(document.html).toContain(`background-color: ${EMAIL_THEME.background}`);
  });
});
