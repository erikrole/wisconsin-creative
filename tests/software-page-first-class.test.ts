import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("first-class Software page", () => {
  it("separates shared logins from Photo Mechanic with a linkable tab boundary", () => {
    const page = source("src/app/(app)/licenses/page.tsx");

    expect(page).toContain('type SoftwareSection = "shared-logins" | "photo-mechanic"');
    expect(page).toContain('useUrlState<SoftwareSection>');
    expect(page).toContain('value="shared-logins"');
    expect(page).toContain('value="photo-mechanic"');
    expect(page.indexOf('value="photo-mechanic"')).toBeLessThan(page.indexOf('value="shared-logins"'));
    expect(page).toContain('value === "shared-logins" ? "shared-logins" : "photo-mechanic"');
    expect(page).toContain('value === "photo-mechanic" ? null : value');
    expect(page).toContain("PhotoMechanicLicenses");
    expect(page).toContain("Two-device Photo Mechanic activation. Claim one slot and copy your code.");

    const licenses = source("src/app/(app)/licenses/PhotoMechanicLicenses.tsx");
    expect(licenses).toContain('url: "/api/licenses"');
    expect(licenses).toContain('url: "/api/licenses/my"');
    expect(licenses).toContain("Claim any Open or 1/2 code below.");
  });

  it("keeps collaborator access on shared logins and explains role-load failures", () => {
    const page = source("src/app/(app)/licenses/page.tsx");

    expect(page).toContain('isCollaborator && activeSection === "photo-mechanic"');
    expect(page).toContain('setActiveSection("shared-logins")');
    expect(page).toContain("Couldn't load your Software access");
    expect(page).toContain("onAction={reloadAccess}");
  });

  it("uses shared-login product language and does not classify Photo Mechanic as a normal login", () => {
    const vault = source("src/app/(app)/licenses/SoftwareVault.tsx");

    expect(vault).toContain("Shared logins");
    expect(vault).toContain("Add shared login");
    expect(vault).toContain('const SUGGESTED_SOFTWARE = ["Envato Elements", "APM Music", "Motion Array"]');
    expect(vault).toContain("Staff operators can always manage every shared login");
    expect(vault).not.toContain('["Photo Mechanic", "Envato Elements"');
  });

  it("guards secret and lifecycle actions while keeping failed archive confirmation recoverable", () => {
    const vault = source("src/app/(app)/licenses/SoftwareVault.tsx");

    expect(vault).toContain('method: "POST"');
    expect(vault).toContain("secretRequestIds.current.has(id)");
    expect(vault).toContain("mutationIds.current.has(id)");
    expect(vault).toContain("clearRevealedPassword(target.id)");
    expect(vault).toContain("event.preventDefault()");
    expect(vault).toContain("pendingMutationIds.has(archiveTarget.id)");
  });
});
