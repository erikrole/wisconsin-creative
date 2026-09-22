import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, ResourceType, Role } from "@prisma/client";

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

vi.mock("@vercel/blob", async (importOriginal) => ({
  ...await importOriginal<typeof import("@vercel/blob")>(),
  put: vi.fn(),
  head: vi.fn(),
}));

import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { BlobNotFoundError, head, put } from "@vercel/blob";
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
      findUniqueOrThrow: vi.fn(),
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
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-public-store");
  vi.mocked(head).mockRejectedValue(new BlobNotFoundError());
  vi.mocked(put).mockResolvedValue({ url: "https://blob.example/diagram.png" } as never);
  vi.mocked(db.resource.findUnique).mockResolvedValue(null as never);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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
    const result = await previewResourceImport({ manifest: manifest(), actorId: "actor-1", actorRole: Role.ADMIN });

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
    vi.mocked(db.resource.findUnique).mockResolvedValue(existing as never);
    tx.resource.findUnique.mockResolvedValue(existing);
    tx.resource.update.mockResolvedValue(updated);
    mockTransaction(tx);

    await importResource({
      manifest: manifest({ title: "New football guide title", images: [], markdown: "# Updated", expectedUpdatedAt: now.toISOString() }),
      actorId: "actor-1",
      actorRole: Role.STAFF,
    });

    const updateCall = tx.resource.update.mock.calls[0]?.[0];
    expect(updateCall?.data).toMatchObject({ title: "New football guide title", importKey: existing.importKey });
    expect(updateCall?.data).not.toHaveProperty("slug");
  });
});

