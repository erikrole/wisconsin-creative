import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const hygieneSource = readFileSync(
  path.join(process.cwd(), "src/app/api/inventory-hygiene/route.ts"),
  "utf8",
);

describe("inventory hygiene source contract", () => {
  it("counts cross-table scan collisions including active family bin QR", () => {
    expect(hygieneSource).toContain("bin_qr_code_value");
    expect(hygieneSource).toContain("family bin QR");
    expect(hygieneSource).toContain("SELECT count(*)::bigint AS count FROM duplicate_values");
  });

  it("scopes operational missing-field checks to non-retired serialized rows", () => {
    expect(hygieneSource).toContain('status: { not: "RETIRED"');
    expect(hygieneSource).toContain("family-missing-category");
    expect(hygieneSource).toContain("family-missing-department");
    expect(hygieneSource).toContain("family-missing-image");
  });

  it("labels camera-missing-attachments as advisory", () => {
    expect(hygieneSource).toMatch(/camera-missing-attachments[\s\S]*Advisory only/);
  });

  it("surfaces legacy QR, missing serial, and attachment queues for the cleanup wizard", () => {
    expect(hygieneSource).toContain("legacy-qr-labels");
    expect(hygieneSource).toContain("missing-serial");
    expect(hygieneSource).toContain("attachment-candidates");
    expect(hygieneSource).toContain("getCleanupWizardCounts");
    expect(hygieneSource).toContain('listCleanupWizardQueue("attachment_candidate"');
  });
});
