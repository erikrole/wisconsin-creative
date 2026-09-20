import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Oklab = { lightness: number; a: number; b: number };
type Rgb = { red: number; green: number; blue: number };

const css = readFileSync("src/app/globals.css", "utf8");
const calloutTypes = ["note", "tip", "shortcut", "important", "warning", "caution"] as const;

function accent(type: (typeof calloutTypes)[number], dark: boolean): Oklab {
  const prefix = dark ? '\\[data-theme="dark"\\] ' : "(?:^|\\n)";
  const selector = `${prefix}\\.guide-alert-${type}\\s*\\{([\\s\\S]*?)\\n\\}`;
  const block = css.match(new RegExp(selector))?.[1];
  const value = block?.match(/--callout-accent:\s*([^;]+);/)?.[1]?.trim();
  const channels = value?.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);

  if (!channels) throw new Error(`Could not parse ${dark ? "dark" : "light"} ${type} accent`);

  const lightness = Number(channels[1]);
  const chroma = Number(channels[2]);
  const hue = Number(channels[3]) * Math.PI / 180;
  return { lightness, a: chroma * Math.cos(hue), b: chroma * Math.sin(hue) };
}

function hexToOklab(hex: string): Oklab {
  const rgb = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((channel) =>
    srgbToLinear(Number.parseInt(channel, 16) / 255)
  );
  const l = Math.cbrt(0.4122214708 * rgb[0]! + 0.5363325363 * rgb[1]! + 0.0514459929 * rgb[2]!);
  const m = Math.cbrt(0.2119034982 * rgb[0]! + 0.6806995451 * rgb[1]! + 0.1073969566 * rgb[2]!);
  const s = Math.cbrt(0.0883024619 * rgb[0]! + 0.2817188376 * rgb[1]! + 0.6299787005 * rgb[2]!);

  return {
    lightness: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function mixOklab(foreground: Oklab, background: Oklab, foregroundAmount: number): Oklab {
  return {
    lightness: foreground.lightness * foregroundAmount + background.lightness * (1 - foregroundAmount),
    a: foreground.a * foregroundAmount + background.a * (1 - foregroundAmount),
    b: foreground.b * foregroundAmount + background.b * (1 - foregroundAmount),
  };
}

function oklabToSrgb(color: Oklab): Rgb {
  const l = (color.lightness + 0.3963377774 * color.a + 0.2158037573 * color.b) ** 3;
  const m = (color.lightness - 0.1055613458 * color.a - 0.0638541728 * color.b) ** 3;
  const s = (color.lightness - 0.0894841775 * color.a - 1.291485548 * color.b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  for (const channel of linear) {
    expect(channel, "callout color must stay in sRGB gamut").toBeGreaterThanOrEqual(0);
    expect(channel, "callout color must stay in sRGB gamut").toBeLessThanOrEqual(1);
  }

  return {
    red: linearToSrgb(linear[0]!),
    green: linearToSrgb(linear[1]!),
    blue: linearToSrgb(linear[2]!),
  };
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(color: Rgb): number {
  return 0.2126 * srgbToLinear(color.red) + 0.7152 * srgbToLinear(color.green) + 0.0722 * srgbToLinear(color.blue);
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
}

describe("Guide callout palette", () => {
  it("uses OKLCH mixing for borders and tinted backgrounds", () => {
    expect(css).toContain("color-mix(in oklch, var(--callout-accent");
    expect(css).not.toContain("color-mix(in srgb, var(--callout-accent");
  });

  it.each([
    ["light", false, "#ffffff"],
    ["dark", true, "#1a1a1a"],
  ] as const)("keeps %s callout headers readable on their tinted cards", (_theme, dark, cardHex) => {
    const card = hexToOklab(cardHex);

    for (const type of calloutTypes) {
      const foreground = accent(type, dark);
      const tintedCard = mixOklab(foreground, card, 0.08);
      expect(
        contrastRatio(oklabToSrgb(foreground), oklabToSrgb(tintedCard)),
        `${type} callout header`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
