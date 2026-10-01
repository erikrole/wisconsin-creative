import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const listView = source("src/app/(app)/schedule/_components/ListView.tsx");

describe("Schedule list row grid", () => {
  it("renders every desktop row, header, and skeleton through the one-cell-per-column EventGrid", () => {
    const columns = /const EVENT_COLUMNS = \[([^\]]+)\] as const/.exec(listView)?.[1] ?? "";
    const tracks = /const EVENT_GRID_CLASS = "grid-cols-\[([^\]]+)\]"/.exec(listView)?.[1] ?? "";
    expect(columns.split(",").length).toBe(tracks.split("_").length);

    // A bare grid with EVENT_GRID_CLASS would let a conditional child slide later cells left.
    expect(listView.match(/EVENT_GRID_CLASS/g)).toHaveLength(2);
    expect(listView.match(/<EventGrid\b/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("requires a value for every column so a row cannot drop one", () => {
    expect(listView).toContain("cells: Record<EventColumn, ReactNode>");
    expect(listView).toContain("EVENT_COLUMNS.map((column)");
  });
});
