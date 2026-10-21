import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { parseMetricKitPayload } from "@/lib/error-reporting/metrickit";
import { latenessBucket } from "@/lib/services/job-runs";

describe("MetricKit diagnostics", () => {
  it("turns a MetricKit payload into one report per diagnostic with readable names", () => {
    const reports = parseMetricKitPayload({
      timeStampEnd: "2026-09-23 00:00:00",
      crashDiagnostics: [{
        diagnosticMetaData: {
          appVersion: "1.0.9",
          appBuildVersion: "31",
          isTestFlightApp: true,
          osVersion: "iPhone OS 27.0",
          deviceType: "iPhone17,1",
          bundleIdentifier: "com.erikrole.Wisconsin.LiveActivities",
          exceptionType: 10,
          signal: 6,
          terminationReason: "Namespace SIGNAL, Code 0x6",
        },
        callStackTree: { callStacks: [] },
      }],
      hangDiagnostics: [{ diagnosticMetaData: { appVersion: "1.0.9", hangDuration: "2.1 sec" } }],
    });

    expect(reports).toEqual([
      expect.objectContaining({
        kind: "crash",
        name: "SIGABRT (EXC_CRASH)",
        message: "in LiveActivities · Namespace SIGNAL, Code 0x6",
        appVersion: "1.0.9",
        appBuild: "31",
        releaseChannel: "testflight",
        deviceModel: "iPhone17,1",
        callStack: { callStacks: [] },
      }),
      expect.objectContaining({ kind: "hang", name: "Hang", message: "2.1 sec", callStack: undefined }),
    ]);
  });

  it("keeps the crashing thread's frames for symbolication", () => {
    const [report] = parseMetricKitPayload({
      crashDiagnostics: [{
        diagnosticMetaData: { signal: 11, exceptionType: 1 },
        callStackTree: {
          callStacks: [
            { threadAttributed: false, callStackRootFrames: [{ binaryName: "libdispatch.dylib", offsetIntoBinaryTextSegment: 1 }] },
            {
              threadAttributed: true,
              callStackRootFrames: [{
                binaryName: "libswiftCore.dylib",
                offsetIntoBinaryTextSegment: 100,
                address: 7000,
                subFrames: [{ binaryName: "Wisconsin", binaryUUID: "ABC", offsetIntoBinaryTextSegment: 4242, address: 9000 }],
              }],
            },
          ],
        },
      }],
    });
    expect(report?.culprit).toBe("Wisconsin");
    expect(report?.screen).toBe("Wisconsin +4242");
    expect(report?.stack).toBe("0 libswiftCore.dylib offset 100\n1 Wisconsin offset 4242 (ABC)");
  });

  it("drops an oversized call stack instead of storing a cut one", () => {
    const huge = { frames: "x".repeat(250_000) };
    const [report] = parseMetricKitPayload({ crashDiagnostics: [{ diagnosticMetaData: {}, callStackTree: huge }] });
    expect(report?.callStack).toBeUndefined();
  });

  it("caps the reports accepted from one upload", () => {
    const many = Array.from({ length: 50 }, () => ({ diagnosticMetaData: {} }));
    expect(parseMetricKitPayload({ hangDiagnostics: many })).toHaveLength(20);
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
