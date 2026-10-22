import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("collaborator reservation entry contract", () => {
  it("shows the Home reservation action only for the creation capability", () => {
    const dashboard = source("src/app/(app)/_home/HomePage.tsx");
    const view = source("src/app/(app)/_home/HomeView.tsx");
    const headerStart = view.indexOf("function HomeHeader");
    const header = view.slice(headerStart, view.indexOf("/* ── Building blocks", headerStart));

    expect(dashboard).toContain("const canCreateReservation = !readOnly && capabilities.includes(\"RESERVATION_CREATE\");");
    expect(dashboard).toContain("canReserve={canCreateReservation}");
    expect(header).toContain("{canReserve && (");
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
