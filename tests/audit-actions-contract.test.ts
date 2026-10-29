// source-contract: every audit action written anywhere in src must have wording; only a source scan can see all write sites.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditCategory, auditSentence, isWordedAction, normalizeAction } from "@/lib/audit-actions";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const timelineSource = readFileSync("src/lib/activity-timeline.ts", "utf8");
const handledInTimeline = new Set([...timelineSource.matchAll(/case "([^"]+)"/g)].map((m) => m[1]!));

/** Bare verbs reused by several entities. They read fine as "Add" / "Remove" with the record named beside them. */
const GENERIC_VERBS = new Set([
  "add", "remove", "create", "update", "delete", "claim", "release", "export", "import", "link", "unlink",
  "promote", "upsert", "start", "stop", "occupy", "desc",
]);

describe("audit action contract", () => {
  it("words every action the code writes", () => {
    const missing = new Set<string>();
    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8");
      if (!/createAudit|createSystemAudit|auditLog\./.test(text)) continue;
      for (const match of text.matchAll(/\baction: "([^"]+)"/g)) {
        const action = match[1]!;
        if (handledInTimeline.has(action) || handledInTimeline.has(normalizeAction(action))) continue;
        if (GENERIC_VERBS.has(action) || isWordedAction(action)) continue;
        missing.add(action);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it("reads old and new spellings of one action as the same thing", () => {
    expect(normalizeAction("setBudget")).toBe("set_budget");
    expect(normalizeAction("CHECK_PUBLISH")).toBe("check_publish");
    expect(auditSentence("setBudget", "gear_pick_cycle")).toBe(auditSentence("set_budget", "gear_pick_cycle"));
  });

  it("scopes bare verbs by entity", () => {
    expect(auditSentence("release", "license_code")).toBe("Released a license");
    expect(auditSentence("RESET", "SignatureCollection")).toBe("Reset a signature collection");
  });

  it("files actions under one category", () => {
    expect(auditCategory("admin_force_completed_checkout", "booking")).toBe("override");
    expect(auditCategory("passkey_registered", "passkey_credential")).toBe("security");
    expect(auditCategory("kiosk_pickup", "booking")).toBe("kiosk");
    expect(auditCategory("shift_assigned", "shift_assignment")).toBe("schedule");
    expect(auditCategory("updated", "asset")).toBe("items");
    expect(auditCategory("updated", "quick_link")).toBe("settings");
  });
});
