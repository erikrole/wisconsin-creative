import { afterEach, describe, expect, it, vi } from "vitest";
import { escapeReportCsvValue, getReportExportCompletionToast, readReportExportFailureMessage } from "@/app/(app)/reports/report-export";
import { getExportCompletionToast, readExportFailureMessage } from "@/app/(app)/settings/data-export/export-download";
import { saveRecentEntity, getRecentEntities, RECENT_STORAGE_KEY } from "@/lib/breadcrumbs";
import { syncUrl } from "@/lib/url-sync";

afterEach(() => vi.unstubAllGlobals());

describe("batch 15 recovery regressions", () => {
  it.each(["  =SUM(A1:A2)", "\n@SUM(A1)", " \t+1"])("escapes whitespace-prefixed report formula %j", (value) => {
    expect(escapeReportCsvValue(value)).toBe(`"'${value}"`);
  });
  it("warns about incomplete settings downloads even without a total", () => {
    expect(getExportCompletionToast("Users", true, null).variant).toBe("warning");
  });
  it("warns about incomplete report downloads even without a total", () => {
    expect(getReportExportCompletionToast({ reportLabel: "Audit", rowCount: 5000, truncated: true }).variant).toBe("warning");
  });
  it.each(["null", "[]", "42", '"private failure"'])("uses fallback copy for non-object JSON %s", async (body) => {
    expect(await readExportFailureMessage(new Response(body, { status: 502 }), "Users")).toBe("Users export failed (502).");
    expect(await readReportExportFailureMessage(new Response(body, { status: 502 }), "Audit")).toBe("Audit CSV export failed (502).");
  });
  function storage(value: string | null = null) {
    const store = new Map<string, string>();
    if (value !== null) store.set(RECENT_STORAGE_KEY, value);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
    });
  }
  it("updates the most recent record after a rename", () => {
    storage();
    saveRecentEntity({ href: "/items/a", label: "Old name", section: "items" });
    saveRecentEntity({ href: "/items/a", label: "New name", section: "items" });
    expect(getRecentEntities("items")).toEqual([{ href: "/items/a", label: "New name", section: "items" }]);
  });
  it("repairs corrupt recent storage on the next visit", () => {
    storage("{broken");
    saveRecentEntity({ href: "/items/a", label: "Camera", section: "items" });
    expect(getRecentEntities("items")).toHaveLength(1);
  });
  it("preserves history metadata and unrelated URL state when filters change", () => {
    const state = { __NA: true, tree: ["items"], scroll: 480 };
    const replaceState = vi.fn();
    vi.stubGlobal("window", { location: { href: "https://app.example.com/items?other=1&page=2#section" }, history: { state, replaceState } });
    syncUrl({ page: 0, q: "camera" });
    expect(replaceState).toHaveBeenCalledWith(state, "", "https://app.example.com/items?other=1&q=camera#section");
  });
});
