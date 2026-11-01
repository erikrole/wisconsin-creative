import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { jsonRequest, routeCtx, authUser } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getVersion: vi.fn(),
  getBlob: vi.fn(),
  storageToken: vi.fn(),
  handleUpload: vi.fn(),
  put: vi.fn(),
  checkRateLimit: vi.fn(),
  audit: vi.fn(),
  guides: { getGuide: vi.fn(), getGuideBySlug: vi.fn(), updateGuide: vi.fn(), deleteGuide: vi.fn() },
  db: { resourceAssetUpload: { findUnique: vi.fn() } },
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/resource-assets", () => ({ getResourceAssetVersion: mocks.getVersion }));
vi.mock("@/lib/resource-assets-storage", () => ({
  getResourceAssetBlob: mocks.getBlob,
  assertResourceAssetStorageConfigured: mocks.storageToken,
}));
vi.mock("@vercel/blob/client", () => ({ handleUpload: mocks.handleUpload }));
vi.mock("@vercel/blob", () => ({ put: mocks.put }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blob")>()),
  publicBlobAuth: () => ({ token: "blob-token" }),
}));
vi.mock("@/lib/guides", () => mocks.guides);

import { HttpError } from "@/lib/http";
import { GET as download } from "@/app/api/resources/assets/[id]/download/route";
import { POST as uploadToken } from "@/app/api/resources/assets/upload-token/route";
import { POST as uploadImage } from "@/app/api/resources/upload-image/route";
import { GET as getGuide, PATCH as patchGuide, DELETE as deleteGuide } from "@/app/api/resources/[id]/route";

const staff = authUser(Role.STAFF);
const student = authUser(Role.STUDENT);

beforeEach(() => {
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
});

describe("GET /api/resources/assets/[id]/download", () => {
  const stream = () => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("bytes")); c.close(); } });
  const get = (query = "", user = staff) => {
    mocks.requireAuth.mockResolvedValue(user);
    return download(jsonRequest(`/api/resources/assets/a1/download${query}`, "GET"), routeCtx({ id: "a1" }));
  };

  beforeEach(() => {
    mocks.getVersion.mockResolvedValue({ storagePath: "resource-assets/i/W logo.pdf", originalName: 'W "logo" ü.pdf', contentType: "application/pdf" });
    mocks.getBlob.mockResolvedValue({ stream: stream(), blob: { size: 5 } });
  });

  it("streams a PDF inline for the preview dialog with the stored length and a safe filename", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("bytes");
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Length")).toBe("5");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(res.headers.get("Content-Disposition")).toBe(`inline; filename="W--logo---.pdf"; filename*=UTF-8''${encodeURIComponent('W -logo- ü.pdf')}`);
    expect(mocks.getVersion).toHaveBeenCalledWith("a1", null);
  });

  it("forces an attachment with ?download=1 and for non-previewable types, and reads a chosen version", async () => {
    let res = await get("?download=1&versionId=v1");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(mocks.getVersion).toHaveBeenCalledWith("a1", "v1");

    mocks.getVersion.mockResolvedValue({ storagePath: "p", originalName: "deck.pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    mocks.getBlob.mockResolvedValue({ stream: stream(), blob: { size: 5 } });
    res = await get();
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="deck.pptx"; filename*=UTF-8\'\'deck.pptx');
  });

  it("sandboxes SVG so an uploaded file cannot run script on our origin", async () => {
    mocks.getVersion.mockResolvedValue({ storagePath: "p", originalName: "mark.svg", contentType: "image/svg+xml" });

    const res = await get();

    expect(res.headers.get("Content-Security-Policy")).toBe("sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    expect(res.headers.get("Content-Disposition")).toMatch(/^inline;/);
  });

  it("404s when the blob is gone, lets students view, and gates collaborators on the brand-assets capability", async () => {
    mocks.getBlob.mockResolvedValue(null);
    expect((await get()).status).toBe(404);

    mocks.getBlob.mockResolvedValue({ stream: stream(), blob: { size: 5 } });
    expect((await get("", student)).status).toBe(200);

    const collaborator = { ...authUser(Role.COLLABORATOR), collaboratorPolicy: { status: "ACTIVE", capabilities: [] } };
    expect((await get("", collaborator)).status).toBe(403);
  });
});

