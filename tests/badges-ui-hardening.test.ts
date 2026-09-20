import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("badge UI error handling", () => {
  it("keeps revoke failures visible and preserves the auth return path", () => {
    const badgesTab = source("src/app/(app)/users/[id]/UserBadgesTab.tsx");

    expect(badgesTab).toContain("handleAuthRedirect");
    expect(badgesTab).toContain("parseErrorMessage");
    expect(badgesTab).toContain('toast.error(await parseErrorMessage(res, "Failed to revoke badge"))');
    expect(badgesTab).toContain('toast.error("Network error. Badge was not revoked.")');
  });

  it("does not mark future-dated awards as fresh", () => {
    const badgesTab = source("src/app/(app)/users/[id]/UserBadgesTab.tsx");
    const nativeProfile = source("ios/Wisconsin/Views/UserDetailView.swift");

    expect(badgesTab).toContain("return age >= 0 && age <= 7 * 86_400_000;");
    expect(nativeProfile).toContain("return age >= 0 && age <= 7 * 86_400");
  });
});
