import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role, SignatureArtifactState, SignatureCollectionStatus, SignatureSaveStatus } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const tx = {
    signatureCapture: { findUnique: vi.fn(), update: vi.fn() },
    signatureArtifactRevision: { updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    signatureSaveOperation: { create: vi.fn(), updateMany: vi.fn() },
  };
  return {
    tx,
    db: {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
      signatureSaveOperation: { findUnique: vi.fn(), updateMany: vi.fn() },
    },
    resolveTarget: vi.fn(),
    cleanup: vi.fn(),
    render: vi.fn(),
    upload: vi.fn(),
    audit: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.audit }));
vi.mock("@/lib/signatures/artifacts", () => ({ renderSignatureArtifacts: mocks.render }));
vi.mock("@/lib/signatures/storage", () => ({
  buildSignatureArtifactPath: (collectionId: string, memberId: string, revisionId: string, ext: string) => `${collectionId}/${memberId}/${revisionId}.${ext}`,
  deletePrivateSignatureArtifacts: vi.fn(),
  uploadPrivateSignatureArtifact: mocks.upload,
}));
vi.mock("@/lib/services/signatures-shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/signatures-shared")>()),
  resolveSignatureCaptureTarget: mocks.resolveTarget,
  cleanupSignatureRevisions: mocks.cleanup,
}));

import { removeSignatureCapture, saveSignatureCapture } from "@/lib/services/signature-captures";

const { tx, db } = mocks;
const actor = { id: "admin-1", role: Role.ADMIN };
const pen = { strokeColor: "#111827", strokeWidth: 4, cropPadding: 24, maxWidth: 1600, maxHeight: 900 };
const target = {
  id: "cap1", collectionId: "c1", memberId: "m1", captureVersion: 3,
  collection: { status: SignatureCollectionStatus.OPEN, settingsVersion: 2, penSettings: pen },
};
const request = { requestId: "req-1", expectedCaptureVersion: 3, settingsVersion: 2, strokes: [] };
const save = (overrides: Partial<typeof request> = {}) => saveSignatureCapture({ actor, collectionId: "c1", memberId: "m1", request: { ...request, ...overrides } as never });
const revision = { id: "r1", pngPath: "c1/m1/r1.png", svgPath: "c1/m1/r1.svg", pngHash: "png-hash", svgHash: "svg-hash", state: SignatureArtifactState.READY, revision: 1, width: 10, height: 5, committedAt: new Date(), createdAt: new Date() };
const operation = (extra: Record<string, unknown> = {}) => ({
  id: "op1", requestId: "req-1", collectionId: "c1", memberId: "m1", captureId: "cap1", actorUserId: "admin-1",
  expectedCaptureVersion: 3, settingsVersion: 2, status: SignatureSaveStatus.UPLOADING, updatedAt: new Date(), revision,
  capture: { captureVersion: 4, currentRevision: revision }, ...extra,
});
const stale = new Date(Date.now() - 24 * 60 * 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveTarget.mockResolvedValue(target);
  mocks.render.mockResolvedValue({ png: Buffer.from("png"), svg: "<svg/>", pngHash: "png-hash", svgHash: "svg-hash", width: 10, height: 5, cropBounds: {} });
  db.signatureSaveOperation.findUnique.mockResolvedValue(null);
});

describe("removeSignatureCapture", () => {
  const remove = () => removeSignatureCapture({ actor, collectionId: "c1", memberId: "m1", expectedCaptureVersion: 3 });

  it("refuses a missing capture, an archived collection or a stale version", async () => {
    tx.signatureCapture.findUnique.mockResolvedValueOnce(null);
    await expect(remove()).rejects.toMatchObject({ status: 404 });

    tx.signatureCapture.findUnique.mockResolvedValueOnce({ captureVersion: 3, collection: { status: SignatureCollectionStatus.ARCHIVED } });
    await expect(remove()).rejects.toMatchObject({ status: 409, message: "Archived signature collections are read-only" });

    tx.signatureCapture.findUnique.mockResolvedValueOnce({ captureVersion: 4, collection: { status: SignatureCollectionStatus.OPEN } });
    await expect(remove()).rejects.toMatchObject({ status: 409, message: "This signature changed elsewhere; reload before removing it" });
    expect(tx.signatureCapture.update).not.toHaveBeenCalled();
  });

  it("does nothing for a member with no current signature, even with older retained ones", async () => {
    tx.signatureCapture.findUnique.mockResolvedValue({ id: "cap1", captureVersion: 3, currentRevision: null, collection: { status: "OPEN" }, revisions: [{ id: "r0", pngPath: "b.png", svgPath: "b.svg" }] });

    expect(await remove()).toEqual({ removed: false, captureVersion: 3 });
    expect(tx.signatureCapture.update).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it("clears the signature, bumps the version, audits and cleans up every ready revision", async () => {
    tx.signatureCapture.findUnique.mockResolvedValue({
      id: "cap1", captureVersion: 3, currentRevision: revision, collection: { status: "OPEN" },
      revisions: [{ id: "r1", pngPath: "a.png", svgPath: "a.svg" }, { id: "r0", pngPath: "b.png", svgPath: "b.svg" }],
    });

    expect(await remove()).toEqual({ removed: true, captureVersion: 4 });
    expect(tx.signatureCapture.update).toHaveBeenCalledWith({ where: { id: "cap1" }, data: { currentRevisionId: null, captureVersion: { increment: 1 } } });
    expect(tx.signatureArtifactRevision.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["r1", "r0"] } }, data: expect.objectContaining({ state: SignatureArtifactState.PENDING_DELETE }) });
    expect(mocks.audit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "REMOVE", before: expect.objectContaining({ revisionId: "r1", pngHash: "png-hash" }) }));
    expect(mocks.cleanup).toHaveBeenCalledWith([{ id: "r1", pngPath: "a.png", svgPath: "a.svg" }, { id: "r0", pngPath: "b.png", svgPath: "b.svg" }]);
  });
});

