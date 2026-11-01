import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, Role } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const models = {
    resourceAssetFolder: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    resourceAsset: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    resourceAssetVersion: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    resourceAssetUpload: { deleteMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    resourceAssetFavorite: { findUnique: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
  };
  const transactionCalls: Array<{ options: unknown }> = [];
  return {
    models,
    transactionCalls,
    db: {
      ...models,
      $transaction: vi.fn(async (fn: (tx: typeof models) => Promise<unknown>, options?: unknown) => {
        transactionCalls.push({ options });
        return fn(models);
      }),
    },
    audit: vi.fn(),
    auditTx: vi.fn(),
    head: vi.fn(),
    copy: vi.fn(),
    del: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit, createAuditEntryTx: mocks.auditTx }));
vi.mock("@/lib/resource-assets-storage", () => ({
  headResourceAsset: mocks.head,
  copyResourceAsset: mocks.copy,
  deleteResourceAsset: mocks.del,
}));

import {
  completeResourceAssetUpload,
  createResourceAssetFolder,
  getResourceAsset,
  getResourceAssetVersion,
  listResourceAssets,
  prepareResourceAssetUpload,
  restoreResourceAssetVersion,
  toggleResourceAssetFavorite,
} from "@/lib/resource-assets";

const { models, transactionCalls } = mocks;
const actor = { actorId: "staff-1", actorRole: Role.STAFF };
const root = { id: "root", name: "Brand assets", path: "brand-assets" };
const logos = { id: "logos", name: "Logos", path: "brand-assets/logos" };
const uploader = { id: "staff-1", name: "Staff" };
const version = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `v${n}`, versionNumber: n, originalName: `W-logo-v${n}.svg`, contentType: "image/svg+xml", sizeBytes: 1000 + n,
  etag: `etag-${n}`, versionNote: null, createdAt: new Date("2026-10-0" + n), uploadedBy: uploader, storagePath: `resource-assets/i${n}/W-logo-v${n}.svg`, ...extra,
});
const assetRow = (extra: Record<string, unknown> = {}) => ({
  id: "a1", name: "Motion W", kind: "LOGO", description: null, folderId: "logos", folder: logos,
  createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-02"), currentVersion: version(2), _count: { versions: 2 }, ...extra,
});

beforeEach(() => {
  transactionCalls.length = 0;
  models.resourceAssetFolder.findUnique.mockImplementation(async ({ where }: { where: { id?: string; path?: string } }) =>
    where.path === "brand-assets" || where.id === "root" ? root : where.id === "logos" || where.path === "brand-assets/logos" ? logos : null);
  models.resourceAssetFolder.findMany.mockResolvedValue([]);
  models.resourceAsset.findMany.mockResolvedValue([]);
  models.resourceAssetUpload.deleteMany.mockResolvedValue({ count: 0 });
  models.resourceAssetUpload.create.mockResolvedValue({});
  models.resourceAssetUpload.update.mockResolvedValue({});
  models.resourceAsset.update.mockResolvedValue({});
  mocks.del.mockResolvedValue(undefined);
});

