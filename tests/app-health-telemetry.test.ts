import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { parseDiagnosticPayload } from "@/lib/services/app-diagnostics";
import { latenessBucket } from "@/lib/services/job-runs";

describe("app diagnostics", () => {
  it("turns a MetricKit payload into one row per diagnostic with a grouping signature", () => {
    const rows = parseDiagnosticPayload({
      timeStampBegin: "2026-09-23 00:00:00",
      crashDiagnostics: [{
        diagnosticMetaData: { appVersion: "1.0.9", osVersion: "iPhone OS 27.0", exceptionType: 1, signal: 11 },
        callStackTree: { callStacks: [] },
      }],
      hangDiagnostics: [{ diagnosticMetaData: { appVersion: "1.0.9", hangDuration: "2.1 sec" } }],
    });

    expect(rows).toEqual([
      expect.objectContaining({ kind: "crash", appVersion: "1.0.9", signature: "1 · 11", callStack: { callStacks: [] } }),
      expect.objectContaining({ kind: "hang", signature: "hang 2.1 sec", callStack: undefined }),
    ]);
  });

  it("drops an oversized call stack instead of storing a cut one", () => {
    const huge = { frames: "x".repeat(250_000) };
    const [row] = parseDiagnosticPayload({ crashDiagnostics: [{ diagnosticMetaData: {}, callStackTree: huge }] });
    expect(row?.callStack).toBeUndefined();
  });

  it("caps the rows accepted from one upload", () => {
    const many = Array.from({ length: 50 }, () => ({ diagnosticMetaData: {} }));
    expect(parseDiagnosticPayload({ hangDiagnostics: many })).toHaveLength(20);
  });
});

describe("job run lateness", () => {
  const due = new Date("2026-09-23T08:00:00.000Z");
  it.each([
    [30_000, "on_time"],
    [3 * 60_000, "under_5m"],
    [20 * 60_000, "5_60m"],
    [2 * 60 * 60_000, "over_1h"],
  ])("buckets %i ms late as %s", (late, bucket) => {
    expect(latenessBucket(due, new Date(due.getTime() + late))).toBe(bucket);
  });
});
