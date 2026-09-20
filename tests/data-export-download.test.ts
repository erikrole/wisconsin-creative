import { describe, expect, it } from "vitest";
import {
  getExportCompletionToast,
  getExportFilename,
  readExportFailureMessage,
} from "@/app/(app)/settings/data-export/export-download";

describe("data export download helpers", () => {
  it("warns about incomplete settings downloads even without a total", () => {
    expect(getExportCompletionToast("Users", true, null).variant).toBe("warning");
  });

  it.each(["null", "[]", "42", '"private failure"'])("uses fallback copy for non-object JSON %s", async (body) => {
    expect(await readExportFailureMessage(new Response(body, { status: 502 }), "Users")).toBe("Users export failed (502).");
  });

  it("uses quoted filenames from content disposition", () => {
    expect(getExportFilename('attachment; filename="items-export-2026-06-02.csv"', "items-export.csv"))
      .toBe("items-export-2026-06-02.csv");
  });

  it("uses encoded filenames from content disposition", () => {
    expect(getExportFilename("attachment; filename*=UTF-8''Audit%20Log.csv", "audit-export.csv"))
      .toBe("Audit Log.csv");
  });

  it("falls back when content disposition has no filename", () => {
    expect(getExportFilename("attachment", "users-export.csv")).toBe("users-export.csv");
  });

  it("formats success copy for normal exports", () => {
    expect(getExportCompletionToast("Bookings", false, null)).toEqual({
      variant: "success",
      message: "Bookings export downloaded.",
    });
  });

  it("formats warning copy for truncated exports", () => {
    expect(getExportCompletionToast("Audit Log", true, "6200")).toEqual({
      variant: "warning",
      message: "Audit Log export capped at 5,000 rows; 6200 total. Use filters to narrow the range.",
    });
  });

  it("reads JSON error copy without exposing raw JSON", async () => {
    const res = new Response(JSON.stringify({ error: "Too many requests. Please wait a moment." }), {
      status: 429,
    });

    await expect(readExportFailureMessage(res, "Items"))
      .resolves.toBe("Items export failed: Too many requests. Please wait a moment.");
  });

  it("reads text error copy from non-JSON responses", async () => {
    const res = new Response("Gateway timeout", { status: 504 });

    await expect(readExportFailureMessage(res, "Licenses"))
      .resolves.toBe("Licenses export failed: Gateway timeout");
  });
});
