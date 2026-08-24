import { describe, expect, it } from "vitest";
import { getVisiblePageSearchResults } from "@/lib/search-pages";

describe("global page search results", () => {
  it("lets students search personal settings but not staff/admin destinations", () => {
    const labels = getVisiblePageSearchResults("STUDENT", "settings", 30).map((result) => result.title);

    expect(labels).toContain("Security");
    expect(labels).toContain("Notifications");
    expect(labels).not.toContain("Settings");
    expect(labels).not.toContain("Data Export");
    expect(labels).not.toContain("Fix Today");
  });

  it("finds settings by operational keywords", () => {
    const results = getVisiblePageSearchResults("ADMIN", "allowlist", 10);

    expect(results.map((result) => result.href)).toContain("/settings/allowed-emails");
  });

  it("keeps the owner app activity page out of search unless owner access is explicit", () => {
    expect(getVisiblePageSearchResults("ADMIN", "app activity", 10)).not.toContainEqual(
      expect.objectContaining({ href: "/settings/app-activity" }),
    );
    expect(getVisiblePageSearchResults("ADMIN", "app activity", 10, true)).toContainEqual(
      expect.objectContaining({ href: "/settings/app-activity" }),
    );
  });

  it("finds reports for staff users", () => {
    const results = getVisiblePageSearchResults("STAFF", "missing units", 10);

    expect(results).toContainEqual(expect.objectContaining({
      title: "Missing Units",
      href: "/reports/bulk-losses",
    }));
  });

  it("makes accountability discoverable to internal roles but not collaborators", () => {
    for (const role of ["ADMIN", "STAFF", "STUDENT"]) {
      expect(getVisiblePageSearchResults(role, "late returns", 10)).toContainEqual(
        expect.objectContaining({ title: "Accountability", href: "/accountability" }),
      );
    }
    expect(getVisiblePageSearchResults("COLLABORATOR", "late returns", 10)).not.toContainEqual(
      expect.objectContaining({ href: "/accountability" }),
    );
  });

  it("makes Scoreboard discoverable to every authenticated role", () => {
    for (const role of ["ADMIN", "STAFF", "STUDENT", "COLLABORATOR"]) {
      expect(getVisiblePageSearchResults(role, "leaderboard", 10)).toContainEqual(
        expect.objectContaining({ title: "Scoreboard", href: "/scoreboard" }),
      );
    }
  });
});
