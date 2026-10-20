import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import { createQueryClient, getQueryClient, getQueryPersistOptions, shouldPersistQueryKey, TRANSIENT_QUERY_GC_TIME } from "@/lib/query-client";

afterEach(() => vi.useRealTimers());

describe("shouldPersistQueryKey", () => {
  it("persists dashboard and booking detail cache roots", () => {
    expect(shouldPersistQueryKey(["dashboard"])).toBe(true);
    expect(shouldPersistQueryKey(["booking", "booking-1"])).toBe(true);
  });

  it("does not persist broad list, settings, or user-scoped roots", () => {
    expect(shouldPersistQueryKey(["bookingList", "CHECKOUT", "/api/checkouts"])).toBe(false);
    expect(shouldPersistQueryKey(["fetch", "/api/settings/escalation"])).toBe(false);
    expect(shouldPersistQueryKey(["me"])).toBe(false);
    expect(shouldPersistQueryKey(["form-options"])).toBe(false);
  });

  it("ignores non-string query roots", () => {
    expect(shouldPersistQueryKey([null])).toBe(false);
    expect(shouldPersistQueryKey([{ scope: "dashboard" }])).toBe(false);
  });
});

describe("query client lifecycle", () => {
  it("creates isolated server clients", () => {
    expect(getQueryClient()).not.toBe(getQueryClient());
  });

  it("creates fresh explicit clients", () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });

  it("releases inactive search variants while keeping persisted and visible data", async () => {
    vi.useFakeTimers();
    const client = createQueryClient();
    for (let i = 0; i < 250; i++) client.setQueryData(["fetch", `/api/items?q=${i}`], { rows: [i] });
    client.setQueryData(["dashboard", "user-a"], { count: 2 });
    client.setQueryData(["booking", "one"], { id: "one" });
    client.setQueryData(["items", "visible"], { rows: [1] });
    const observer = new QueryObserver(client, { queryKey: ["items", "visible"], enabled: false });
    const unsubscribe = observer.subscribe(() => undefined);

    await vi.advanceTimersByTimeAsync(TRANSIENT_QUERY_GC_TIME + 1);
    expect(client.getQueryCache().getAll()).toHaveLength(3);
    expect(client.getQueryData(["items", "visible"])).toEqual({ rows: [1] });
    unsubscribe();
    await vi.advanceTimersByTimeAsync(TRANSIENT_QUERY_GC_TIME + 1);
    expect(client.getQueryCache().getAll()).toHaveLength(2);
    client.clear();
  });

  it("can mount the persistent provider when storage is unavailable", async () => {
    await expect(Promise.resolve(getQueryPersistOptions().persister.restoreClient())).resolves.toBeUndefined();
  });
});
