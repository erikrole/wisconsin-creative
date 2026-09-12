import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/resource-import", () => ({ importResource: vi.fn(), previewResourceImport: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
import { requireAuth } from "@/lib/auth";
import { importResource, previewResourceImport } from "@/lib/resource-import";
import { checkRateLimit } from "@/lib/rate-limit";
import { HttpError } from "@/lib/http";
import { POST } from "@/app/api/resources/import/route";

const manifest = { importKey: "test:route", title: "Guide", category: "Testing", markdown: "# Guide", images: [] };
const actor = { id: "actor-1", name: "Test Admin", email: "test@example.com", role: Role.ADMIN, avatarUrl: null };
const context = { params: Promise.resolve({}) };
function request(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request("https://app.example.com/api/resources/import", { method: "POST", headers: { origin: "https://app.example.com", ...headers }, body });
}
const json = (value: unknown) => request(JSON.stringify(value), { "content-type": "application/json" });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(actor);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(previewResourceImport).mockResolvedValue({ operation: "create" } as never);
  vi.mocked(importResource).mockResolvedValue({ operation: "create", guide: { id: "guide-1" } } as never);
});

describe("resource import HTTP boundary", () => {
  it("defaults JSON and multipart to no-write previews", async () => {
    expect((await POST(json({ manifest }), context)).status).toBe(200);
    const form = new FormData();
    form.set("manifest", JSON.stringify(manifest));
    expect((await POST(request(form), context)).status).toBe(200);
    expect(previewResourceImport).toHaveBeenCalledTimes(2);
    expect(previewResourceImport).toHaveBeenCalledWith(expect.objectContaining({ actorId: actor.id, actorRole: actor.role }));
    expect(importResource).not.toHaveBeenCalled();
  });
  it("requires explicit commit and returns created status", async () => {
    const response = await POST(json({ manifest, dryRun: false }), context);
    expect(response.status).toBe(201);
    expect((await response.json()).meta.operation).toBe("create");
    expect(previewResourceImport).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated callers and cross-origin requests", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new HttpError(401, "Authentication required"));
    expect((await POST(json({ manifest }), context)).status).toBe(401);
    expect((await POST(request("{}", { origin: "https://evil.example", "content-type": "application/json" }), context)).status).toBe(403);
    expect(importResource).not.toHaveBeenCalled();
  });
  it.each([Role.STUDENT, Role.COLLABORATOR])("denies %s", async (role) => {
    vi.mocked(requireAuth).mockResolvedValue({ ...actor, role });
    expect((await POST(json({ manifest }), context)).status).toBe(403);
    expect(previewResourceImport).not.toHaveBeenCalled();
  });
  it("honors the rate limit before parsing", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);
    expect((await POST(json({ manifest }), context)).status).toBe(429);
    expect(previewResourceImport).not.toHaveBeenCalled();
  });
  it("returns 400 for malformed JSON and multipart", async () => {
    expect((await POST(request("{", { "content-type": "application/json" }), context)).status).toBe(400);
    expect((await POST(request("bad", { "content-type": "multipart/form-data" }), context)).status).toBe(400);
  });
  it("rejects unknown and duplicate multipart fields", async () => {
    for (const field of ["manifest", "image:unknown"]) {
      const form = new FormData();
      form.set("manifest", JSON.stringify(manifest));
      form.append(field, "bad");
      expect((await POST(request(form), context)).status).toBe(400);
    }
    expect(importResource).not.toHaveBeenCalled();
  });
  it("enforces actual bytes without trusting Content-Length", async () => {
    expect((await POST(request(" ".repeat(4_000_001), { "content-type": "application/json", "content-length": "2" }), context)).status).toBe(413);
    expect(previewResourceImport).not.toHaveBeenCalled();
  });
  it("rejects unsupported media and invalid dryRun", async () => {
    expect((await POST(request("{}"), context)).status).toBe(415);
    expect((await POST(json({ manifest, dryRun: "false" }), context)).status).toBe(400);
  });
});