describe("POST /api/resources/assets/upload-token", () => {
  const intent = (extra: Record<string, unknown> = {}) => ({
    id: "intent-1", actorId: staff.id, status: "PENDING", storagePath: "resource-assets/intent-1/W-logo.svg",
    contentType: "image/svg+xml", sizeBytes: 1234, expiresAt: new Date(Date.now() + 60_000), ...extra,
  });
  const generate = async (clientPayload: string | undefined, pathname = "resource-assets/intent-1/W-logo.svg") => {
    mocks.handleUpload.mockImplementation(async ({ onBeforeGenerateToken }: { onBeforeGenerateToken: (p: string, c?: string) => Promise<unknown> }) => ({
      type: "blob.generate-client-token", clientToken: JSON.stringify(await onBeforeGenerateToken(pathname, clientPayload)),
    }));
    const res = await uploadToken(jsonRequest("/api/resources/assets/upload-token", "POST", { type: "blob.generate-client-token", payload: {} }), routeCtx({}));
    return { res, body: await res.json() };
  };

  beforeEach(() => {
    mocks.storageToken.mockReturnValue("rw-token");
    mocks.db.resourceAssetUpload.findUnique.mockResolvedValue(intent());
  });

  it("issues a client token pinned to the pending intent's path, type, size and expiry", async () => {
    const { res, body } = await generate(JSON.stringify({ intentId: "intent-1" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(JSON.parse(body.clientToken)).toMatchObject({
      allowedContentTypes: ["image/svg+xml"], maximumSizeInBytes: 1234, addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60,
    });
    expect(mocks.handleUpload.mock.calls[0]![0].token).toBe("rw-token");
  });

  it.each([
    ["a malformed payload", undefined, {}, 400],
    ["someone else's intent", JSON.stringify({ intentId: "intent-1" }), { actorId: "other" }, 404],
    ["a completed intent", JSON.stringify({ intentId: "intent-1" }), { status: "COMPLETED" }, 409],
    ["an expired intent", JSON.stringify({ intentId: "intent-1" }), { expiresAt: new Date(Date.now() - 1) }, 410],
  ])("refuses %s", async (_label, payload, patch, status) => {
    mocks.db.resourceAssetUpload.findUnique.mockResolvedValue(intent(patch));

    const { res } = await generate(payload);

    expect(res.status).toBe(status);
  });

  it("refuses a path that differs from the reserved one", async () => {
    const { res } = await generate(JSON.stringify({ intentId: "intent-1" }), "resource-assets/intent-1/evil.html");

    expect(res.status).toBe(400);
  });

  it("is staff only and fails closed when storage is not configured", async () => {
    mocks.requireAuth.mockResolvedValue(student);
    expect((await uploadToken(jsonRequest("/api/resources/assets/upload-token", "POST", {}), routeCtx({}))).status).toBe(403);

    mocks.requireAuth.mockResolvedValue(staff);
    mocks.storageToken.mockImplementation(() => { throw new HttpError(503, "Brand asset storage is not configured."); });
    expect((await uploadToken(jsonRequest("/api/resources/assets/upload-token", "POST", {}), routeCtx({}))).status).toBe(503);
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });
});

describe("POST /api/resources/upload-image", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
  const upload = (file: File | null) => {
    const form = new FormData();
    if (file) form.set("file", file);
    const req = new Request("https://app.example.com/api/resources/upload-image", {
      method: "POST", headers: { host: "app.example.com", origin: "https://app.example.com" }, body: form,
    });
    return uploadImage(req, routeCtx({}));
  };

  beforeEach(() => {
    mocks.put.mockResolvedValue({ url: "https://blob.example/resources/hero.png" });
  });

  it("stores a real PNG publicly under a sanitized name and returns its URL", async () => {
    const res = await upload(new File([png], "../Hero Shot (1).png", { type: "image/png" }));

    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe("https://blob.example/resources/hero.png");
    const [path, , options] = mocks.put.mock.calls[0]!;
    expect(path).toMatch(/^resources\/\d+-Hero-Shot-1-\.png$/);
    expect(options).toEqual({ token: "blob-token", access: "public" });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`resource:upload:${staff.id}`, { max: 30, windowMs: 5 * 60_000 });
  });

  it("refuses SVG by type, a faked PNG by its bytes, oversized files and a missing file", async () => {
    expect((await upload(new File([png], "mark.svg", { type: "image/svg+xml" }))).status).toBe(400);
    expect((await upload(new File([new TextEncoder().encode("<script>alert(1)</script>")], "x.png", { type: "image/png" }))).status).toBe(400);
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    expect((await upload(big)).status).toBe(413);
    expect((await upload(null)).status).toBe(400);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("is staff only and rate-limited per uploader", async () => {
    mocks.requireAuth.mockResolvedValue(student);
    expect((await upload(new File([png], "a.png", { type: "image/png" }))).status).toBe(403);

    mocks.requireAuth.mockResolvedValue(staff);
    mocks.checkRateLimit.mockResolvedValue({ allowed: false });
    expect((await upload(new File([png], "a.png", { type: "image/png" }))).status).toBe(429);
    expect(mocks.put).not.toHaveBeenCalled();
  });
});

describe("/api/resources/[id] guide routes", () => {
  const guide = { id: "c" + "a".repeat(24), slug: "camera-care", title: "Camera care", type: "GUIDE", category: "Gear", published: false, featured: false, featuredRank: null, targetRoles: [], targetAreas: [], lastVerifiedAt: null, lastVerifiedById: null };

  beforeEach(() => {
    mocks.guides.getGuide.mockResolvedValue(guide);
    mocks.guides.getGuideBySlug.mockResolvedValue(guide);
    mocks.guides.updateGuide.mockResolvedValue({ ...guide, title: "Camera care 2", published: true });
    mocks.guides.deleteGuide.mockResolvedValue(undefined);
  });

  it("looks up by cuid or by slug, and hides drafts from students", async () => {
    expect((await getGuide(jsonRequest(`/api/resources/${guide.id}`, "GET"), routeCtx({ id: guide.id }))).status).toBe(200);
    expect(mocks.guides.getGuide).toHaveBeenCalledWith(guide.id);

    expect((await getGuide(jsonRequest("/api/resources/camera-care", "GET"), routeCtx({ id: "camera-care" }))).status).toBe(200);
    expect(mocks.guides.getGuideBySlug).toHaveBeenCalledWith("camera-care");

    mocks.requireAuth.mockResolvedValue(student);
    expect((await getGuide(jsonRequest("/api/resources/camera-care", "GET"), routeCtx({ id: "camera-care" }))).status).toBe(404);
    mocks.guides.getGuideBySlug.mockResolvedValue({ ...guide, published: true });
    expect((await getGuide(jsonRequest("/api/resources/camera-care", "GET"), routeCtx({ id: "camera-care" }))).status).toBe(200);
  });

  it("PATCH records before and after snapshots of the fields that matter", async () => {
    const res = await patchGuide(jsonRequest(`/api/resources/${guide.id}`, "PATCH", { title: "Camera care 2", published: true }), routeCtx({ id: guide.id }));

    expect(res.status).toBe(200);
    expect(mocks.guides.updateGuide).toHaveBeenCalledWith(guide.id, { title: "Camera care 2", published: true }, Role.STAFF, staff.id);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "resource_updated", entityId: guide.id,
      before: expect.objectContaining({ title: "Camera care", published: false }),
      after: expect.objectContaining({ title: "Camera care 2", published: true }),
    }));
  });

  it("PATCH rejects bad input before reading the guide, and students cannot edit", async () => {
    expect((await patchGuide(jsonRequest(`/api/resources/${guide.id}`, "PATCH", { title: "" }), routeCtx({ id: guide.id }))).status).toBe(400);
    expect(mocks.guides.getGuide).not.toHaveBeenCalled();

    mocks.requireAuth.mockResolvedValue(student);
    expect((await patchGuide(jsonRequest(`/api/resources/${guide.id}`, "PATCH", { title: "x" }), routeCtx({ id: guide.id }))).status).toBe(403);
  });

  it("DELETE is admin only and audits what was removed", async () => {
    expect((await deleteGuide(jsonRequest(`/api/resources/${guide.id}`, "DELETE"), routeCtx({ id: guide.id }))).status).toBe(403);
    expect(mocks.guides.deleteGuide).not.toHaveBeenCalled();

    mocks.requireAuth.mockResolvedValue(authUser(Role.ADMIN));
    const res = await deleteGuide(jsonRequest(`/api/resources/${guide.id}`, "DELETE"), routeCtx({ id: guide.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ deleted: true });
    expect(mocks.guides.deleteGuide).toHaveBeenCalledWith(guide.id);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "resource_deleted", before: { title: "Camera care", type: "GUIDE", category: "Gear" } }));
  });
});