describe("import safety", () => {
  const actor = { actorId: "actor-1", actorRole: Role.ADMIN };
  const textManifest = (overrides: Record<string, unknown> = {}) => manifest({ markdown: "# Updated", images: [], ...overrides });

  it.each([Role.STUDENT, Role.COLLABORATOR])("rejects %s at the service boundary", async (actorRole) => {
    for (const operation of [previewResourceImport, importResource]) {
      await expect(operation({ ...actor, actorRole, manifest: textManifest() })).rejects.toThrow("Forbidden");
    }
    expect(db.resource.findUnique).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects STAFF access to another author's preview and commit", async () => {
    vi.mocked(db.resource.findUnique).mockResolvedValue(guide({ authorId: "other" }) as never);
    for (const operation of [previewResourceImport, importResource]) {
      await expect(operation({ ...actor, actorRole: Role.STAFF, manifest: textManifest() })).rejects.toThrow("own resources");
    }
    expect(put).not.toHaveBeenCalled();
  });

  it.each([undefined, "2026-09-09T00:00:00.000Z"])("rejects missing/stale version %s before uploading", async (expectedUpdatedAt) => {
    vi.mocked(db.resource.findUnique).mockResolvedValue(guide() as never);
    await expect(importResource({ ...actor, manifest: manifest({ expectedUpdatedAt }), files: new Map([["diagram", imageFile()]]) })).rejects.toThrow("Dry-run again");
    expect(put).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("preserves omitted publication, audience, type and feature settings", async () => {
    const existing = guide({ featured: true, featuredRank: 2, targetRoles: [Role.STUDENT], targetAreas: ["VIDEO"] });
    vi.mocked(db.resource.findUnique).mockResolvedValue(existing as never);
    const tx = transactionClient();
    tx.resource.findUnique.mockResolvedValue(existing);
    tx.resource.update.mockResolvedValue(existing);
    mockTransaction(tx);
    const result = await previewResourceImport({ ...actor, manifest: textManifest({ type: undefined }) });
    expect(result).toMatchObject({ expectedUpdatedAt: now.toISOString(), proposed: { published: true, featured: true, featuredRank: 2, targetRoles: [Role.STUDENT], type: ResourceType.HOW_TO } });
    await importResource({ ...actor, manifest: textManifest({ type: undefined, expectedUpdatedAt: result.expectedUpdatedAt }) });
    expect(tx.resource.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ published: true, featured: true, featuredRank: 2, targetRoles: [Role.STUDENT], targetAreas: ["VIDEO"], type: ResourceType.HOW_TO }) }));
  });

  it("does not write a duplicate update or audit for unchanged content", async () => {
    const existing = guide({ markdown: "# Updated" });
    vi.mocked(db.resource.findUnique).mockResolvedValue(existing as never);
    const tx = transactionClient();
    tx.resource.findUnique.mockResolvedValue(existing);
    tx.resource.findUniqueOrThrow.mockResolvedValue(existing);
    mockTransaction(tx);
    const result = await importResource({ ...actor, manifest: textManifest({ expectedUpdatedAt: now.toISOString() }) });
    expect(result.operation).toBe("unchanged");
    expect(tx.resource.update).not.toHaveBeenCalled();
    expect(createAuditEntryTx).not.toHaveBeenCalled();
  });

  it("rechecks the version inside the transaction", async () => {
    vi.mocked(db.resource.findUnique).mockResolvedValue(guide() as never);
    const tx = transactionClient();
    tx.resource.findUnique.mockResolvedValue(guide({ updatedAt: new Date("2026-09-11T00:00:00Z") }));
    mockTransaction(tx);
    await expect(importResource({ ...actor, manifest: textManifest({ expectedUpdatedAt: now.toISOString() }) })).rejects.toThrow("Dry-run again");
    expect(tx.resource.update).not.toHaveBeenCalled();
  });

  it("preserves Markdown angle destinations and literal code", async () => {
    const markdown = "# Code\n\n`<button>`\n\n[Reference](<https://example.com/a b>)\n\n> [!NOTE]\n> Keep this.";
    const result = await previewResourceImport({ ...actor, manifest: textManifest({ markdown }) });
    expect(result.proposed.markdown).toBe(markdown);
  });

  it("rejects malformed placeholders, undeclared files and ambiguous inputs", async () => {
    await expect(importResource({ ...actor, manifest: textManifest({ markdown: "{{image:bad key}}" }) })).rejects.toThrow("Malformed");
    await expect(importResource({ ...actor, manifest: textManifest(), files: new Map([["extra", imageFile()]]) })).rejects.toThrow("Undeclared");
    await expect(importResource({ ...actor, manifest: manifest({ images: [{ key: "diagram", alt: "Caption", url: "https://lh3.googleusercontent.com/image" }] }), files: new Map([["diagram", imageFile()]]) })).rejects.toThrow("not both");
    expect(put).not.toHaveBeenCalled();
  });

  it("propagates audit failure without claiming a committed import", async () => {
    const tx = transactionClient();
    tx.resource.findUnique.mockResolvedValue(null);
    tx.resource.create.mockResolvedValue(guide());
    mockTransaction(tx);
    vi.mocked(createAuditEntryTx).mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(importResource({ ...actor, manifest: textManifest() })).rejects.toThrow("audit unavailable");
  });

  it("recovers an import-key create race without another guide or audit", async () => {
    const tx = transactionClient();
    const winner = guide({ markdown: "# Updated", published: false });
    tx.resource.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    tx.resource.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("race", { code: "P2002", clientVersion: "test" }));
    tx.resource.findUniqueOrThrow.mockResolvedValue(winner);
    mockTransaction(tx);
    expect((await importResource({ ...actor, manifest: textManifest() })).operation).toBe("unchanged");
    expect(tx.resource.create).toHaveBeenCalledTimes(1);
    expect(createAuditEntryTx).not.toHaveBeenCalled();
  });

  it("checks every remote image before the first Blob upload", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(await imageFile().arrayBuffer(), { headers: { "content-type": "image/png" } }))
      .mockResolvedValueOnce(new Response("invalid image bytes", { headers: { "content-type": "image/png" } })));
    await expect(importResource({ ...actor, manifest: manifest({ markdown: "{{image:one}}\n\n{{image:two}}", images: ["one", "two"].map(key => ({ key, alt: key, url: `https://lh3.googleusercontent.com/${key}` })) }) })).rejects.toThrow("matching");
    expect(put).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("enforces the aggregate remote byte limit before uploading", async () => {
    const bytes = new Uint8Array(7 * 1024 * 1024);
    bytes.set(new Uint8Array(await imageFile().arrayBuffer()));
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(bytes, { headers: { "content-type": "image/png" } })));
    const keys = ["one", "two", "three"];
    await expect(importResource({ ...actor, manifest: manifest({ markdown: keys.map(key => `{{image:${key}}}`).join("\n\n"), images: keys.map(key => ({ key, alt: key, url: `https://lh3.googleusercontent.com/${key}` })) }) })).rejects.toThrow("20MB total");
    expect(put).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
