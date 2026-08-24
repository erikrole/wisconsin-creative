import { describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { canReadSharedScoreboard } from "@/lib/user-visibility";

const actor = (role: Role, id = "viewer") => ({
  id,
  email: `${id}@example.com`,
  role,
});

describe("shared Scoreboard visibility", () => {
  it.each([Role.ADMIN, Role.STAFF, Role.STUDENT, Role.COLLABORATOR])(
    "lets %s read an active visible person's Scoreboard",
    (role) => {
      expect(canReadSharedScoreboard(actor(role), {
        id: "subject",
        active: true,
        hiddenFromRoster: false,
      })).toBe(true);
    },
  );

  it("keeps hidden and inactive people out of general cross-user discovery", () => {
    expect(canReadSharedScoreboard(actor(Role.STUDENT), {
      id: "hidden",
      active: true,
      hiddenFromRoster: true,
    })).toBe(false);
    expect(canReadSharedScoreboard(actor(Role.COLLABORATOR), {
      id: "inactive",
      active: false,
      hiddenFromRoster: false,
    })).toBe(false);
  });

  it("preserves self and internal operational access for inactive records", () => {
    const inactive = { id: "inactive", active: false, hiddenFromRoster: false };

    expect(canReadSharedScoreboard(actor(Role.STUDENT, "inactive"), inactive)).toBe(true);
    expect(canReadSharedScoreboard(actor(Role.STAFF), inactive)).toBe(true);
    expect(canReadSharedScoreboard(actor(Role.ADMIN), inactive)).toBe(true);
  });
});
