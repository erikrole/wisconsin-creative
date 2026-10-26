import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn(), env: { applicantBlobReadWriteToken: "token" as string | undefined } }));

vi.mock("@vercel/blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/blob")>()),
  put: mocks.put,
  get: mocks.get,
  del: mocks.del,
}));
vi.mock("@/lib/env", () => ({ env: mocks.env }));

import { BlobNotFoundError } from "@vercel/blob";
import { deleteApplicantFile, getApplicantFile, putApplicantFile } from "@/lib/hiring/storage";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.applicantBlobReadWriteToken = "token";
});

describe("applicant file storage", () => {
  it("stores privately at the exact path and never overwrites", async () => {
    const body = new ArrayBuffer(4);
    await putApplicantFile("applicants/a1/resume.pdf", body, "application/pdf");

    expect(mocks.put).toHaveBeenCalledWith("applicants/a1/resume.pdf", body, {
      access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/pdf", token: "token",
    });
  });

  it("refuses every operation when storage is not configured", async () => {
    mocks.env.applicantBlobReadWriteToken = undefined;

    await expect(putApplicantFile("p", new ArrayBuffer(1), "application/pdf")).rejects.toMatchObject({ status: 503, message: "Applicant file storage is not configured." });
    await expect(getApplicantFile("p")).rejects.toMatchObject({ message: "Applicant file storage is not configured." });
    await expect(deleteApplicantFile("p")).rejects.toMatchObject({ message: "Applicant file storage is not configured." });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("turns storage failures into plain 503s", async () => {
    mocks.put.mockRejectedValue(new Error("network"));
    mocks.get.mockRejectedValue(new Error("network"));
    mocks.del.mockRejectedValue(new Error("network"));

    await expect(putApplicantFile("p", new ArrayBuffer(1), "application/pdf")).rejects.toMatchObject({ status: 503, message: "The applicant file could not be stored." });
    await expect(getApplicantFile("p")).rejects.toMatchObject({ status: 503, message: "The applicant file could not be retrieved." });
    await expect(deleteApplicantFile("p")).rejects.toMatchObject({ status: 503, message: "The applicant file could not be deleted." });
  });

  it("reads uncached and returns only a full 200 result", async () => {
    const found = { statusCode: 200, stream: null };
    mocks.get.mockResolvedValueOnce(found).mockResolvedValueOnce({ statusCode: 304 }).mockResolvedValueOnce(null);

    expect(await getApplicantFile("p")).toBe(found);
    expect(mocks.get).toHaveBeenCalledWith("p", { access: "private", useCache: false, token: "token" });
    expect(await getApplicantFile("p")).toBeNull();
    expect(await getApplicantFile("p")).toBeNull();
  });

  it("counts an already-missing file as deleted", async () => {
    mocks.del.mockRejectedValue(new BlobNotFoundError());

    await expect(deleteApplicantFile("p")).resolves.toBeUndefined();
    expect(mocks.del).toHaveBeenCalledWith("p", { token: "token" });
  });
});
