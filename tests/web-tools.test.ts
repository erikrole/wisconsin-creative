import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WEB_TOOLS, toolsForRole, type WebTool } from "@/lib/web-tools";

describe("sidebar web tools", () => {
  it("lists every tool for every role by default, collaborators included", () => {
    for (const role of ["ADMIN", "STAFF", "STUDENT", "COLLABORATOR"]) {
      expect(toolsForRole(role)).toHaveLength(WEB_TOOLS.length);
    }
  });

  it("filters a role-restricted tool", () => {
    const internal: WebTool = { label: "Internal", href: "/internal", icon: WEB_TOOLS[0]!.icon, roles: ["ADMIN"] };
    expect(toolsForRole("ADMIN", [internal])).toHaveLength(1);
    expect(toolsForRole("COLLABORATOR", [internal])).toHaveLength(0);
  });

  it("points each tool at a static page that ships in public/", () => {
    for (const tool of WEB_TOOLS) {
      expect(existsSync(join(process.cwd(), "public", tool.href, "index.html")), tool.href).toBe(true);
    }
  });

  it("has unique hrefs", () => {
    expect(new Set(WEB_TOOLS.map((t) => t.href)).size).toBe(WEB_TOOLS.length);
  });
});

describe("sidebar apps and quick links", () => {
  it("links our apps to their public pages and the App Store", async () => {
    const { SIDEBAR_APPS } = await import("@/lib/sidebar-links");
    const hrefs = SIDEBAR_APPS.map((app) => app.href);
    expect(hrefs).toContain("/apps/offload");
    expect(hrefs).toContain("/apps/fetch");
    expect(hrefs.some((href) => href.startsWith("https://apps.apple.com/"))).toBe(true);
  });

  it("shows each quick link only to the roles it names", async () => {
    const { ADMIN_ONLY, linksForRole } = await import("@/lib/sidebar-links");
    const links = [
      { label: "Everyone", href: "https://example.com/a", icon: WEB_TOOLS[0]!.icon },
      { label: "Admins", href: "https://example.com/b", icon: WEB_TOOLS[0]!.icon, roles: ADMIN_ONLY },
    ];
    expect(linksForRole("ADMIN", links).map((l) => l.label)).toEqual(["Everyone", "Admins"]);
    expect(linksForRole("STUDENT", links).map((l) => l.label)).toEqual(["Everyone"]);
    expect(linksForRole(undefined, links).map((l) => l.label)).toEqual(["Everyone"]);
  });

  it("uses https for every external quick link and keeps hrefs unique", async () => {
    const { QUICK_LINKS } = await import("@/lib/sidebar-links");
    for (const link of QUICK_LINKS) expect(link.href.startsWith("https://"), link.label).toBe(true);
    expect(new Set(QUICK_LINKS.map((l) => l.href)).size).toBe(QUICK_LINKS.length);
  });
});
