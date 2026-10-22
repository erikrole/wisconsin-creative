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
    const internal: WebTool = { label: "Internal", href: "/internal", icon: WEB_TOOLS[0]!.icon, description: "x", roles: ["ADMIN"] };
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
