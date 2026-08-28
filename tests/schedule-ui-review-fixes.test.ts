import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

const filters = source("src/app/(app)/schedule/_components/ScheduleFilters.tsx");
const readiness = source("src/app/(app)/schedule/_components/ScheduleReadiness.tsx");
const calendar = source("src/app/(app)/schedule/_components/CalendarView.tsx");
const list = source("src/app/(app)/schedule/_components/ListView.tsx");
const week = source("src/app/(app)/schedule/_components/WeekView.tsx");
const page = source("src/app/(app)/schedule/page.tsx");

describe("schedule browse fixes", () => {
  it("keeps every sport reachable while a sport filter is applied", () => {
    // Sport is applied server-side, so the loaded window only contains the
    // selected sport. Deriving the options from it offered the reader nothing
    // but the sport they were already on.
    expect(filters).toContain("if (filters.sportFilter) {");
    expect(filters).toContain("return SPORT_CODES.map((s) => ({ value: s.code, label: s.label }));");
    expect(filters).toContain("}, [entries, filters.sportFilter]);");
  });

  it("sizes the shareable queue banner from the rows it actually matched", () => {
    expect(filters).toContain("filteredEntries: CalendarEntry[];");
    expect(filters).toContain("events in this shareable queue.");
    expect(page).toContain("filteredEntries={data.filteredEntries}");
  });

  it("leads the readiness rail with exceptions rather than activity counters", () => {
    // The rail is what shows without expanding the readiness block, and it
    // sorts by tone and caps at three. Activity-only rail items buried open
    // crew slots, conflicts, and pending requests one panel below the fold.
    expect(readiness).toContain("const railItems: OperationalStatusRailItem[] = [\n    ...attentionItems,");
    expect(readiness).toContain("...(personalItem ? [personalItem] : []),\n    ...activityItems,");
    // A zero-value counter no longer spends a rail slot.
    expect(readiness).toContain("activityLabels.has(item.label) && isActionableValue(item.value)");
  });

  it("scopes control-room readiness metrics to staff", () => {
    // The health snapshot behind these is staff/admin-only, so for a student
    // each card read zero and still routed into a staff queue.
    expect(readiness).toContain("const items: ReadinessItem[] = isStaff");
    expect(readiness).toContain("? [...staffItems, ...sharedItems, ...staffQueueItems, ...tradeItems]");
    expect(readiness).toContain(": [...sharedItems, ...tradeItems];");
    // Every queue route stays defined; only the audience changes.
    for (const queue of ["needs-staffing", "gear-gaps", "data-quality", "my-calls-today"]) {
      expect(readiness).toContain(`"${queue}"`);
    }
  });

  it("does not repeat the view's own empty state above it", () => {
    expect(readiness).not.toContain("Filters hide every event");
    expect(readiness).not.toContain("notice={");
  });

  it("ends the calendar month on a complete week row", () => {
    expect(calendar).toContain("while (cells.length % 7 !== 0) cells.push({ day: null });");
  });

  it("drops the expanded calendar day when the month changes", () => {
    // The expanded cell is tracked by day-of-month, which means nothing in a
    // different month.
    expect(calendar).toContain("function goToMonth(next: Date) {");
    expect(calendar).toContain("setExpandedDay(null);");
    expect(calendar).not.toContain("function prevMonth() {\n    setCalMonth(");
  });

  it("aligns the list column headers with the rows they name", () => {
    // Body rows carry a 3px venue rail on the <tr>; the header needs the same
    // reserve or every label sits 3px left of its column.
    expect(list).toContain("border-b border-l-[3px] border-border/50 border-l-transparent");
  });

  it("does not put an inert control in the mobile tab order", () => {
    expect(list).toContain("{canExpand ? (");
    expect(list).toContain("onClick={() => toggleExpandedRow(entry.id)}");
    expect(list).toContain('<div className="w-full px-4 py-3 pr-14 text-left">');
    expect(list).not.toContain("canExpand\n                        ? toggleExpandedRow(entry.id)");
  });

  it("only clears the expanded-row pointer for the row that owns it", () => {
    expect(list).toContain("if (expandedRowId === entryId) setExpandedRowId(null);");
    expect(list).toContain("}, [expandedRowId, expandedRowIds, setExpandedRowId]);");
  });

  it("dates both halves of a week that crosses New Year", () => {
    expect(week).toContain("weekStart.getFullYear() !== end.getFullYear()");
  });
});