describe("listResourceAssets", () => {
  it("lists the root folder by default with breadcrumbs, child folders and asset summaries", async () => {
    models.resourceAssetFolder.findMany
      .mockResolvedValueOnce([{ ...logos, _count: { assets: 4 } }])
      .mockResolvedValueOnce([root]);
    models.resourceAsset.findMany.mockResolvedValue([assetRow({ favorites: [{ id: "fav" }] })]);

    const result = await listResourceAssets({ favoriteUserId: "staff-1" });

    expect(result.folder).toEqual(root);
    expect(result.breadcrumbs).toEqual([root]);
    expect(result.folders).toEqual([{ id: "logos", name: "Logos", path: "brand-assets/logos", assetCount: 4 }]);
    expect(result.assets[0]).toMatchObject({ id: "a1", isFavorite: true, versionCount: 2, currentVersion: { versionNumber: 2, uploadedBy: uploader } });
    expect(result.assets[0]!.currentVersion).not.toHaveProperty("storagePath");
    const query = models.resourceAsset.findMany.mock.calls[0]![0];
    expect(query.where).toEqual({ folderId: "root" });
    expect(query.orderBy).toEqual([{ name: "asc" }]);
    expect(query.include.favorites).toEqual({ where: { userId: "staff-1" }, select: { id: true } });
  });

  it("searches a whole subtree without leaking sibling folders that share a prefix", async () => {
    models.resourceAssetFolder.findMany.mockResolvedValue([]);

    await listResourceAssets({ folderId: "logos", scope: "all", search: "  motion ", kind: "LOGO", sort: "updated" });

    const query = models.resourceAsset.findMany.mock.calls[0]![0];
    expect(query.where.folder).toEqual({ OR: [{ path: "brand-assets/logos" }, { path: { startsWith: "brand-assets/logos/" } }] });
    expect(query.where.kind).toBe("LOGO");
    expect(query.where.OR).toEqual([
      { name: { contains: "motion", mode: "insensitive" } },
      { description: { contains: "motion", mode: "insensitive" } },
      { currentVersion: { is: { originalName: { contains: "motion", mode: "insensitive" } } } },
    ]);
    expect(query.orderBy).toEqual([{ updatedAt: "desc" }, { name: "asc" }]);
    expect(query.include).not.toHaveProperty("favorites");
    const breadcrumbQuery = models.resourceAssetFolder.findMany.mock.calls[1]![0];
    expect(breadcrumbQuery.where.path.in).toEqual(["brand-assets", "brand-assets/logos"]);
  });

  it("sorts by type, filters favorites for the viewer, and refuses favorites without a viewer", async () => {
    await listResourceAssets({ favoritesOnly: true, favoriteUserId: "u1", sort: "type" });
    const query = models.resourceAsset.findMany.mock.calls[0]![0];
    expect(query.where.favorites).toEqual({ some: { userId: "u1" } });
    expect(query.orderBy).toEqual([{ kind: "asc" }, { name: "asc" }]);

    await expect(listResourceAssets({ favoritesOnly: true })).rejects.toMatchObject({ status: 400 });
    await expect(listResourceAssets({ folderId: "nope" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("getResourceAsset / getResourceAssetVersion", () => {
  it("returns the asset with its full version history, newest first", async () => {
    models.resourceAsset.findUnique.mockResolvedValue(assetRow({ versions: [version(2), version(1)], favorites: [] }));

    const asset = await getResourceAsset("a1", "staff-1");

    expect(asset.versions.map((v) => v.versionNumber)).toEqual([2, 1]);
    expect(asset.isFavorite).toBe(false);
    expect(models.resourceAsset.findUnique.mock.calls[0]![0].include.versions.orderBy).toEqual({ versionNumber: "desc" });
  });

  it("404s a missing asset and a version that belongs to a different asset", async () => {
    models.resourceAsset.findUnique.mockResolvedValue(null);
    await expect(getResourceAsset("missing")).rejects.toMatchObject({ status: 404 });

    models.resourceAssetVersion.findUnique.mockResolvedValue({ ...version(1), asset: { id: "other", name: "Other" } });
    await expect(getResourceAssetVersion("a1", "v1")).rejects.toMatchObject({ status: 404 });

    models.resourceAssetVersion.findUnique.mockResolvedValue({ ...version(1), asset: { id: "a1", name: "Motion W" } });
    await expect(getResourceAssetVersion("a1", "v1")).resolves.toMatchObject({ id: "v1" });
  });

  it("falls back to the current version when no version id is given", async () => {
    models.resourceAsset.findUnique.mockResolvedValue({ currentVersion: { ...version(2), asset: { id: "a1", name: "Motion W" } } });
    await expect(getResourceAssetVersion("a1")).resolves.toMatchObject({ id: "v2" });

    models.resourceAsset.findUnique.mockResolvedValue({ currentVersion: null });
    await expect(getResourceAssetVersion("a1", null)).rejects.toMatchObject({ status: 404 });
  });
});

describe("prepareResourceAssetUpload", () => {
  const input = { ...actor, folderId: "logos", name: "Motion W", kind: "LOGO" as const, originalName: "W logo.svg", contentType: "image/svg+xml", sizeBytes: 1234 };

  it("reserves a new file: pending intent under a safe storage path, 30 minute expiry, audit row", async () => {
    models.resourceAsset.findUnique.mockResolvedValue(null);
    const before = Date.now();

    const result = await prepareResourceAssetUpload({ ...input, description: "  Primary mark  ", versionNote: " " });

    expect(transactionCalls[0]!.options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect(result).toMatchObject({ assetId: null, name: "Motion W", versionNumber: 1, contentType: "image/svg+xml", sizeBytes: 1234, versionNote: null });
    expect(result.storagePath).toBe(`resource-assets/${result.id}/W-logo.svg`);
    expect(result.expiresAt.getTime() - before).toBeGreaterThanOrEqual(30 * 60 * 1000 - 1000);
    expect(models.resourceAsset.findUnique).toHaveBeenCalledWith({ where: { folderId_normalizedName: { folderId: "logos", normalizedName: "motion w" } }, select: { id: true } });
    expect(models.resourceAssetUpload.create.mock.calls[0]![0].data).toMatchObject({
      id: result.id, actorId: "staff-1", folderId: "logos", assetId: null, description: "Primary mark", normalizedName: "motion w", originalName: "W logo.svg",
    });
    expect(mocks.auditTx).toHaveBeenCalledWith(models, expect.objectContaining({ action: "resource_asset_upload_prepared", entityId: result.id }));
    const prune = models.resourceAssetUpload.deleteMany.mock.calls[0]![0].where;
    expect(prune).toMatchObject({ actorId: "staff-1", status: "PENDING" });
  });

  it("refuses a duplicate name in the folder and points at the existing file", async () => {
    models.resourceAsset.findUnique.mockResolvedValue({ id: "a-existing" });

    await expect(prepareResourceAssetUpload(input)).rejects.toMatchObject({ status: 409, data: { existingAssetId: "a-existing" } });
    expect(models.resourceAssetUpload.create).not.toHaveBeenCalled();
  });

  it("prepares a replacement as the next version, keeping the asset's own name, kind and description", async () => {
    models.resourceAsset.findUnique.mockResolvedValue({ id: "a1", folderId: "logos", name: "Motion W", normalizedName: "motion w", kind: "LOGO", description: "Primary mark" });
    models.resourceAssetVersion.findFirst.mockResolvedValue({ versionNumber: 2 });

    const result = await prepareResourceAssetUpload({ ...input, assetId: "a1", name: "Renamed", kind: "OTHER", description: "ignored", versionNote: "Fixed kerning" });

    expect(result).toMatchObject({ assetId: "a1", name: "Motion W", versionNumber: 3, versionNote: "Fixed kerning" });
    expect(models.resourceAssetUpload.create.mock.calls[0]![0].data).toMatchObject({ kind: "LOGO", description: "Primary mark", versionNumber: 3 });
  });

  it("refuses a replacement that moves folders or targets a missing asset", async () => {
    models.resourceAsset.findUnique.mockResolvedValue({ id: "a1", folderId: "root", name: "Motion W", normalizedName: "motion w", kind: "LOGO", description: null });
    await expect(prepareResourceAssetUpload({ ...input, assetId: "a1" })).rejects.toMatchObject({ status: 409 });

    models.resourceAsset.findUnique.mockResolvedValue(null);
    await expect(prepareResourceAssetUpload({ ...input, assetId: "gone" })).rejects.toMatchObject({ status: 404 });
    await expect(prepareResourceAssetUpload({ ...input, folderId: "nope" })).rejects.toMatchObject({ status: 404 });
  });

  it("validates the file before touching the database and still works when pruning fails", async () => {
    await expect(prepareResourceAssetUpload({ ...input, originalName: "virus.exe" })).rejects.toMatchObject({ status: 400 });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();

    models.resourceAssetUpload.deleteMany.mockRejectedValue(new Error("db hiccup"));
    models.resourceAsset.findUnique.mockResolvedValue(null);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(prepareResourceAssetUpload(input)).resolves.toMatchObject({ versionNumber: 1 });
    quiet.mockRestore();
  });
});

describe("completeResourceAssetUpload", () => {
  const intent = (extra: Record<string, unknown> = {}) => ({
    id: "intent-1", actorId: "staff-1", status: "PENDING", assetId: null, folderId: "logos", name: "Motion W", normalizedName: "motion w",
    kind: "LOGO", description: null, originalName: "W logo.svg", storagePath: "resource-assets/intent-1/W-logo.svg", contentType: "image/svg+xml",
    sizeBytes: 1234, versionNumber: 1, versionNote: null, expiresAt: new Date(Date.now() + 60_000), ...extra,
  });

  beforeEach(() => {
    mocks.head.mockResolvedValue({ pathname: "resource-assets/intent-1/W-logo.svg", size: 1234, contentType: "image/svg+xml; charset=utf-8", etag: "etag-new" });
    models.resourceAssetVersion.findFirst.mockResolvedValue(null);
    models.resourceAssetVersion.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "v-new", ...data }));
    models.resourceAsset.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "a-new", ...data }));
  });

  it("verifies the stored blob, creates the asset and version 1, points the asset at it and closes the intent", async () => {
    models.resourceAssetUpload.findUnique.mockResolvedValue(intent());
    models.resourceAsset.findUnique.mockResolvedValue(null);

    const result = await completeResourceAssetUpload({ ...actor, intentId: "intent-1" });

    expect(result).toEqual({ assetId: "a-new", versionNumber: 1, name: "Motion W" });
    expect(mocks.head).toHaveBeenCalledWith("resource-assets/intent-1/W-logo.svg");
    expect(models.resourceAsset.create.mock.calls[0]![0].data).toMatchObject({ name: "Motion W", folderId: "logos", createdById: "staff-1" });
    expect(models.resourceAssetVersion.create.mock.calls[0]![0].data).toMatchObject({ assetId: "a-new", versionNumber: 1, etag: "etag-new", contentType: "image/svg+xml", uploadedById: "staff-1" });
    expect(models.resourceAsset.update).toHaveBeenCalledWith({ where: { id: "a-new" }, data: { currentVersionId: "v-new", updatedById: "staff-1" } });
    expect(models.resourceAssetUpload.update.mock.calls[0]![0].data).toMatchObject({ status: "COMPLETED", assetId: "a-new", versionNumber: 1 });
    expect(mocks.auditTx).toHaveBeenCalledWith(models, expect.objectContaining({ action: "resource_asset_version_uploaded", entityId: "a-new" }));
  });

  it("recomputes the version number at commit time so two replacements never collide", async () => {
    models.resourceAssetUpload.findUnique.mockResolvedValue(intent({ assetId: "a1", versionNumber: 3 }));
    models.resourceAsset.findUnique.mockResolvedValue({ id: "a1", folderId: "logos", name: "Motion W", kind: "LOGO" });
    models.resourceAssetVersion.findFirst.mockResolvedValue({ versionNumber: 3 });

    const result = await completeResourceAssetUpload({ ...actor, intentId: "intent-1" });

    expect(result.versionNumber).toBe(4);
    expect(models.resourceAsset.create).not.toHaveBeenCalled();
    expect(models.resourceAssetUpload.update.mock.calls[0]![0].data.versionNumber).toBe(4);
  });

  it("is idempotent: a completed intent returns its asset without touching storage", async () => {
    models.resourceAssetUpload.findUnique.mockResolvedValue(intent({ status: "COMPLETED", assetId: "a1", versionNumber: 2 }));

    await expect(completeResourceAssetUpload({ ...actor, intentId: "intent-1" })).resolves.toEqual({ assetId: "a1", versionNumber: 2, name: "Motion W" });
    expect(mocks.head).not.toHaveBeenCalled();

    models.resourceAssetUpload.findUnique.mockResolvedValue(intent({ status: "COMPLETED", assetId: null }));
    await expect(completeResourceAssetUpload({ ...actor, intentId: "intent-1" })).rejects.toMatchObject({ status: 409 });
  });

  it("refuses someone else's intent, an expired intent, and a blob that does not match", async () => {
    models.resourceAssetUpload.findUnique.mockResolvedValue(intent({ actorId: "someone-else" }));
    await expect(completeResourceAssetUpload({ ...actor, intentId: "intent-1" })).rejects.toMatchObject({ status: 404 });

    models.resourceAssetUpload.findUnique.mockResolvedValue(intent({ expiresAt: new Date(Date.now() - 1) }));
    await expect(completeResourceAssetUpload({ ...actor, intentId: "intent-1" })).rejects.toMatchObject({ status: 410 });

    models.resourceAssetUpload.findUnique.mockResolvedValue(intent());
    mocks.head.mockResolvedValue({ pathname: "resource-assets/intent-1/W-logo.svg", size: 999, contentType: "image/svg+xml", etag: "x" });
    await expect(completeResourceAssetUpload({ ...actor, intentId: "intent-1" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to finish when the name was taken, the replaced file vanished, or it changed folders", async () => {
    models.resourceAssetUpload.findUnique.mockResolvedValue(intent());
    models.resourceAsset.findUnique.mockResolvedValue({ id: "taken" });
    await expect(completeResourceAssetUpload({ ...actor, intentId: "intent-1" })).rejects.toMatchObject({ status: 409 });

    models.resourceAssetUpload.findUnique.mockResolvedValue(intent({ assetId: "a1" }));
    models.resourceAsset.findUnique.mockResolvedValue(null);
    await expect(completeResourceAssetUpload({ ...actor, intentId: "intent-1" })).rejects.toMatchObject({ status: 409 });

    models.resourceAsset.findUnique.mockResolvedValue({ id: "a1", folderId: "root" });
    await expect(completeResourceAssetUpload({ ...actor, intentId: "intent-1" })).rejects.toMatchObject({ status: 409 });
    expect(models.resourceAssetVersion.create).not.toHaveBeenCalled();
  });
});

describe("restoreResourceAssetVersion", () => {
  const source = { ...version(1), asset: { id: "a1", folderId: "logos", name: "Motion W", kind: "LOGO", description: null, currentVersionId: "v2" } };

  beforeEach(() => {
    models.resourceAssetVersion.findUnique
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce({ id: "v1", originalName: "W-logo-v1.svg", contentType: "image/svg+xml", sizeBytes: 1001, versionNumber: 1 });
    models.resourceAssetVersion.findFirst.mockResolvedValue({ versionNumber: 2 });
    models.resourceAsset.findUnique.mockResolvedValue({ id: "a1", folderId: "logos", name: "Motion W", currentVersionId: "v2" });
    mocks.copy.mockResolvedValue({ pathname: "resource-assets/a1/restore-x/W-logo-v1.svg", etag: "etag-copy" });
    models.resourceAssetVersion.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "v3", ...data }));
  });

  it("copies the old blob to a fresh path and makes it the newest version", async () => {
    const result = await restoreResourceAssetVersion({ ...actor, assetId: "a1", versionId: "v1" });

    expect(result).toEqual({ assetId: "a1", versionId: "v3", versionNumber: 3, name: "Motion W" });
    expect(mocks.copy).toHaveBeenCalledWith("resource-assets/i1/W-logo-v1.svg", expect.stringMatching(/^resource-assets\/a1\/restore-[0-9a-f-]+\/W-logo-v1\.svg$/), "image/svg+xml");
    expect(models.resourceAssetVersion.create.mock.calls[0]![0].data).toMatchObject({
      versionNumber: 3, storagePath: "resource-assets/a1/restore-x/W-logo-v1.svg", etag: "etag-copy", versionNote: "Restored from version 1", uploadedById: "staff-1",
    });
    expect(models.resourceAsset.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { currentVersionId: "v3", updatedById: "staff-1" } });
    expect(mocks.auditTx).toHaveBeenCalledWith(models, expect.objectContaining({
      action: "resource_asset_version_restored", before: { currentVersionId: "v2", restoredFromVersion: 1 },
    }));
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("deletes the copied blob when the file changed while the restore was prepared", async () => {
    models.resourceAssetVersion.findFirst.mockResolvedValueOnce({ versionNumber: 2 }).mockResolvedValueOnce({ versionNumber: 3 });

    await expect(restoreResourceAssetVersion({ ...actor, assetId: "a1", versionId: "v1" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.del).toHaveBeenCalledWith("resource-assets/a1/restore-x/W-logo-v1.svg");
    expect(models.resourceAssetVersion.create).not.toHaveBeenCalled();
  });

  it("refuses to restore the current version or a version of another asset, before copying anything", async () => {
    models.resourceAssetVersion.findUnique.mockReset().mockResolvedValue({ ...source, asset: { ...source.asset, currentVersionId: "v1" } });
    await expect(restoreResourceAssetVersion({ ...actor, assetId: "a1", versionId: "v1" })).rejects.toMatchObject({ status: 409 });

    models.resourceAssetVersion.findUnique.mockResolvedValue({ ...source, asset: { ...source.asset, id: "other" } });
    await expect(restoreResourceAssetVersion({ ...actor, assetId: "a1", versionId: "v1" })).rejects.toMatchObject({ status: 404 });
    expect(mocks.copy).not.toHaveBeenCalled();
  });
});

describe("toggleResourceAssetFavorite", () => {
  beforeEach(() => {
    models.resourceAsset.findUnique.mockResolvedValue({ id: "a1" });
    models.resourceAssetFavorite.deleteMany.mockResolvedValue({ count: 1 });
    models.resourceAssetFavorite.create.mockResolvedValue({});
  });

  it("adds, then removes, a favorite with an audit row each way", async () => {
    models.resourceAssetFavorite.findUnique.mockResolvedValue(null);
    await expect(toggleResourceAssetFavorite({ ...actor, assetId: "a1" })).resolves.toEqual({ favorited: true });
    expect(models.resourceAssetFavorite.create).toHaveBeenCalledWith({ data: { userId: "staff-1", assetId: "a1" } });
    expect(mocks.audit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "resource_asset_favorite_added" }));

    models.resourceAssetFavorite.findUnique.mockResolvedValue({ id: "fav" });
    await expect(toggleResourceAssetFavorite({ ...actor, assetId: "a1" })).resolves.toEqual({ favorited: false });
    expect(models.resourceAssetFavorite.deleteMany).toHaveBeenCalledWith({ where: { userId: "staff-1", assetId: "a1" } });
    expect(mocks.audit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "resource_asset_favorite_removed" }));
  });

  it("treats a concurrent double-tap as already favorited and 404s a missing asset", async () => {
    models.resourceAssetFavorite.findUnique.mockResolvedValue(null);
    models.resourceAssetFavorite.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }));
    await expect(toggleResourceAssetFavorite({ ...actor, assetId: "a1" })).resolves.toEqual({ favorited: true });
    expect(mocks.audit).not.toHaveBeenCalled();

    models.resourceAssetFavorite.create.mockRejectedValue(new Error("boom"));
    await expect(toggleResourceAssetFavorite({ ...actor, assetId: "a1" })).rejects.toThrow("boom");

    models.resourceAsset.findUnique.mockResolvedValue(null);
    await expect(toggleResourceAssetFavorite({ ...actor, assetId: "nope" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("createResourceAssetFolder", () => {
  beforeEach(() => {
    models.resourceAssetFolder.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "f-new", ...data }));
  });

  it("creates a child of the root by default with a slug path and an audit row", async () => {
    models.resourceAssetFolder.findUnique.mockImplementation(async ({ where }: { where: { path?: string } }) => (where.path === "brand-assets" ? root : null));

    const result = await createResourceAssetFolder({ ...actor, name: "  Social   Templates! " });

    expect(result).toEqual({ id: "f-new", name: "Social Templates!", path: "brand-assets/social-templates", assetCount: 0 });
    expect(models.resourceAssetFolder.create.mock.calls[0]![0].data).toMatchObject({ parentId: "root", createdById: "staff-1" });
    expect(mocks.auditTx).toHaveBeenCalledWith(models, expect.objectContaining({ action: "resource_asset_folder_created", after: expect.objectContaining({ path: "brand-assets/social-templates" }) }));
    expect(transactionCalls[0]!.options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });

  it("refuses duplicates, path separators, symbol-only names, missing parents and nesting past five levels", async () => {
    models.resourceAssetFolder.findUnique.mockImplementation(async ({ where }: { where: { id?: string; path?: string } }) =>
      where.id === "logos" ? logos : where.path === "brand-assets/logos/primary" ? { name: "Primary" } : null);
    await expect(createResourceAssetFolder({ ...actor, name: "Primary", parentId: "logos" })).rejects.toMatchObject({ status: 409, message: "A folder named Primary already exists here." });

    await expect(createResourceAssetFolder({ ...actor, name: "a/b", parentId: "logos" })).rejects.toMatchObject({ status: 400 });
    await expect(createResourceAssetFolder({ ...actor, name: "..", parentId: "logos" })).rejects.toMatchObject({ status: 400 });
    await expect(createResourceAssetFolder({ ...actor, name: "!!!", parentId: "logos" })).rejects.toMatchObject({ status: 400 });
    await expect(createResourceAssetFolder({ ...actor, name: "Ok", parentId: "missing" })).rejects.toMatchObject({ status: 404 });

    models.resourceAssetFolder.findUnique.mockResolvedValue({ id: "deep", path: "brand-assets/a/b/c/d" });
    await expect(createResourceAssetFolder({ ...actor, name: "Too deep", parentId: "deep" })).rejects.toMatchObject({ status: 400 });
    expect(models.resourceAssetFolder.create).not.toHaveBeenCalled();
  });
});
