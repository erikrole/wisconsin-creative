import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("collaborator affiliation-neutral copy and policy integrity", () => {
  it("does not present shared collaborator surfaces as BTN-only", () => {
    const schedule = source("src/app/(app)/schedule/_components/CollaboratorSchedule.tsx");
    const users = source("src/app/(app)/users/page.tsx");

    expect(schedule).toContain('description="Upcoming events and crew assignments."');
    expect(schedule).not.toContain("Big Ten Network events");
    expect(users).toContain('label="Collaborators"');
    expect(users).not.toContain('label="BTN collaborators"');
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
