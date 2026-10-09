import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script without type declarations
import { changedReleases, evaluateReleaseNote, isRealIsoDate, OPT_OUT_LABEL } from "../scripts/check-release-note.mjs";

const existing = {
  date: "2026-10-01",
  title: "Kiosk redesign",
  type: "feature",
  summary: "The kiosk gets a new home screen and hubs.",
  details: ["Home shows today's pickups.", "Hubs group a person's gear."],
  platforms: ["Kiosk"],
};

describe("release note PR check", () => {
  it("fails when the PR leaves releases.json unchanged", () => {
    const result = evaluateReleaseNote({ before: [existing], after: [existing] });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(OPT_OUT_LABEL);
  });

  it("passes when an entry is added or edited", () => {
    const added = { ...existing, date: "2026-10-09", title: "Label print cart", pr: 450 };
    expect(evaluateReleaseNote({ before: [existing], after: [added, existing], prNumber: 450 }).ok).toBe(true);
    const edited = { ...existing, summary: "Updated." };
    expect(changedReleases([existing], [edited])).toEqual([edited]);
  });

  it("fails when no changed entry carries this PR's number", () => {
    const missing = { ...existing, date: "2026-10-09" };
    const missingResult = evaluateReleaseNote({ before: [existing], after: [missing, existing], prNumber: 451 });
    expect(missingResult.ok).toBe(false);
    expect(missingResult.reason).toContain("451");
    const wrong = { ...existing, date: "2026-10-09", pr: 450 };
    expect(evaluateReleaseNote({ before: [existing], after: [wrong, existing], prNumber: 451 }).ok).toBe(false);
  });

  it("rejects impossible dates and entries outside the content contract", () => {
    expect(isRealIsoDate("2026-02-28")).toBe(true);
    expect(isRealIsoDate("2026-02-31")).toBe(false);
    const badDate = { ...existing, date: "2026-02-31", pr: 452 };
    expect(evaluateReleaseNote({ before: [existing], after: [badDate, existing], prNumber: 452 }).ok).toBe(false);
    const noDetails = { ...existing, date: "2026-10-09", pr: 452, details: undefined };
    const result = evaluateReleaseNote({ before: [existing], after: [noDetails, existing], prNumber: 452 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("details");
    const smallFix = { ...existing, date: "2026-10-09", pr: 452, type: "fixes", details: ["Fixed a kiosk label."] };
    expect(evaluateReleaseNote({ before: [existing], after: [smallFix, existing], prNumber: 452 }).ok).toBe(true);
  });

  it("honors the opt-out label and exempts Dependabot", () => {
    expect(evaluateReleaseNote({ before: [], after: [], labels: [OPT_OUT_LABEL] }).ok).toBe(true);
    expect(evaluateReleaseNote({ before: [], after: [], author: "dependabot[bot]" }).ok).toBe(true);
  });
});
