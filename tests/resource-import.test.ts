import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceType, Role } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  db: {
    resource: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntryTx: vi.fn(),
}));

vi.mock("@/lib/serialization", () => ({
  withSerializationRetry: async (operation: () => Promise<unknown>) => operation(),
}));

vi.mock("@/lib/blob", () => ({
  downloadImageToBlob: vi.fn(),
  hasValidImageMagic: vi.fn(),
  isAllowedImageType: vi.fn(),
  isBlobUrl: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
}));

import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { hasValidImageMagic, isAllowedImageType } from "@/lib/blob";
import { put } from "@vercel/blob";
import { importResource, previewResourceImport } from "@/lib/resource-import";
import { resourceImportManifestSchema } from "@/lib/validation";

const now = new Date("2026-09-10T12:00:00.000Z");

function manifest(overrides: Record<string, unknown> = {}) {
  return resourceImportManifestSchema.parse({
    importKey: "google-docs:creative-guides:football",
    title: "Football Clip Naming Guide",
    type: ResourceType.HOW_TO,
    category: "Naming Guides",
    markdown: "# Football\n\n{{image:diagram}}",
    images: [{ key: "diagram", alt: "Football naming format" }],
    ...overrides,
  });
}

function guide(overrides: Record<string, unknown> = {}) {
  return {
    id: "resource-1",
    authorId: "actor-1",
    title: "Football Clip Naming Guide",
    slug: "football-clip-naming-guide",
    type: ResourceType.HOW_TO,
    category: "Naming Guides",
    importKey: "google-docs:creative-guides:football",
    markdown: "# Football\n\n![Football naming format](https://blob.example/diagram.png)",
    content: [],
    targetRoles: [],
    targetAreas: [],
    featured: false,
    featuredRank: null,
    published: true,
    updatedAt: now,
    createdAt: now,
    lastVerifiedAt: null,
    lastVerifiedById: null,
    author: { id: "actor-1", name: "Erik Role" },
    lastVerifiedBy: null,
    ...overrides,
  };
}

function imageFile() {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
    "diagram.png",
    { type: "image/png" },
  );
}

function transactionClient() {
  return {
    resource: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
}

function mockTransaction(tx: ReturnType<typeof transactionClient>) {
  const transaction = db.$transaction as unknown as {
    mockImplementation: (implementation: (callback: (client: unknown) => Promise<unknown>) => Promise<unknown>) => void;
  };
  transaction.mockImplementation(async (callback) => callback(tx));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAllowedImageType).mockReturnValue(true);
  vi.mocked(hasValidImageMagic).mockResolvedValue(true);
  vi.mocked(put).mockResolvedValue({ url: "https://blob.example/diagram.png" } as never);
  vi.mocked(db.resource.findUnique).mockResolvedValue(null as never);
});

describe("resource import manifest", () => {
  it("rejects duplicate image keys and undeclared placeholders", () => {
    expect(() => resourceImportManifestSchema.parse({
      ...manifest(),
      images: [
        { key: "diagram", alt: "one" },
        { key: "diagram", alt: "two" },
      ],
    })).toThrow();
  });

  it("previews an import without writing Prisma or Blob state", async () => {
    const result = await previewResourceImport(manifest());

    expect(result).toMatchObject({
      operation: "create",
      resourceId: null,
      slug: "football-clip-naming-guide",
      imageCount: 1,
      missingImageKeys: ["diagram"],
    });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});

describe("importResource", () => {
  it("rejects an undeclared image placeholder before any write", async () => {
    await expect(importResource({
      manifest: manifest({ images: [], markdown: "# Football\n\n{{image:missing}}" }),
      actorId: "actor-1",
      actorRole: Role.ADMIN,
    })).rejects.toThrow("undeclared image");

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("creates a resource and replaces image placeholders with durable URLs", async () => {
    const tx = transactionClient();
    const created = guide();
    tx.resource.findUnique.mockResolvedValue(null);
    tx.resource.create.mockResolvedValue(created);
    mockTransaction(tx);

    const result = await importResource({
      manifest: manifest(),
      files: new Map([["diagram", imageFile()]]),
      actorId: "actor-1",
      actorRole: Role.ADMIN,
    });

    expect(result.operation).toBe("create");
    expect(tx.resource.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        importKey: "google-docs:creative-guides:football",
        markdown: expect.stringContaining("https://blob.example/diagram.png"),
      }),
    }));
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "resource_created", entityId: "resource-1" }),
    );
  });

  it("updates the import-key match without changing its stable slug", async () => {
    const tx = transactionClient();
    const existing = {
      id: "resource-1",
      authorId: "actor-1",
      title: "Old football guide title",
      slug: "football-clip-naming-guide",
      type: ResourceType.HOW_TO,
      category: "Naming Guides",
      importKey: "google-docs:creative-guides:football",
      published: false,
      featured: false,
      featuredRank: null,
      targetRoles: [],
      targetAreas: [],
      updatedAt: now,
    };
    const updated = guide({ title: "New football guide title" });
    tx.resource.findUnique.mockResolvedValue(existing);
    tx.resource.update.mockResolvedValue(updated);
    mockTransaction(tx);

    await importResource({
      manifest: manifest({ title: "New football guide title", images: [], markdown: "# Updated" }),
      actorId: "actor-1",
      actorRole: Role.STAFF,
    });

    const updateCall = tx.resource.update.mock.calls[0]?.[0];
    expect(updateCall?.data).toMatchObject({ title: "New football guide title", importKey: existing.importKey });
    expect(updateCall?.data).not.toHaveProperty("slug");
  });
});
