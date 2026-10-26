import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("event crew setup recovery", () => {
  it("lets Event detail set up a crew in place with the same Home/Away/empty choices", () => {
    const page = readFileSync("src/app/(app)/events/[id]/page.tsx", "utf8");
    const header = readFileSync("src/app/(app)/events/[id]/_components/EventHeader.tsx", "utf8");
    const schedule = readFileSync("src/app/(app)/schedule/page.tsx", "utf8");
    const sheet = readFileSync("src/app/(app)/schedule/_components/ScheduleCrewSheet.tsx", "utf8");

    expect(schedule).toContain("/api/shift-groups");
    expect(sheet).toContain("export function CrewSetupChoices");
    expect(page).toContain("<CrewSetupChoices");
    expect(page).toContain("/api/shift-groups");
    expect(page).toContain("onEditStudentCall=");
    expect(header).toContain("Edit Student call time");
    expect(page).not.toContain("Use the Schedule event menu to choose a crew template.");
  });

  it("keeps the shift-group request additive for older clients", () => {
    const route = readFileSync("src/app/api/shift-groups/route.ts", "utf8");

    expect(route).toContain('requestedTemplate === undefined ? "EMPTY"');
    expect(route).toContain("Prisma.TransactionIsolationLevel.Serializable");
    expect(route).toContain("createAuditEntryTx(tx");
    expect(route).toContain("templateManaged: true");
  });
});
