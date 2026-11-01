import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceType, Role, ShiftArea } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  db: {
    resource: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { createGuide, deleteGuide, getGuide, getGuideAudience, getGuideBySlug, listGuides, slugify, updateGuide } from "@/lib/guides";
import { guidePersonalizationReason, sortGuidesForAudience } from "@/lib/guide-ranking";

const now = new Date("2026-10-30T12:00:00.000Z");
const include = { author: { select: { id: true, name: true } }, lastVerifiedBy: { select: { id: true, name: true } } };

beforeEach(() => {
  mocks.db.resource.findMany.mockResolvedValue([]);
  mocks.db.resource.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "g-new", ...data }));
  mocks.db.resource.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "g1", ...data }));
  mocks.db.resource.delete.mockResolvedValue({ id: "g1" });
});

describe("slugify and createGuide", () => {
  it("turns a title into a url slug and picks the first free one in that family", async () => {
    expect(slugify("  Camera Care: FX3 & FX6!  ")).toBe("camera-care-fx3-fx6");
    expect(slugify("---")).toBe("");

    mocks.db.resource.findMany.mockResolvedValue([{ slug: "camera-care" }, { slug: "camera-care-2" }, { slug: "camera-care-4" }]);
    const guide = await createGuide({ title: "Camera care", category: "Gear", authorId: "staff-1", markdown: "<script>x</script>Keep the cap on." });

    expect(guide.slug).toBe("camera-care-3");
    expect(mocks.db.resource.findMany).toHaveBeenCalledWith({
      where: { OR: [{ slug: "camera-care" }, { slug: { startsWith: "camera-care-" } }] },
      select: { slug: true },
    });
    expect(mocks.db.resource.create.mock.calls[0]![0]).toMatchObject({
      data: { type: ResourceType.GENERAL, content: [], targetRoles: [], targetAreas: [], featured: false, featuredRank: null, published: false, authorId: "staff-1" },
      include,
    });
    expect(guide.markdown).not.toContain("<script>");
    expect(guide.markdown).toContain("Keep the cap on.");
  });

  it("falls back to 'guide' for a symbol-only title and keeps a rank only on featured guides", async () => {
    await createGuide({ title: "!!!", category: "Gear", authorId: "staff-1", featured: false, featuredRank: 2 });
    expect(mocks.db.resource.create.mock.calls[0]![0].data).toMatchObject({ slug: "guide", featuredRank: null });

    await createGuide({ title: "Hot", category: "Gear", authorId: "staff-1", featured: true, featuredRank: 2, published: true, type: ResourceType.SOP, targetRoles: [Role.STUDENT] });
    expect(mocks.db.resource.create.mock.calls[1]![0].data).toMatchObject({ slug: "hot", featured: true, featuredRank: 2, published: true, type: ResourceType.SOP, targetRoles: [Role.STUDENT] });
  });

  it("gives up on numbered suffixes after a thousand and uses a random one", async () => {
    mocks.db.resource.findMany.mockResolvedValue([{ slug: "x" }, ...Array.from({ length: 999 }, (_, i) => ({ slug: `x-${i + 2}` }))]);

    const guide = await createGuide({ title: "x", category: "Gear", authorId: "staff-1" });

    expect(guide.slug).toMatch(/^x-[0-9a-f]{8}$/);
  });
});

describe("getGuide / getGuideBySlug / deleteGuide", () => {
  it("looks up by id or slug with author and verifier, and 404s when missing", async () => {
    mocks.db.resource.findUnique.mockResolvedValue({ id: "g1" });
    await expect(getGuide("g1")).resolves.toEqual({ id: "g1" });
    expect(mocks.db.resource.findUnique).toHaveBeenCalledWith({ where: { id: "g1" }, include });
    await expect(getGuideBySlug("camera-care")).resolves.toEqual({ id: "g1" });
    expect(mocks.db.resource.findUnique).toHaveBeenLastCalledWith({ where: { slug: "camera-care" }, include });

    mocks.db.resource.findUnique.mockResolvedValue(null);
    await expect(getGuide("nope")).rejects.toMatchObject({ status: 404 });
    await expect(getGuideBySlug("nope")).rejects.toMatchObject({ status: 404 });
    await expect(deleteGuide("nope")).rejects.toMatchObject({ status: 404 });
    expect(mocks.db.resource.delete).not.toHaveBeenCalled();
  });

  it("deletes an existing guide", async () => {
    mocks.db.resource.findUnique.mockResolvedValue({ id: "g1" });
    await deleteGuide("g1");
    expect(mocks.db.resource.delete).toHaveBeenCalledWith({ where: { id: "g1" } });
  });
});

