import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { source } from "./_helpers/source";
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_TYPE_CATEGORY,
  catalogForRole,
  isNotificationCategory,
} from "@/lib/notification-catalog";

/** Files under src/ that insert Notification rows. */
function notificationWriters(): string[] {
  const out = execFileSync(
    "git",
    ["grep", "-l", "-E", "notification\\.create(Many|ManyAndReturn)?\\(|writeTradeNotification\\(|notifyAfterCommit\\(", "--", "src"],
    { encoding: "utf8" },
  );
  return out.split("\n").filter(Boolean);
}

/** `type: "..."` literals on non-payload lines, plus the trade helper's type argument. */
function writtenTypes(): Set<string> {
  const types = new Set<string>();
  for (const file of notificationWriters()) {
    const text = source(file);
    for (const line of text.split("\n")) {
      if (line.includes("payload")) continue;
      for (const match of line.matchAll(/\btype: "([a-z0-9_]+)"/g)) types.add(match[1]!);
    }
    for (const match of text.matchAll(/(?:writeTradeNotification|notifyAfterCommit)\(\s*(?:\w+,\s*)?[\w.]+,\s*"([a-z0-9_]+)"/g)) {
      types.add(match[1]!);
    }
  }
  // Built from template literals or ternaries the scan above can't read.
  for (const type of ["checkin_item_damaged", "checkin_item_lost", "time_off_approved", "time_off_denied", "license_expired", "license_expiring_soon"]) {
    types.add(type);
  }
  return types;
}

describe("notification catalog", () => {
  it("maps every notification type the server writes to a category or an explicit null", () => {
    const types = writtenTypes();
    expect(types.size).toBeGreaterThan(30);
    const unmapped = [...types].filter((type) => !(type in NOTIFICATION_TYPE_CATEGORY));
    expect(unmapped).toEqual([]);
  });

  it("only maps types to known categories", () => {
    for (const category of Object.values(NOTIFICATION_TYPE_CATEGORY)) {
      if (category !== null) expect(isNotificationCategory(category)).toBe(true);
    }
  });

  it("gives every category a unique id, a label, and at least one role", () => {
    const ids = NOTIFICATION_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of NOTIFICATION_CATALOG) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.roles.length).toBeGreaterThan(0);
      // An email-only category can't be "silent"; it is either on or off.
      if (!entry.push) expect(entry.defaultLevel).not.toBe("silent");
    }
  });

  it("keeps admin-only categories away from students and collaborators", () => {
    for (const role of ["STUDENT", "COLLABORATOR"] as const) {
      const ids = catalogForRole(role).map((entry) => entry.id);
      expect(ids).not.toContain("reviewQueue");
      expect(ids).not.toContain("systemAlerts");
      expect(ids).not.toContain("itemReports");
    }
    expect(catalogForRole("ADMIN").map((entry) => entry.id)).toContain("reviewQueue");
  });
});