describe("saveSignatureCapture guards", () => {
  it("answers a retried request from its recorded outcome", async () => {
    db.signatureSaveOperation.findUnique.mockResolvedValueOnce(operation({ status: SignatureSaveStatus.COMMITTED }));
    expect(await save()).toEqual(expect.objectContaining({ status: "committed", captureVersion: 4 }));

    db.signatureSaveOperation.findUnique.mockResolvedValueOnce(operation({ status: SignatureSaveStatus.FAILED }));
    await expect(save()).rejects.toMatchObject({ status: 409, message: "This save request failed; try saving again" });

    db.signatureSaveOperation.findUnique.mockResolvedValueOnce(operation());
    await expect(save()).rejects.toMatchObject({ status: 425, message: "This signature is still saving; try again shortly" });

    db.signatureSaveOperation.findUnique.mockResolvedValueOnce(operation({ actorUserId: "someone-else" }));
    await expect(save()).rejects.toMatchObject({ status: 409, message: "This save request ID was already used for another signature" });
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("refuses an archived collection, a stale member version or changed pen settings before rendering", async () => {
    mocks.resolveTarget.mockResolvedValueOnce({ ...target, collection: { ...target.collection, status: SignatureCollectionStatus.ARCHIVED } });
    await expect(save()).rejects.toMatchObject({ status: 409, message: "Archived signature collections are read-only" });

    await expect(save({ expectedCaptureVersion: 2 })).rejects.toMatchObject({ status: 409 });
    await expect(save({ settingsVersion: 1 })).rejects.toMatchObject({ status: 409, message: "Pen settings changed; reload the capture surface" });
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("explains a drawing problem and hides a renderer outage", async () => {
    mocks.render.mockRejectedValueOnce(new Error("Signature needs at least one stroke"));
    await expect(save()).rejects.toMatchObject({ status: 400, message: "Signature needs at least one stroke" });

    mocks.render.mockRejectedValueOnce(new Error("sharp crashed"));
    await expect(save()).rejects.toMatchObject({ status: 503, message: "Signature rendering is temporarily unavailable" });
  });

  it("resumes a stale save only with the same drawing, and backs off if another device claims it first", async () => {
    db.signatureSaveOperation.findUnique.mockResolvedValueOnce(operation({ updatedAt: stale, revision: null }));
    await expect(save()).rejects.toMatchObject({ status: 503, message: "This signature save cannot be recovered yet" });

    db.signatureSaveOperation.findUnique.mockResolvedValueOnce(operation({ updatedAt: stale, revision: { ...revision, svgHash: "other" } }));
    await expect(save()).rejects.toMatchObject({ status: 409, message: "This save request ID belongs to a different signature draft" });

    db.signatureSaveOperation.findUnique
      .mockResolvedValueOnce(operation({ updatedAt: stale }))
      .mockResolvedValueOnce(operation({ status: SignatureSaveStatus.COMMITTED }));
    db.signatureSaveOperation.updateMany.mockResolvedValue({ count: 0 });
    expect(await save()).toEqual(expect.objectContaining({ status: "committed" }));

    db.signatureSaveOperation.findUnique.mockResolvedValueOnce(operation({ updatedAt: stale })).mockResolvedValueOnce(null);
    await expect(save()).rejects.toMatchObject({ status: 425 });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("settles a race on the first write by the winner's outcome", async () => {
    const lose = (error: object) => db.$transaction.mockImplementationOnce(async () => { throw error; });

    lose({ code: "P2002" });
    db.signatureSaveOperation.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(operation({ status: SignatureSaveStatus.FAILED }));
    await expect(save()).rejects.toMatchObject({ status: 409, message: "This save request failed; try saving again" });

    lose({ code: "P2002" });
    db.signatureSaveOperation.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    await expect(save()).rejects.toMatchObject({ status: 425, message: "Another save is already processing this signature; retry this same save shortly" });

    lose({ code: "P2034" });
    lose({ code: "P2034" });
    await expect(save()).rejects.toMatchObject({ status: 425, message: "Another save is settling this signature; retry this same save shortly" });
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