describe("updateGuide", () => {
  const current = (extra: Record<string, unknown> = {}) => ({
    id: "g1", authorId: "staff-1", slug: "camera-care", title: "Camera care", updatedAt: now, featured: false, featuredRank: null, ...extra,
  });

  beforeEach(() => {
    mocks.db.resource.findUnique.mockResolvedValue(current());
  });

  it("re-slugs on a title change (skipping its own slug), sanitizes markdown and writes only the patched fields", async () => {
    mocks.db.resource.findMany.mockResolvedValue([{ slug: "lens-care" }]);

    await updateGuide("g1", { title: "Lens care", markdown: "Wipe <b>gently</b>", targetAreas: [ShiftArea.VIDEO], published: true }, Role.ADMIN, "admin-1");

    expect(mocks.db.resource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ NOT: { id: "g1" } }) }));
    const data = mocks.db.resource.update.mock.calls[0]![0].data;
    expect(data).toMatchObject({ title: "Lens care", slug: "lens-care-2", targetAreas: [ShiftArea.VIDEO], published: true });
    expect(data).not.toHaveProperty("category");
    expect(data).not.toHaveProperty("featuredRank");
    expect(data).not.toHaveProperty("lastVerifiedAt");
  });

  it("keeps the slug when the title is unchanged", async () => {
    await updateGuide("g1", { title: "Camera care", category: "Gear" }, Role.ADMIN, "admin-1");

    expect(mocks.db.resource.findMany).not.toHaveBeenCalled();
    expect(mocks.db.resource.update.mock.calls[0]![0].data).toEqual({ title: "Camera care", category: "Gear" });
  });

  it("lets staff edit only their own guides while admins edit any", async () => {
    await expect(updateGuide("g1", { category: "Gear" }, Role.STAFF, "staff-2")).rejects.toMatchObject({ status: 403 });
    await expect(updateGuide("g1", { category: "Gear" }, Role.STAFF, "staff-1")).resolves.toBeTruthy();
    await expect(updateGuide("g1", { category: "Gear" }, Role.ADMIN, "admin-9")).resolves.toBeTruthy();
    mocks.db.resource.findUnique.mockResolvedValue(null);
    await expect(updateGuide("g1", { category: "Gear" }, Role.ADMIN, "admin-9")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a save based on a stale copy", async () => {
    await expect(updateGuide("g1", { category: "Gear", expectedUpdatedAt: "2026-10-29T00:00:00.000Z" }, Role.ADMIN, "a")).rejects.toMatchObject({ status: 409 });
    await expect(updateGuide("g1", { category: "Gear", expectedUpdatedAt: now.toISOString() }, Role.ADMIN, "a")).resolves.toBeTruthy();
    expect(mocks.db.resource.update).toHaveBeenCalledTimes(1);
  });

  it("featuring a guide with a rank stores both; unfeaturing clears the rank", async () => {
    await updateGuide("g1", { featured: true, featuredRank: 3 }, Role.ADMIN, "a");
    expect(mocks.db.resource.update.mock.calls[0]![0].data).toEqual({ featured: true, featuredRank: 3 });

    mocks.db.resource.findUnique.mockResolvedValue(current({ featured: true, featuredRank: 3 }));
    await updateGuide("g1", { featured: false }, Role.ADMIN, "a");
    expect(mocks.db.resource.update.mock.calls[1]![0].data).toEqual({ featured: false, featuredRank: null });
  });
});

describe("getGuideAudience", () => {
  it("reads the person's role and areas, falling back to the session role for an unknown user", async () => {
    mocks.db.user.findUnique.mockResolvedValue({ role: Role.STAFF, primaryArea: ShiftArea.PHOTO, areaAssignments: [{ area: ShiftArea.PHOTO, isPrimary: true }, { area: ShiftArea.VIDEO, isPrimary: false }] });
    await expect(getGuideAudience("u1", Role.STUDENT)).resolves.toEqual({
      role: Role.STAFF, primaryArea: ShiftArea.PHOTO, areaAssignments: [{ area: ShiftArea.PHOTO, isPrimary: true }, { area: ShiftArea.VIDEO, isPrimary: false }],
    });

    mocks.db.user.findUnique.mockResolvedValue(null);
    await expect(getGuideAudience("ghost", Role.STUDENT)).resolves.toEqual({ role: Role.STUDENT, primaryArea: null, areaAssignments: [] });
  });
});

