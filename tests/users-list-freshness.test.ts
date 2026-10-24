import { QueryClient } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isUsersListQueryKey, syncAvatarCaches, syncCachedUserLists } from "@/lib/user-list-cache";

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

  it("refreshes avatar consumers while preserving other fields and accounts", async () => {
    const client = new QueryClient();
    const current = { id: "self", avatarUrl: "old", name: "Alex" };
    client.setQueryData(["me"], current);
    client.setQueryData(["profile-completion"], { profile: current, completion: { onboardingComplete: true } });
    client.setQueryData(["fetch", "/api/me/profile"], { data: current });
    client.setQueryData(["fetch", "/api/users/self"], { data: current });
    const roster = ["fetch", "/api/users?limit=50"];
    client.setQueryData(roster, { data: [current, { id: "other", avatarUrl: "other-photo" }], total: 2 });
    await syncAvatarCaches(client, "self", "new");
    expect(client.getQueryData(["me"])).toEqual({ ...current, avatarUrl: "new" });
    expect(client.getQueryData(["profile-completion"])).toEqual({ profile: { ...current, avatarUrl: "new" }, completion: { onboardingComplete: true } });
    for (const key of [["fetch", "/api/me/profile"], ["fetch", "/api/users/self"]]) {
      expect(client.getQueryData(key)).toEqual({ data: { ...current, avatarUrl: "new" } });
    }
    expect(client.getQueryData(roster)).toEqual({ data: [{ ...current, avatarUrl: "new" }, { id: "other", avatarUrl: "other-photo" }], total: 2 });
    await syncAvatarCaches(client, "self", null);
    expect(client.getQueryData(["me"])).toMatchObject({ avatarUrl: null });
    expect(client.getQueryData(["profile-completion"])).toMatchObject({ profile: { avatarUrl: null }, completion: { onboardingComplete: true } });
    await syncAvatarCaches(client, "other", "changed-elsewhere");
    expect(client.getQueryData(["me"])).toMatchObject({ id: "self", avatarUrl: null });
    expect(client.getQueryData(["profile-completion"])).toMatchObject({ profile: { id: "self", avatarUrl: null } });
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

    expect(detailPage).toContain("syncCachedUserLists(queryClient, id, { active: newActive })");
    expect(infoTab).toContain("syncCachedUserLists(queryClient, user.id, cachePatch)");
    expect(infoTab).toContain("syncCachedUserLists(queryClient, user.id, { role: newRole })");
    expect(settingsProfile).toContain("syncCachedUserLists(queryClient, fetched.id, json.data)");
    expect(usersPage).toContain('refetchOnMount: "always"');
  });
});
