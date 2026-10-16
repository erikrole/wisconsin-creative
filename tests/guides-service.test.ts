import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { listGuides, updateGuide } from "@/lib/guides";

vi.mock("@/lib/db", () => ({
  db: {
    resource: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const now = new Date("2026-05-10T12:00:00.000Z");

function guideListRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "guide-1",
    title: "Camera setup",
    slug: "camera-setup",
    category: "SOP",
    content: [],
    markdown: "",
    targetRoles: [],
    targetAreas: [],
    featured: false,
    featuredRank: null,
    lastVerifiedAt: null,
    lastVerifiedBy: null,
    published: true,
    createdAt: now,
    updatedAt: now,
    author: { id: "author-1", name: "Erik Role" },
    ...overrides,
  };
}

function currentGuide(overrides: Record<string, unknown> = {}) {
  return {
    id: "guide-1",
    authorId: "author-1",
    slug: "camera-setup",
    title: "Camera setup",
    updatedAt: now,
    featured: true,
    featuredRank: 7,
    ...overrides,
  };
}

describe("guide service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searches full guide Markdown beyond the visible summary", async () => {
    vi.mocked(db.resource.findMany).mockResolvedValue([
      guideListRow({
        markdown: [
          "# Camera setup",
          "",
          "Intro copy ".repeat(30),
          "",
          "The hidden calibration phrase is minn-cam-reset.",
        ].join("\n"),
      }),
    ] as never);

    const guides = await listGuides({ published: true, search: "minn-cam-reset" });

    expect(guides).toHaveLength(1);
    expect(guides[0]?.id).toBe("guide-1");
    expect(guides[0]?.summary).not.toContain("minn-cam-reset");
    expect(db.resource.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        published: true,
        OR: expect.arrayContaining([
          { markdown: { contains: "minn-cam-reset", mode: "insensitive" } },
          { author: { name: { contains: "minn-cam-reset", mode: "insensitive" } } },
        ]),
      }),
    }));
  });

  it("preserves featured rank when only the rank changes on an already featured guide", async () => {
    vi.mocked(db.resource.findUnique).mockResolvedValue(currentGuide() as never);
    vi.mocked(db.resource.update).mockResolvedValue({} as never);

    await updateGuide("guide-1", { featuredRank: 3 }, Role.ADMIN, "admin-1");

    const updateCall = vi.mocked(db.resource.update).mock.calls[0]?.[0];
    expect(updateCall?.data).toMatchObject({ featuredRank: 3 });
    expect(updateCall?.data).not.toHaveProperty("featured");
  });

  it("clears stale featured rank when a guide is unfeatured without sending rank", async () => {
    vi.mocked(db.resource.findUnique).mockResolvedValue(currentGuide() as never);
    vi.mocked(db.resource.update).mockResolvedValue({} as never);

    await updateGuide("guide-1", { featured: false }, Role.ADMIN, "admin-1");

    const updateCall = vi.mocked(db.resource.update).mock.calls[0]?.[0];
    expect(updateCall?.data).toMatchObject({
      featured: false,
      featuredRank: null,
    });
  });
});
