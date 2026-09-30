import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

// Web and iOS pick the Home banner independently; these pins keep the two
// implementations on one order and one set of words.
describe("Home agenda web/iOS parity", () => {
  const web = source("src/lib/home-agenda.ts");
  const ios = source("ios/Wisconsin/Views/HomeAgenda.swift");
  const home = source("ios/Wisconsin/Views/HomeView.swift");

  it("checks banner kinds in the same order", () => {
    const order = (text: string, needles: string[]) => needles.map((n) => text.indexOf(n));
    const webOrder = order(web, ['kind: "overdue"', 'kind: "pickup"', 'kind: "prep-gear"', 'kind: "due-today"']);
    const iosOrder = order(ios, ["kind: .overdue", "kind: .pickup", "kind: .prepGear", "kind: .dueToday"]);
    for (const positions of [webOrder, iosOrder]) {
      expect(positions.every((p) => p >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
  });

  it("uses the same dismissal keys and copy", () => {
    for (const key of ["overdue:", "pickup:", "prep-gear:", "due-today:"]) {
      expect(web).toContain(key);
      expect(ios).toContain(key);
    }
    for (const copy of ["checkouts are overdue", "Your gear is ready for pickup", "Pickup was due at", "No gear reserved for", "Was due "]) {
      expect(web).toContain(copy);
      expect(ios).toContain(copy);
    }
  });

  it("only names a call time for Student assignments on both platforms", () => {
    expect(web).toContain('work.shift.workerType === "ST"');
    expect(ios).toContain('work.shift.workerType == "ST"');
  });

  it("places the banner above the greeting and the week strip above Next Up on iOS", () => {
    expect(home.indexOf("HomeContextBanner(")).toBeLessThan(home.indexOf("DashboardHero("));
    expect(home.indexOf("HomeWeekStrip(")).toBeLessThan(home.indexOf("HomeActionQueue.hasActions(in: dash"));
  });
});
