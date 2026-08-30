import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canEditItems,
  canEditItemsForCurrentUser,
  fetchItemsPageInit,
  getBulkActionReferenceAvailability,
  getItemsControlRecoveryMode,
  itemsPageInitQueryKey,
  mergeItemsPageInitResponse,
  type ItemsPageInitResponse,
} from "@/app/(app)/items/hooks/use-filter-options";

const completeResponse: ItemsPageInitResponse = {
  data: {
    user: { role: "STAFF" },
    locations: [{ id: "loc-1", name: "Kohl Center" }],
    departments: [{ id: "dept-1", name: "Video" }],
    categories: [{ id: "cat-1", name: "Cameras", parentId: null }],
    brands: ["Sony"],
    kits: [{ id: "kit-1", name: "Basketball" }],
  },
  partialFailures: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("items filter options bootstrap", () => {
  it("accepts the route envelope on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(completeResponse)));

    await expect(fetchItemsPageInit()).resolves.toEqual(completeResponse);
  });

  it("rejects non-OK responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(fetchItemsPageInit()).rejects.toThrow("Failed to load item controls");
  });

  it("rejects malformed JSON and malformed envelopes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{", { headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(Response.json({ data: { user: { role: "STAFF" } } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchItemsPageInit()).rejects.toThrow("Invalid item controls response");
    await expect(fetchItemsPageInit()).rejects.toThrow("Invalid item controls response");
  });

  it("surfaces network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(fetchItemsPageInit()).rejects.toThrow("offline");
  });

  it("retains healthy prior groups when a background refresh partially fails", () => {
    const partial: ItemsPageInitResponse = {
      data: {
        ...completeResponse.data,
        locations: [{ id: "loc-2", name: "LaBahn Arena" }],
        categories: [],
        kits: [],
      },
      partialFailures: ["categories", "kits"],
    };

    expect(mergeItemsPageInitResponse(partial, completeResponse)).toEqual({
      data: {
        ...partial.data,
        categories: completeResponse.data.categories,
        kits: completeResponse.data.kits,
      },
      partialFailures: ["categories", "kits"],
    });
  });

  it("keeps edit permissions fail-closed until a trusted role is known", () => {
    expect(canEditItems(undefined)).toBe(false);
    expect(canEditItems("")).toBe(false);
    expect(canEditItems("STUDENT")).toBe(false);
    expect(canEditItems("STAFF")).toBe(true);
    expect(canEditItems("ADMIN")).toBe(true);
    expect(canEditItemsForCurrentUser("STUDENT", "STAFF")).toBe(false);
    expect(canEditItemsForCurrentUser("STAFF", "STAFF")).toBe(true);
  });

  it("scopes permission-bearing bootstrap data by user and refetches for a STUDENT transition", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(itemsPageInitQueryKey("staff-1"), completeResponse);

    const studentKey = itemsPageInitQueryKey("student-1");
    expect(queryClient.getQueryData(studentKey)).toBeUndefined();
    expect(canEditItemsForCurrentUser("STUDENT", undefined)).toBe(false);

    const queryFn = vi.fn().mockResolvedValue({
      ...completeResponse,
      data: { ...completeResponse.data, user: { role: "STUDENT" } },
    } satisfies ItemsPageInitResponse);
    const studentResponse = await queryClient.fetchQuery({ queryKey: studentKey, queryFn });

    expect(queryFn).toHaveBeenCalledOnce();
    expect(canEditItemsForCurrentUser("STUDENT", studentResponse.data.user.role)).toBe(false);
    expect(queryClient.getQueryData(itemsPageInitQueryKey("staff-1"))).toEqual(completeResponse);
  });

  it("uses one partial recovery state when a partial response is followed by refresh failure", () => {
    expect(getItemsControlRecoveryMode(null, new Error("offline"), ["categories"])).toBe("partial");
    expect(getItemsControlRecoveryMode(null, new Error("offline"), [])).toBe("refresh");
  });

  it("disables only bulk subcommands backed by failed reference groups", () => {
    expect(getBulkActionReferenceAvailability(["categories"])).toEqual({
      locations: true,
      categories: false,
      kits: true,
    });
    expect(getBulkActionReferenceAvailability(["locations", "kits"])).toEqual({
      locations: false,
      categories: true,
      kits: false,
    });
  });

  it("keeps inventory visible while exposing retry and named partial failures", () => {
    const page = readFileSync("src/app/(app)/items/page.tsx", "utf8");

    expect(page).toContain("Item controls did not load");
    expect(page).toContain("You can still browse inventory");
    expect(page).toContain("<OperationalPartialResultsAlert");
    expect(page).toContain('failureLabel="Unavailable item controls"');
    expect(page).toContain("onClick={options.retry}");
    expect(page).toContain('disabled={!canCreateItem}');
    expect(page).toContain('disabled={!canFillGaps}');
    expect(page).toContain('description={canOfferCreateItem ? "Create your first item to get started."');
    expect(page).toContain('actionLabel={canOfferCreateItem ? "Add item" : undefined}');
    expect(page).toContain('onAction={canOfferCreateItem ? openBlankCreate : undefined}');
    expect(page).toContain('recoveryMode === "partial"');
    expect(page).toContain("referenceAvailability={bulkActionReferenceAvailability}");

    const bulkActionBar = readFileSync("src/app/(app)/items/components/bulk-action-bar.tsx", "utf8");
    expect(bulkActionBar).toContain("disabled={!referenceAvailability.locations}");
    expect(bulkActionBar).toContain("disabled={!referenceAvailability.categories}");
    expect(bulkActionBar).toContain("disabled={!referenceAvailability.kits}");
    expect(bulkActionBar).toContain("if (referenceAvailability.locations) onAction(\"move_location\"");
    expect(bulkActionBar).toContain("if (referenceAvailability.categories) onAction(\"change_category\", { categoryId: null })");
    expect(bulkActionBar).toContain("if (referenceAvailability.kits) onAction(\"add_to_kit\"");
  });
});
