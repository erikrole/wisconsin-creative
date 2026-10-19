import { describe, expect, it, vi } from "vitest";
import { collectLabelCatalog, type LabelCatalogPage } from "@/app/(app)/labels/label-catalog";

function pageOf(count: number, offset: number, total: number): LabelCatalogPage<{ id: string }, { id: string }> {
  return {
    data: Array.from({ length: count }, (_, index) => ({ id: `asset-${offset + index}` })),
    bulkItems: [],
    total,
  };
}

function paramsOf(path: string) {
  return new URL(path, "https://gear.test").searchParams;
}

describe("label catalog paging", () => {
  it("reads the next page when the catalog is larger than one page", async () => {
    const fetchPage = vi.fn(async (path: string) => {
      const offset = Number(paramsOf(path).get("offset"));
      if (offset === 0) return pageOf(200, 0, 201);
      if (offset === 200) {
        return {
          data: [],
          bulkItems: [{ id: "sku-late" }],
          total: 201,
        };
      }
      throw new Error(`unexpected ${path}`);
    });

    const catalog = await collectLabelCatalog("battery", fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    for (const [path] of fetchPage.mock.calls) {
      const params = paramsOf(path);
      expect(params.get("limit")).toBe("200");
      expect(params.get("sort")).toBe("assetTag");
      expect(params.get("counts")).toBe("0");
      expect(params.get("q")).toBe("battery");
    }
    expect(paramsOf(fetchPage.mock.calls[1]?.[0] ?? "").get("offset")).toBe("200");
    expect(catalog.assets).toHaveLength(200);
    expect(catalog.families).toEqual([{ id: "sku-late" }]);
  });

  it("stops after a short first page", async () => {
    const fetchPage = vi.fn(async () => pageOf(3, 0, 3));

    const catalog = await collectLabelCatalog("", fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(catalog.assets.map((asset) => asset.id)).toEqual(["asset-0", "asset-1", "asset-2"]);
  });

  it("refuses a catalog the offset cap cannot finish", async () => {
    const fetchPage = vi.fn(async () => pageOf(200, 0, 10_201));

    await expect(collectLabelCatalog("", fetchPage)).rejects.toThrow(/paged read/);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("refuses a short later page instead of returning a partial catalog", async () => {
    const fetchPage = vi.fn(async (path: string) => {
      const offset = Number(paramsOf(path).get("offset"));
      if (offset === 0) return pageOf(200, 0, 201);
      return { data: [], bulkItems: [], total: 201 };
    });

    await expect(collectLabelCatalog("", fetchPage)).rejects.toThrow(/page was short/);
  });
});
