import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { auditLog: { findMany: vi.fn() } },
}));

import { db } from "@/lib/db";
import { readLastNudges } from "@/lib/services/nudge-history";
import { source } from "./_helpers/source";

const findMany = db.auditLog.findMany as unknown as ReturnType<typeof vi.fn>;

describe("readLastNudges", () => {
  beforeEach(() => findMany.mockReset());

  it("skips the query when there are no bookings", async () => {
    expect((await readLastNudges([])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("keeps the newest nudge per booking and tolerates a deleted actor", async () => {
    findMany.mockResolvedValue([
      { entityId: "b1", createdAt: new Date("2026-09-25T15:00:00Z"), actor: { name: "Erik Role" } },
      { entityId: "b2", createdAt: new Date("2026-09-25T14:00:00Z"), actor: null },
      { entityId: "b1", createdAt: new Date("2026-09-25T12:00:00Z"), actor: { name: "Someone Else" } },
    ]);

    const result = await readLastNudges(["b1", "b2", "b3"]);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { entityType: "booking", entityId: { in: ["b1", "b2", "b3"] }, action: "overdue_nudge_sent" },
      orderBy: { createdAt: "desc" },
    }));
    expect(result.get("b1")).toEqual({ at: "2026-09-25T15:00:00.000Z", byName: "Erik Role" });
    expect(result.get("b2")).toEqual({ at: "2026-09-25T14:00:00.000Z", byName: null });
    expect(result.has("b3")).toBe(false);
  });

  it("matches the action the nudge route audits", () => {
    expect(source("src/app/api/bookings/[id]/nudge/route.ts")).toContain('action: "overdue_nudge_sent"');
  });
});

describe("nudge history wiring", () => {
  const dashboard = source("src/app/api/dashboard/route.ts");
  const detail = source("src/app/api/bookings/[id]/route.ts");
  const banner = source("src/app/(app)/dashboard/overdue-banner.tsx");
  const iosDetail = source("ios/Wisconsin/Views/BookingDetailView.swift");
  const iosModels = source("ios/Wisconsin/Models/Models.swift");

  it("reads history only for staff on the dashboard and only for nudgers on detail", () => {
    expect(dashboard).toContain('if (user.role === "STAFF" || user.role === "ADMIN") {');
    expect(dashboard).toContain("lastNudge: lastNudges.get(b.id) ?? null");
    expect(detail).toContain('allowedActions.includes("nudge")');
  });

  it("hides Nudge on shared checkouts and shows a colleague's recent nudge as sent", () => {
    expect(dashboard).toContain('isShared: b.custodyScope === "SHARED"');
    expect(banner).toContain("canAction && !item.isShared");
    expect(banner).toContain("< NUDGE_REPEAT_WINDOW");
  });

  it("decodes lastNudge on iOS and starts in the sent state inside the window", () => {
    expect(iosModels).toContain("var lastNudge: BookingLastNudge? = nil");
    expect(iosDetail).toContain("if nudgeState == .idle, loaded.lastNudge?.isRecent() == true {");
  });
});
