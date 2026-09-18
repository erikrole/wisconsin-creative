import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("kit gameday authoring", () => {
  it("scopes kit-detail item search to the kit location and offers duplicate", () => {
    const source = readFileSync("src/app/(app)/kits/[id]/page.tsx", "utf8");
    expect(source).toContain("location_id=${encodeURIComponent(id)}");
    expect(source).toContain("handleClone");
    expect(source).toContain("/api/kits/${id}/clone");
    expect(source).toContain("Duplicate");
    expect(source).toContain("without cameras");
    expect(source).toContain("sportCode");
    expect(source).toContain("gamedayRole");
    expect(source).toContain("Job");
    expect(source).toContain("FOOTBALL_GAMEDAY_KIT_ROLE_OPTIONS");
  });

  it("keeps kit authoring pages staff-only while reservation routes can list kits", () => {
    const layout = readFileSync("src/app/(app)/kits/layout.tsx", "utf8");
    const list = readFileSync("src/app/api/kits/route.ts", "utf8");
    expect(layout).toContain('requirePermission(user.role, "kit", "create")');
    expect(list).toContain("requirePermissionOrCollaboratorCapability");
    expect(list).toContain("RESERVATION_CREATE");
    expect(list).toContain("gamedayRole");
    expect(list).toContain("suggestedKitId");
    expect(list).toContain("requester_user_id");
  });
});
