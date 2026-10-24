/**
 * Print Labels reads the whole catalog. `/api/assets` caps a page at 200, so a
 * single request would leave later rows off the print list. Each page skips
 * the catalog status counts and uses asset-tag order, which stays stable while
 * the pages are combined.
 */
export const LABEL_CATALOG_PAGE_SIZE = 200;

/** Matches `PAGINATION_MAX_OFFSET` in `src/lib/http.ts`. */
const LABEL_CATALOG_MAX_OFFSET = 10_000;

export type LabelCatalogPage<TAsset, TFamily> = {
  data?: TAsset[];
  bulkItems?: TFamily[];
  total?: number;
};

export type LabelCatalog<TAsset, TFamily> = {
  assets: TAsset[];
  families: TFamily[];
};

function labelCatalogPagePath(search: string, offset: number): string {
  const params = new URLSearchParams({
    limit: String(LABEL_CATALOG_PAGE_SIZE),
    sort: "assetTag",
    counts: "0",
    offset: String(offset),
  });
  const q = search.trim();
  if (q) params.set("q", q);
  return `/api/assets?${params}`;
}

function pageCount<TAsset, TFamily>(page: LabelCatalogPage<TAsset, TFamily>): number {
  return (page.data?.length ?? 0) + (page.bulkItems?.length ?? 0);
}

function rowId(row: unknown): string | null {
  if (!row || typeof row !== "object" || !("id" in row)) return null;
  const id = (row as { id: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function dedupeRows<T>(rows: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const row of rows) {
    const id = rowId(row);
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    unique.push(row);
  }
  return unique;
}

/**
 * Offsets after the first page. Throws when `total` cannot be read without
 * passing the API offset cap, so the caller does not present a short list.
 */
function labelCatalogFollowupOffsets(total: number, firstPageCount: number): number[] {
  if (firstPageCount < LABEL_CATALOG_PAGE_SIZE || total <= firstPageCount) return [];
  const maxReadable = LABEL_CATALOG_MAX_OFFSET + LABEL_CATALOG_PAGE_SIZE;
  if (total > maxReadable) {
    throw new Error("label catalog exceeds paged read");
  }
  const offsets: number[] = [];
  for (
    let offset = LABEL_CATALOG_PAGE_SIZE;
    offset < total && offset <= LABEL_CATALOG_MAX_OFFSET;
    offset += LABEL_CATALOG_PAGE_SIZE
  ) {
    offsets.push(offset);
  }
  return offsets;
}

export async function collectLabelCatalog<TAsset, TFamily>(
  search: string,
  fetchPage: (path: string) => Promise<LabelCatalogPage<TAsset, TFamily>>,
): Promise<LabelCatalog<TAsset, TFamily>> {
  const first = await fetchPage(labelCatalogPagePath(search, 0));
  const pages = [first];
  const firstCount = pageCount(first);

  if (typeof first.total !== "number") {
    if (firstCount >= LABEL_CATALOG_PAGE_SIZE) {
      for (let offset = LABEL_CATALOG_PAGE_SIZE; offset <= LABEL_CATALOG_MAX_OFFSET; offset += LABEL_CATALOG_PAGE_SIZE) {
        const page = await fetchPage(labelCatalogPagePath(search, offset));
        pages.push(page);
        if (pageCount(page) < LABEL_CATALOG_PAGE_SIZE) break;
        if (offset === LABEL_CATALOG_MAX_OFFSET) {
          throw new Error("label catalog exceeds paged read");
        }
      }
    }
  } else {
    const offsets = labelCatalogFollowupOffsets(first.total, firstCount);
    const rest = await Promise.all(offsets.map((offset) => fetchPage(labelCatalogPagePath(search, offset))));
    pages.push(...rest);
  }

  const assets = dedupeRows(pages.flatMap((page) => page.data ?? []));
  const families = dedupeRows(pages.flatMap((page) => page.bulkItems ?? []));
  if (typeof first.total === "number" && assets.length + families.length < first.total) {
    throw new Error("label catalog page was short");
  }
  return { assets, families };
}
