import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  db: { bulkSku: { findUnique: vi.fn(), update: vi.fn() } },
  requireAuth: vi.fn(),
  audit: vi.fn(),
  validateImage: vi.fn(),
  uploadImage: vi.fn(),
  deleteImage: vi.fn(),
  downloadImageToBlob: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/blob", () => ({
  validateImage: mocks.validateImage,
  uploadImage: mocks.uploadImage,
  deleteImage: mocks.deleteImage,
  downloadImageToBlob: mocks.downloadImageToBlob,
  isBlobUrl: (url: string) => url.includes(".public.blob.vercel-storage.com"),
}));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => undefined),
  IMAGE_MUTATION_LIMIT: { max: 60, windowMs: 60 * 60_000 },
}));

import { DELETE, POST, PUT } from "@/app/api/bulk-skus/[id]/image/route";

const staff = { id: "staff-1", email: "staff@example.com", name: "Staff", role: Role.STAFF };
const oldBlob = "https://old.public.blob.vercel-storage.com/bulk/sku-1/0.jpg";
const newBlob = "https://new.public.blob.vercel-storage.com/bulk/sku-1/1.webp";
const params = { params: Promise.resolve({ id: "sku-1" }) };
const headers = { host: "app.example.com", origin: "https://app.example.com" };

function upload(file: unknown = new File(["image"], "batt.webp", { type: "image/webp" })) {
  const form = new FormData();
  if (file instanceof File) form.set("file", file);
  else if (typeof file === "string") form.set("file", file);
  return new Request("https://app.example.com/api/bulk-skus/sku-1/image", { method: "POST", headers, body: form });
}

function setUrl(url: unknown) {
  return new Request("https://app.example.com/api/bulk-skus/sku-1/image", {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

function remove() {
  return new Request("https://app.example.com/api/bulk-skus/sku-1/image", { method: "DELETE", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.db.bulkSku.findUnique.mockResolvedValue({ id: "sku-1", imageUrl: oldBlob });
  mocks.db.bulkSku.update.mockImplementation(async ({ data }: { data: { imageUrl: string | null } }) => ({ id: "sku-1", ...data }));
  mocks.validateImage.mockResolvedValue(null);
  mocks.uploadImage.mockResolvedValue(newBlob);
  mocks.deleteImage.mockResolvedValue(undefined);
  mocks.downloadImageToBlob.mockResolvedValue(newBlob);
  mocks.audit.mockResolvedValue(undefined);
});

describe("POST /api/bulk-skus/[id]/image", () => {
  it("uploads the new photo, then removes the old stored one", async () => {
    const response = await POST(upload(), params);

    expect(response.status).toBe(200);
    expect(mocks.uploadImage).toHaveBeenCalledWith(expect.any(File), "sku-1");
    expect(mocks.db.bulkSku.update).toHaveBeenCalledWith(expect.objectContaining({ data: { imageUrl: newBlob } }));
    expect(mocks.deleteImage).toHaveBeenCalledWith(oldBlob);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "bulk_sku_image_uploaded",
      before: { imageUrl: oldBlob },
      after: { imageUrl: newBlob },
    }));
  });

  it("leaves a photo hosted elsewhere alone", async () => {
    mocks.db.bulkSku.findUnique.mockResolvedValue({ id: "sku-1", imageUrl: "https://static.bhphoto.com/batt.jpg" });

    await POST(upload(), params);

    expect(mocks.deleteImage).not.toHaveBeenCalled();
  });

  it("removes the just-uploaded photo when saving the record fails", async () => {
    mocks.db.bulkSku.update.mockRejectedValue(new Error("db down"));

    const response = await POST(upload(), params);

    expect(response.status).toBe(500);
    expect(mocks.deleteImage).toHaveBeenCalledWith(newBlob);
    expect(mocks.deleteImage).not.toHaveBeenCalledWith(oldBlob);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("rejects a missing family, a missing file and an invalid image", async () => {
    mocks.db.bulkSku.findUnique.mockResolvedValueOnce(null);
    expect((await POST(upload(), params)).status).toBe(404);

    const noFile = await POST(upload("not a file"), params);
    expect(noFile.status).toBe(400);
    expect((await noFile.json()).error).toBe("Expected multipart file field named 'file'");

    mocks.validateImage.mockResolvedValueOnce("Image must be under 5 MB");
    const tooBig = await POST(upload(), params);
    expect((await tooBig.json()).error).toBe("Image must be under 5 MB");

    expect(mocks.uploadImage).not.toHaveBeenCalled();
  });

  it("keeps students out", async () => {
    mocks.requireAuth.mockResolvedValue({ ...staff, role: Role.STUDENT });

    expect((await POST(upload(), params)).status).toBe(403);
    expect(mocks.db.bulkSku.findUnique).not.toHaveBeenCalled();
  });
});

describe("PUT /api/bulk-skus/[id]/image", () => {
  it("copies a web photo into storage before pointing the family at it", async () => {
    const response = await PUT(setUrl(" https://static.bhphoto.com/batt.jpg "), params);

    expect(response.status).toBe(200);
    expect(mocks.downloadImageToBlob).toHaveBeenCalledWith("https://static.bhphoto.com/batt.jpg", "sku-1");
    expect(mocks.deleteImage).toHaveBeenCalledWith(oldBlob);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "bulk_sku_image_set", after: { imageUrl: newBlob } }));
  });

  it.each([
    ["not a URL", "not a url"],
    ["plain HTTP", "http://static.bhphoto.com/batt.jpg"],
  ])("rejects %s", async (_label, url) => {
    const response = await PUT(setUrl(url), params);

    expect(response.status).toBe(400);
    expect(mocks.downloadImageToBlob).not.toHaveBeenCalled();
  });

  it("explains a download that failed", async () => {
    mocks.downloadImageToBlob.mockResolvedValue(null);

    const response = await PUT(setUrl("https://static.bhphoto.com/batt.jpg"), params);

    expect((await response.json()).error).toBe("Could not download image from that URL");
    expect(mocks.db.bulkSku.update).not.toHaveBeenCalled();
  });

  it("removes the copied photo when saving the record fails", async () => {
    mocks.db.bulkSku.update.mockRejectedValue(new Error("db down"));

    await PUT(setUrl("https://static.bhphoto.com/batt.jpg"), params);

    expect(mocks.deleteImage).toHaveBeenCalledWith(newBlob);
    expect(mocks.deleteImage).not.toHaveBeenCalledWith(oldBlob);
  });
});

describe("DELETE /api/bulk-skus/[id]/image", () => {
  it("clears the photo and deletes the stored file afterward", async () => {
    const response = await DELETE(remove(), params);

    expect(response.status).toBe(200);
    expect(mocks.db.bulkSku.update).toHaveBeenCalledWith(expect.objectContaining({ data: { imageUrl: null } }));
    expect(mocks.deleteImage).toHaveBeenCalledWith(oldBlob);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "bulk_sku_image_removed" }));
  });

  it("refuses when there is no photo to remove", async () => {
    mocks.db.bulkSku.findUnique.mockResolvedValue({ id: "sku-1", imageUrl: null });

    const response = await DELETE(remove(), params);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Bulk SKU has no image");
  });
});
