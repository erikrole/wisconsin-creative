import { QueryClient } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isUsersListQueryKey, syncCachedUserLists } from "@/lib/user-list-cache";

describe("Users list freshness", () => {
  it("patches every cached roster view without touching user detail caches", async () => {
    const queryClient = new QueryClient();
    const firstListKey = ["fetch", "/api/users?limit=50&offset=0&sort=name"];
    const filteredListKey = ["fetch", "/api/users?limit=50&offset=0&role=STUDENT"];
    const detailKey = ["fetch", "/api/users/user-1"];

    queryClient.setQueryData(firstListKey, {
      data: [{ id: "user-1", title: "Old title", primaryArea: "PHOTO" }],
      total: 1,
    });
    queryClient.setQueryData(filteredListKey, {
      data: [{ id: "user-1", title: "Old title", primaryArea: "PHOTO" }],
      total: 1,
    });
    queryClient.setQueryData(detailKey, { data: { id: "user-1", title: "Old title" } });

    await syncCachedUserLists(queryClient, "user-1", {
      title: "Video Student",
      primaryArea: "VIDEO",
      athleticsEmail: "private@example.com",
    });

    for (const key of [firstListKey, filteredListKey]) {
      const cached = queryClient.getQueryData<{ data: Array<Record<string, unknown>> }>(key);
      expect(cached?.data[0]).toMatchObject({
        id: "user-1",
        title: "Video Student",
        primaryArea: "VIDEO",
      });
      expect(cached?.data[0]).not.toHaveProperty("athleticsEmail");
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }

    expect(queryClient.getQueryData(detailKey)).toEqual({
      data: { id: "user-1", title: "Old title" },
    });
  });

  it("recognizes only paginated Users list query keys", () => {
    expect(isUsersListQueryKey(["fetch", "/api/users?limit=50"])).toBe(true);
    expect(isUsersListQueryKey(["fetch", "/api/users/user-1"])).toBe(false);
    expect(isUsersListQueryKey(["items", "/api/users?limit=50"])).toBe(false);
  });

  it("wires detail and Settings mutations into roster synchronization", () => {
    const detailPage = readFileSync("src/app/(app)/staff/[id]/page.tsx", "utf8");
    const infoTab = readFileSync("src/app/(app)/staff/[id]/UserInfoTab.tsx", "utf8");
    const settingsProfile = readFileSync("src/app/(app)/settings/profile/page.tsx", "utf8");
    const usersPage = readFileSync("src/app/(app)/staff/page.tsx", "utf8");

    expect(detailPage).toContain("syncCachedUserLists(queryClient, id, { avatarUrl })");
    expect(detailPage).toContain("syncCachedUserLists(queryClient, id, { active: newActive })");
    expect(infoTab).toContain("syncCachedUserLists(queryClient, user.id, cachePatch)");
    expect(infoTab).toContain("syncCachedUserLists(queryClient, user.id, { role: newRole })");
    expect(settingsProfile).toContain("syncCachedUserLists(queryClient, fetched.id, json.data)");
    expect(usersPage).toContain('refetchOnMount: "always"');
  });
});