describe("listGuides without a search", () => {
  it("applies published and category filters, summarizes each guide and labels personalization", async () => {
    mocks.db.resource.findMany.mockResolvedValue([
      { id: "g1", title: "Photo workflow", slug: "photo-workflow", type: "SOP", category: "Workflow", content: [], markdown: "# Photo\n\nShoot RAW. ".repeat(300),
        targetRoles: [], targetAreas: [ShiftArea.PHOTO], featured: false, featuredRank: null, lastVerifiedAt: null, lastVerifiedBy: null, published: true, createdAt: now, updatedAt: now, author: { id: "a", name: "Erik" } },
      { id: "g2", title: "Legacy", slug: "legacy", type: "GENERAL", category: "Workflow", content: [{ type: "paragraph", content: [{ type: "text", text: "Old block content", styles: {} }] }], markdown: null,
        targetRoles: [Role.STAFF], targetAreas: [], featured: true, featuredRank: 1, lastVerifiedAt: null, lastVerifiedBy: null, published: true, createdAt: now, updatedAt: now, author: { id: "a", name: "Erik" } },
    ]);

    const guides = await listGuides({ published: true, category: "Workflow", audience: { role: Role.STUDENT, primaryArea: ShiftArea.PHOTO, areaAssignments: [] } });

    expect(mocks.db.resource.findMany.mock.calls[0]![0].where).toEqual({ published: true, category: "Workflow" });
    // Featured first, then the photo student's own area.
    expect(guides.map((g) => g.id)).toEqual(["g2", "g1"]);
    expect(guides[0]!.personalizationReason).toBe("Featured");
    expect(guides[1]!.personalizationReason).toBe("For Photo");
    expect(guides[1]!.searchText.length).toBeLessThanOrEqual(2000);
    expect(guides[1]!.searchText).toMatch(/^photo shoot raw\./);
    expect(guides[1]!.summary.length).toBeGreaterThan(0);
    expect(guides[0]!.summary).toContain("Old block content");
    expect(guides[1]).not.toHaveProperty("markdown");
  });

  it("returns guides in updated order with a General label when there is no audience", async () => {
    mocks.db.resource.findMany.mockResolvedValue([
      { id: "g1", title: "A", slug: "a", type: "GENERAL", category: "C", content: [], markdown: "", targetRoles: [Role.STUDENT], targetAreas: [], featured: false, featuredRank: null, lastVerifiedAt: null, lastVerifiedBy: null, published: true, createdAt: now, updatedAt: now, author: { id: "a", name: "Erik" } },
    ]);

    const guides = await listGuides({});

    expect(guides[0]!.personalizationReason).toBe("General");
    expect(mocks.db.resource.findMany.mock.calls[0]![0].orderBy).toEqual({ updatedAt: "desc" });
  });
});

describe("guide ranking labels", () => {
  const guide = (extra: Record<string, unknown>) => ({ id: "g", title: "t", targetRoles: [], targetAreas: [], featured: false, featuredRank: null, updatedAt: now, ...extra });

  it("explains why a guide is shown: assigned area beats role, which beats general", () => {
    const audience = { role: Role.STAFF, primaryArea: null, areaAssignments: [{ area: ShiftArea.LIVE_PRODUCTION }] };
    expect(guidePersonalizationReason(guide({ targetAreas: [ShiftArea.LIVE_PRODUCTION], targetRoles: [Role.STAFF] }), audience)).toBe("For Live Production");
    expect(guidePersonalizationReason(guide({ targetRoles: [Role.STAFF] }), audience)).toBe("For Staff");
    expect(guidePersonalizationReason(guide({ targetRoles: [Role.STUDENT] }), audience)).toBe("General");
  });

  it("orders featured guides by rank with unranked last, then by fit, recency and title", () => {
    const audience = { role: Role.STUDENT, primaryArea: ShiftArea.VIDEO, areaAssignments: [{ area: ShiftArea.SOCIAL }] };
    const older = new Date("2026-01-01");
    const sorted = sortGuidesForAudience([
      guide({ id: "unranked", featured: true }),
      guide({ id: "ranked2", featured: true, featuredRank: 2 }),
      guide({ id: "ranked1", featured: true, featuredRank: 1 }),
      guide({ id: "other-role", targetRoles: [Role.STAFF], targetAreas: [ShiftArea.GRAPHICS] }),
      guide({ id: "social", targetAreas: [ShiftArea.SOCIAL] }),
      guide({ id: "video", targetAreas: [ShiftArea.VIDEO], targetRoles: [Role.STUDENT] }),
      guide({ id: "general-b", title: "B" }),
      guide({ id: "general-a", title: "A" }),
      guide({ id: "general-old", title: "A", updatedAt: older }),
    ], audience);

    expect(sorted.map((g) => g.id)).toEqual(["ranked1", "ranked2", "unranked", "video", "social", "general-a", "general-b", "general-old", "other-role"]);
  });
});
