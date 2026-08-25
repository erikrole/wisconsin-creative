import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("collaborator reservation entry contract", () => {
  it("shows the Home reservation action only for the creation capability", () => {
    const dashboard = source("src/app/(app)/dashboard/collaborator-home.tsx");
    const headerStart = dashboard.indexOf("<PageHeader");
    const headerEnd = dashboard.indexOf("</PageHeader>", headerStart);

    expect(headerStart).toBeGreaterThanOrEqual(0);
    expect(headerEnd).toBeGreaterThan(headerStart);

    const header = dashboard.slice(headerStart, headerEnd);
    expect(dashboard).toContain("const canCreateReservation = !readOnly && capabilities.includes(\"RESERVATION_CREATE\");");
    expect(header).toContain("{canCreateReservation &&");
    expect(header).toContain('href="/reservations/new"');
    expect(header).toContain("New reservation");
  });

  it("keeps the reservation wizard route capability-gated in the shell", () => {
    const appShell = source("src/components/AppShell.tsx");
    const routeIndex = appShell.indexOf('value === "/reservations/new"');

    expect(routeIndex).toBeGreaterThanOrEqual(0);
    expect(appShell.slice(routeIndex, routeIndex + 180)).toContain('capability: "RESERVATION_CREATE"');
  });
});
