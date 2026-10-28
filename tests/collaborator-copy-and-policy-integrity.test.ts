import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("collaborator affiliation-neutral copy and policy integrity", () => {
  it("does not present shared collaborator surfaces as BTN-only", () => {
    const schedule = source("src/app/(app)/schedule/_components/CollaboratorSchedule.tsx");
    const users = source("src/app/(app)/staff/StaffPageClient.tsx");

    expect(schedule).toContain('description="Upcoming events and crew assignments."');
    expect(schedule).not.toContain("Big Ten Network events");
    const roleTabs = source("src/app/(app)/staff/RoleTabs.tsx");
    expect(roleTabs).toContain('label: "Collaborators"');
    expect(users).not.toContain('label="BTN collaborators"');
    expect(roleTabs).not.toContain("BTN collaborators");
  });

  it("enforces assigned active policies at login and session refresh", () => {
    const login = source("src/app/api/auth/login/route.ts");
    const auth = source("src/lib/auth.ts");
    const access = source("src/lib/collaborator-access.ts");

    expect(login).toContain("requireActiveCollaboratorPolicy(user)");
    expect(auth).toContain("requireActiveCollaboratorPolicy(session.user)");
    expect(access).toContain("if (!actor.collaboratorPolicy)");
    expect(access).not.toContain('actor.collaboratorProfile === "BTN_STANDARD"');
  });
});
