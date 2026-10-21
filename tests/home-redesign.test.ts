import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";
import { buildAttention, buildSummary, buildUpNext, greeting } from "@/app/(app)/_home/home-model";
import { emptyDashboard, sampleDashboard, sampleStats, sampleTrades } from "@/app/(app)/_home/home-fixtures";

const NOW = new Date("2026-10-21T13:00:00");

describe("Home view model", () => {
  it("greets by first name and time of day", () => {
    expect(greeting(new Date("2026-10-21T08:00:00"), "Erik Role")).toBe("Good morning, Erik");
    expect(greeting(new Date("2026-10-21T14:00:00"), "Erik Role")).toBe("Good afternoon, Erik");
    expect(greeting(new Date("2026-10-21T20:00:00"), null)).toBe("Good evening");
  });

  it("gives students their own counts and staff the team's", () => {
    const student = buildSummary({ role: "STUDENT", data: sampleDashboard("STUDENT", NOW), stats: null, openTradeCount: 2 });
    expect(student.map((m) => m.label)).toEqual(["Gear out", "Due today", "Upcoming shifts", "Open trades"]);
    expect(student[0]).toMatchObject({ value: 3, tone: "critical" });
    expect(student[3]?.value).toBe(2);

    const staff = buildSummary({ role: "STAFF", data: sampleDashboard("STAFF", NOW), stats: null, openTradeCount: null });
    expect(staff.map((m) => m.label)).toEqual(["Overdue", "Due today", "Pending pickup", "Checked out"]);
    expect(staff[0]).toMatchObject({ value: 1, tone: "critical" });
  });

  it("paints first from cached stats and shows unknown counts as unknown, never zero", () => {
    const fast = buildSummary({ role: "ADMIN", data: null, stats: sampleStats("ADMIN"), openTradeCount: null });
    expect(fast.find((m) => m.id === "pending-pickup")?.value).toBe(1);
    const cold = buildSummary({ role: "STUDENT", data: null, stats: null, openTradeCount: null });
    expect(cold.every((m) => m.value === null)).toBe(true);
  });

  it("keeps students to their own work and orders by urgency", () => {
    const items = buildAttention({ role: "STUDENT", data: sampleDashboard("STUDENT", NOW), claimedTrades: [], now: NOW });
    expect(items[0]).toMatchObject({ tone: "critical", title: "Return Soccer at Iowa" });
    expect(items.some((i) => i.icon === "pickup" || i.icon === "damage" || i.icon === "draft")).toBe(false);
    expect(items.some((i) => i.icon === "gear" && i.target.kind === "create")).toBe(true);
    const tones = items.map((i) => i.tone);
    expect([...tones].sort((a, b) => ["critical", "warning", "info", "neutral"].indexOf(a) - ["critical", "warning", "info", "neutral"].indexOf(b))).toEqual(tones);
  });

  it("puts team custody, damage review and drafts in front of staff", () => {
    const items = buildAttention({ role: "STAFF", data: sampleDashboard("STAFF", NOW), claimedTrades: sampleTrades(NOW).claimed, now: NOW });
    const icons = items.map((i) => i.icon);
    expect(icons).toContain("overdue");
    expect(icons).toContain("pickup");
    expect(icons).toContain("damage");
    expect(icons).toContain("draft");
    // Trade approval and lost-unit review belong to admins.
    expect(icons).not.toContain("trade");
    expect(icons).not.toContain("lost");
    expect(items.find((i) => i.icon === "damage")?.target).toEqual({ kind: "report", reportId: "f-1" });
  });

  it("asks admins to approve claimed trades", () => {
    const items = buildAttention({ role: "ADMIN", data: sampleDashboard("ADMIN", NOW), claimedTrades: sampleTrades(NOW).claimed, now: NOW });
    const trade = items.find((i) => i.icon === "trade");
    expect(trade?.title).toContain("Approve trade");
    expect(trade?.detail).toContain("Sam Okafor to Maya Chen");
    expect(trade?.target).toEqual({ kind: "link", href: "/schedule?queue=trade-approval" });
    expect(items.some((i) => i.icon === "lost")).toBe(true);
  });

  it("is empty when nothing is owed", () => {
    expect(buildAttention({ role: "ADMIN", data: emptyDashboard("ADMIN"), claimedTrades: [], now: NOW })).toEqual([]);
  });

  it("names a call time only for Student shifts", () => {
    const student = buildUpNext(sampleDashboard("STUDENT", NOW), NOW).find((r) => r.id === "shift-s-1");
    expect(student?.detail).toContain("Call ");
    const staff = buildUpNext(sampleDashboard("STAFF", NOW), NOW).find((r) => r.id === "shift-s-1");
    expect(staff?.detail).not.toContain("Call");
  });

  it("orders Up next by time", () => {
    const rows = buildUpNext(sampleDashboard("STUDENT", NOW), NOW);
    const times = rows.map((r) => new Date(r.startsAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe("Home page contracts", () => {
  const page = source("src/app/(app)/page.tsx");
  const home = source("src/app/(app)/_home/HomePage.tsx");
  const view = source("src/app/(app)/_home/HomeView.tsx");

  it("renders inside the shared wc-fresh theme with Lato", () => {
    expect(page).toContain("wc-fresh ${lato.variable}");
    expect(page).toContain("<HomeTheme");
  });

  it("names the refresh action and keeps header actions at 40px", () => {
    expect(view).toContain('aria-label="Refresh home"');
    expect(view).toContain('className="size-10"');
    expect(view).toContain('<Button asChild className="h-10 bg-[var(--btn-primary-bg)]');
  });

  it("never offers New reservation to students or read-only previews", () => {
    expect(home).toContain("canReserve={team && !readOnly}");
  });

  it("gives each section its own loading, error and empty state", () => {
    for (const what of ["what needs attention", "your schedule", "your gear", "trades", "events", "team gear"]) {
      expect(view).toContain(`<SectionError what="${what}"`);
    }
    expect(view).toContain("You’re all caught up");
    expect(view).toContain("export function HomeSkeleton");
  });

  it("fails trade reads on their own instead of failing the page", () => {
    expect(home).toContain('useTrades("OPEN", role === "STUDENT")');
    expect(home).toContain('useTrades("CLAIMED", role === "ADMIN")');
    expect(home).toContain("claimedTrades: claimedTrades.data ?? []");
  });

  it("deep-links the Trade Board", () => {
    expect(source("src/hooks/use-schedule-data.ts")).toContain('useState(() => searchParams.get("trades") === "open")');
  });
});

describe("Home day line and crew", () => {
  it("says what today holds in one line", async () => {
    const { daySummary } = await import("@/app/(app)/_home/home-model");
    const line = daySummary("STUDENT", sampleDashboard("STUDENT", NOW), NOW);
    expect(line).toMatch(/^You’re on .+ at \d/);
    expect(line).toContain("Your gear: 1 overdue, 1 due back today.");
    expect(daySummary("STAFF", sampleDashboard("STAFF", NOW), NOW)).toContain("Team gear: 1 overdue, 3 due back today.");
    expect(daySummary("ADMIN", emptyDashboard("ADMIN"), NOW)).toBe("Nothing due today. You’re clear.");
  });

  it("lists today's crewed events and leaves tomorrow out", async () => {
    const { crewRows } = await import("@/app/(app)/_home/home-model");
    const { sampleCrew } = await import("@/app/(app)/_home/home-fixtures");
    const rows = crewRows(sampleCrew(NOW));
    expect(rows.map((r) => r.id)).toEqual(["g-mhk", "g-vb"]);
    expect(rows[0]?.live).toBe(true);
    expect(rows[0]?.when).toContain("On now");
  });
});

describe("Home trade decisions", () => {
  it("offers Approve on admin trade rows and Claim only where the board allows it", async () => {
    const { tradeRows } = await import("@/app/(app)/_home/home-model");
    const admin = buildAttention({ role: "ADMIN", data: emptyDashboard("ADMIN"), claimedTrades: sampleTrades(NOW).claimed, now: NOW });
    expect(admin[0]?.quick).toMatchObject({ action: "approve", tradeId: "t-9", label: "Approve" });
    expect(admin[0]?.quick?.confirmMessage).toContain("Maya Chen takes Sam Okafor");

    const rows = tradeRows(sampleTrades(NOW).open, NOW);
    expect(rows.find((r) => r.id === "t-1")?.quick).toMatchObject({ action: "claim", confirmLabel: "Claim shift" });
    expect(rows.find((r) => r.id === "t-3")?.quick).toBeUndefined();
  });

  it("sends decisions through the Trade Board endpoints and reloads after every outcome", () => {
    const actions = source("src/lib/shift-trade-actions.ts");
    const home = source("src/app/(app)/_home/HomePage.tsx");
    expect(actions).toContain("claim: \"POST\"");
    expect(actions).toContain("approve: \"PATCH\"");
    expect(actions).toContain("/api/shift-trades/${tradeId}/${action}");
    expect(home).toContain("const ok = await confirm({ title: quick.confirmTitle");
    expect(home).toContain("await Promise.all([openTrades.refetch(), claimedTrades.refetch()]);");
    // Read-only admin previews never get the buttons.
    expect(home).toContain("onQuick={readOnly ? undefined");
  });
});
