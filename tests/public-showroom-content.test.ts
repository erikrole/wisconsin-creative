import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  featurePillars,
  forbiddenPublicMockupTerms,
  heroMockup,
  pageMockups,
  publicShowroomNav,
  securityControls,
  stackGroups,
} from "@/lib/public-showroom";

const rootLayoutSource = readFileSync("src/app/layout.tsx", "utf8");
const middlewareSource = readFileSync("src/middleware.ts", "utf8");
const themeInitSource = readFileSync("public/theme-init.js", "utf8");
const serviceWorkerInitSource = readFileSync("public/sw-init.js", "utf8");
const aboutLayoutSource = readFileSync("src/app/(public)/about/layout.tsx", "utf8");
const globalsSource = readFileSync("src/app/globals.css", "utf8");
const nextConfigSource = readFileSync("next.config.ts", "utf8");
const deploySmokeSource = readFileSync("scripts/deploy-smoke.mjs", "utf8");
const publicNavSource = readFileSync("src/components/public-showroom/PublicShowroomNav.tsx", "utf8");
const showroomBlocksSource = readFileSync("src/components/public-showroom/showroom-blocks.tsx", "utf8");

describe("public showroom content", () => {
  it("keeps the expected public route set", () => {
    expect(publicShowroomNav.map((item) => item.href)).toEqual([
      "/about",
      "/about/features",
      "/about/tech-stack",
      "/about/security",
      "/about/field-work",
      "/releases",
    ]);
  });

  it("gives every nav destination a cross-link description", () => {
    for (const item of publicShowroomNav) {
      expect(item.description.trim().length).toBeGreaterThan(10);
    }
  });

  it("pins the showroom to light tokens regardless of app theme", () => {
    expect(aboutLayoutSource).toContain('data-theme="light"');
    expect(globalsSource).toMatch(/:root,\s*\[data-theme="light"\]/);
  });

  it("keeps the public header wordmark readable on its dark background", () => {
    expect(publicNavSource).toContain('aria-label="Wisconsin Creative public pages"');
    expect(publicNavSource).toMatch(/aria-label="Wisconsin Creative public pages"[^>]*className="[^"]*text-white/);
  });

  it("ships share metadata and a social image for the showroom", () => {
    expect(aboutLayoutSource).toContain("metadataBase");
    expect(aboutLayoutSource).toContain("openGraph");
    expect(aboutLayoutSource).toContain("wisconsincreative.com");
    expect(existsSync("src/app/(public)/about/opengraph-image.tsx")).toBe(true);
  });

  it("keeps feature, stack, and security sections populated", () => {
    expect(featurePillars.length).toBeGreaterThanOrEqual(6);
    expect(stackGroups.length).toBeGreaterThanOrEqual(4);
    expect(securityControls.length).toBeGreaterThanOrEqual(6);
  });

  it("does not include known live-user or incident identifiers in public mockups", () => {
    const content = JSON.stringify({
      heroMockup,
      pageMockups,
      featurePillars,
      stackGroups,
      securityControls,
    });

    for (const term of forbiddenPublicMockupTerms) {
      expect(content).not.toContain(term);
    }
  });

  it("keeps the public shell compatible with nonce CSP", () => {
    expect(rootLayoutSource).not.toContain("dangerouslySetInnerHTML");
    expect(rootLayoutSource).toContain('src="/theme-init.js"');
    expect(rootLayoutSource).toContain('src="/sw-init.js"');
    expect(existsSync("src/middleware.ts")).toBe(true);
    expect(middlewareSource).toContain("x-nonce");
    expect(middlewareSource).toContain("Content-Security-Policy");
  });

  it("keeps boot scripts same-origin and CSP-compatible", () => {
    expect(themeInitSource).toContain('localStorage.getItem("theme")');
    expect(themeInitSource).toContain('localStorage.getItem("text-scale")');
    expect(serviceWorkerInitSource).toContain('navigator.serviceWorker.register("/sw.js")');
    expect(serviceWorkerInitSource).toContain("getRegistrations");
    expect(`${themeInitSource}\n${serviceWorkerInitSource}`).not.toContain("https://");
  });

  it("keeps production CSP nonce-based for Next App Router inline bootstrap", () => {
    expect(rootLayoutSource).toContain('import { headers } from "next/headers"');
    expect(rootLayoutSource).toContain("const nonce = (await headers()).get(\"x-nonce\")");
    expect(rootLayoutSource).toContain("nonce={nonce}");
    expect(middlewareSource).toContain("'strict-dynamic'");
    expect(middlewareSource).toContain("`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'");
    expect(middlewareSource).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(nextConfigSource).not.toContain("Content-Security-Policy");
  });

  it("ships deploy smoke coverage for public routes and seeded-login checks", () => {
    for (const href of ["/about", "/about/features", "/about/tech-stack", "/about/security", "/about/field-work", "/releases", "/privacy", "/login"]) {
      expect(deploySmokeSource).toContain(`path: "${href}"`);
    }
    expect(deploySmokeSource).toContain("DEPLOY_SMOKE_EMAIL");
    expect(deploySmokeSource).toContain("DEPLOY_SMOKE_PASSWORD");
    expect(deploySmokeSource).toContain("/api/auth/login");
    expect(deploySmokeSource).toContain("assertNonceCsp");
    expect(deploySmokeSource).toContain("unsafe-inline");
  });

  it("keeps public showroom presentation solid and restrained", () => {
    expect(showroomBlocksSource).not.toContain("radial-gradient");
    expect(showroomBlocksSource).not.toContain("0_18px_60px");
    expect(showroomBlocksSource).not.toContain("rounded-[2rem]");
  });
});
