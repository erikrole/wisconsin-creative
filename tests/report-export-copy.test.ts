import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildReportCsv,
  escapeReportCsvValue,
  formatReportExportSuccess,
  getReportExportCompletionToast,
  getReportExportFilename,
  reportExportFilename,
  reportLabelFromFilenameBase,
  readReportExportFailureMessage,
} from "@/app/(app)/reports/report-export";

describe("report export helpers", () => {
  it.each(["  =SUM(A1:A2)", "\n@SUM(A1)", " \t+1"])("escapes whitespace-prefixed report formula %j", (value) => {
    expect(escapeReportCsvValue(value)).toBe(`"'${value}"`);
  });

  it("warns about incomplete report downloads even without a total", () => {
    expect(getReportExportCompletionToast({ reportLabel: "Audit", rowCount: 5000, truncated: true }).variant).toBe("warning");
  });

  it.each(["null", "[]", "42", '"private failure"'])("uses fallback copy for non-object JSON %s", async (body) => {
    expect(await readReportExportFailureMessage(new Response(body, { status: 502 }), "Audit")).toBe("Audit CSV export failed (502).");
  });

  it("builds formula-safe CSV output", () => {
    expect(buildReportCsv([
      ["Name", "Formula"],
      ["Camera", "=SUM(A1:A2)"],
    ])).toBe("\"Name\",\"Formula\"\n\"Camera\",\"'=SUM(A1:A2)\"\n");
  });

  it("creates dated report filenames", () => {
    expect(reportExportFilename("scan-report", new Date("2026-06-02T12:00:00.000Z")))
      .toBe("scan-report-2026-06-02.csv");
  });

  it("formats report labels from filename bases", () => {
    expect(reportLabelFromFilenameBase("audit-report")).toBe("Audit");
    expect(reportLabelFromFilenameBase("bulk-losses-report")).toBe("Bulk Losses");
  });

  it("names the exported scope in success copy", () => {
    expect(formatReportExportSuccess({
      reportLabel: "Audit",
      rowCount: 25,
      scopeLabel: "visible audit entries",
    })).toBe("Audit CSV downloaded: 25 visible audit entries.");
  });

  it("parses server-provided report export filenames", () => {
    expect(getReportExportFilename(
      "attachment; filename=\"audit-report-2026-06-02.csv\"",
      "fallback.csv",
    )).toBe("audit-report-2026-06-02.csv");

    expect(getReportExportFilename(
      "attachment; filename*=UTF-8''audit%20report.csv",
      "fallback.csv",
    )).toBe("audit report.csv");
  });

  it("names capped full-export completion copy", () => {
    expect(getReportExportCompletionToast({
      reportLabel: "Audit",
      rowCount: 5000,
      scopeLabel: "matching audit entries",
      total: "7123",
      truncated: true,
    })).toEqual({
      variant: "warning",
      message: "Audit CSV capped at 5,000 matching audit entries; 7123 total. Narrow filters to export fewer rows.",
    });
  });

  it("reads JSON and text failure copy for server-backed report exports", async () => {
    expect(await readReportExportFailureMessage(
      new Response(JSON.stringify({ error: "Invalid startDate" }), { status: 400 }),
      "Audit",
    )).toBe("Audit CSV export failed: Invalid startDate");

    expect(await readReportExportFailureMessage(
      new Response("Gateway timeout", { status: 504 }),
      "Audit",
    )).toBe("Audit CSV export failed: Gateway timeout");
  });

  it("keeps the shared report export button guarded and visibly scoped", () => {
    const source = readFileSync("src/app/(app)/reports/report-ui.tsx", "utf8");

    expect(source).toContain("const busyRef = useRef(false)");
    expect(source).toContain('label = "Export visible rows"');
    expect(source).toContain("if (disabled || busyRef.current) return;");
    expect(source).toContain("await onClick()");
    expect(source).toContain('aria-label={ariaLabel ?? label}');
  });

  it("uses the server-backed export path on the Audit report", () => {
    const source = readFileSync("src/app/(app)/reports/audit/page.tsx", "utf8");

    expect(source).toContain('params.set("format", "csv")');
    expect(source).toContain('ariaLabel="Export matching audit entries CSV"');
    expect(source).toContain('label="Export matching rows"');
    expect(source).toContain("readReportExportFailureMessage");
  });

  it("uses the server-backed export path on the Scans report", () => {
    const source = readFileSync("src/app/(app)/reports/scans/page.tsx", "utf8");

    expect(source).toContain('params.set("format", "csv")');
    expect(source).toContain('ariaLabel="Export matching scan events CSV"');
    expect(source).toContain('label="Export matching rows"');
    expect(source).toContain("readReportExportFailureMessage");
  });

  it("uses the server-backed export path on the Checkouts report", () => {
    const source = readFileSync("src/app/(app)/reports/checkouts/page.tsx", "utf8");

    expect(source).toContain('params.set("format", "csv")');
    expect(source).toContain('ariaLabel="Export matching checkout rows CSV"');
    expect(source).toContain('label="Export matching rows"');
    expect(source).toContain("readReportExportFailureMessage");
  });

  it("uses the server-backed export path on the Overdue report", () => {
    const source = readFileSync("src/app/(app)/reports/overdue/page.tsx", "utf8");

    expect(source).toContain("/api/reports/overdue?format=csv");
    expect(source).toContain('ariaLabel="Export matching overdue booking rows CSV"');
    expect(source).toContain('label="Export matching rows"');
    expect(source).toContain("readReportExportFailureMessage");
  });

  it("uses the server-backed export path on the Missing Units report", () => {
    const source = readFileSync("src/app/(app)/reports/bulk-losses/page.tsx", "utf8");

    expect(source).toContain("fetch(`/api/reports/bulk-losses?format=csv${query}`)");
    expect(source).toContain('ariaLabel="Export matching missing-unit evidence CSV"');
    expect(source).toContain('label="Export matching rows"');
    expect(source).toContain("readReportExportFailureMessage");
  });

  it("uses the server-backed export path on the Utilization report", () => {
    const source = readFileSync("src/app/(app)/reports/utilization/page.tsx", "utf8");

    expect(source).toContain("fetch(`/api/reports/utilization?format=csv&days=${days}`)");
    expect(source).toContain('ariaLabel="Export utilization inventory rows CSV"');
    expect(source).toContain('label="Export inventory rows"');
    expect(source).toContain("readReportExportFailureMessage");
  });
});
