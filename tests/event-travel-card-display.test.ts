import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("event travel card display", () => {
  it("uses product role labels instead of raw user role enums", () => {
    const source = readFileSync("src/app/(app)/events/[id]/_components/EventTravelCard.tsx", "utf8");

    expect(source).toContain("USER_ROLE_LABELS");
    expect(source).toContain('ADMIN: "Admin"');
    expect(source).toContain('STAFF: "Staff"');
    expect(source).toContain('STUDENT: "Student"');
    expect(source).toContain("{userRoleLabel(entry.user.role)}");
    expect(source).toContain("{userRoleLabel(m.user.role)}");
    expect(source).not.toContain("{entry.user.role}");
    expect(source).not.toContain("{m.user.role}");
  });

  it("names repeated travel roster actions by person", () => {
    const source = readFileSync("src/app/(app)/events/[id]/_components/EventTravelCard.tsx", "utf8");

    expect(source).toContain("`Remove ${entry.user.name} as default traveler`");
    expect(source).toContain("`Mark ${entry.user.name} as default traveler`");
    expect(source).toContain("aria-label={`Add ${entry.user.name} to travel roster`}");
    expect(source).toContain("aria-label={`Remove ${m.user.name} from travel roster`}");
    expect(source).not.toContain('aria-label="Remove from travel roster"');
  });

  it("shows a retryable roster-load failure before the empty roster state", () => {
    const source = readFileSync("src/app/(app)/events/[id]/_components/EventTravelCard.tsx", "utf8");

    expect(source).toContain("error: rosterError");
    expect(source).toContain("reload: reloadRoster");
    expect(source.indexOf("if (rosterError)")).toBeGreaterThan(source.indexOf("if (loading)"));
    expect(source.indexOf("const eligible = sorted.filter")).toBeGreaterThan(source.indexOf("if (rosterError)"));
    expect(source).toContain("Failed to load roster");
    expect(source).toContain("Sport roster members could not load, so travelers cannot be added yet.");
    expect(source).toContain("onClick={reloadRoster}");
    expect(source).toContain("Retry roster");
    expect(source).toContain("All sport roster members are already on the travel roster.");
  });

  it("lets staff add the sport's default travelers in one step", () => {
    const source = readFileSync("src/app/(app)/events/[id]/_components/EventTravelCard.tsx", "utf8");

    expect(source).toContain("`/api/calendar-events/${eventId}/travel/defaults`");
    expect(source).toContain("addingDefaultsRef.current");
    expect(source).toContain("setLocalMembers(json.data)");
    expect(source).toContain('"Add defaults"');
    expect(source).toContain("No default travelers are set for this sport.");
    expect(source.indexOf("onClick={handleAddDefaults}")).toBeGreaterThan(source.indexOf("{isStaff && ("));
  });
});
