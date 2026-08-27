import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role, SignatureArtifactState, SignatureCollectionStatus, SignatureSaveStatus, SignatureSnapshotStatus } from "@prisma/client";

const { dbMock, tx } = vi.hoisted(() => {
  const tx = {
    signatureCapture: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    signatureCollection: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    signatureRosterSnapshot: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    signatureMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    signatureArtifactRevision: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    signatureSaveOperation: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };

  const dbMock = {
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    signatureSaveOperation: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    signatureCapture: { findFirst: vi.fn(), findMany: vi.fn() },
    signatureCollection: { findUnique: vi.fn(), findMany: vi.fn() },
    signatureMember: { findFirst: vi.fn() },
    signatureArtifactRevision: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  };

  return { dbMock, tx };
});

vi.mock("@/lib/db", () => ({ db: dbMock }));

vi.mock("@/lib/audit", () => ({
  createAuditEntryTx: vi.fn(),
}));

vi.mock("@/lib/signatures/artifacts", () => ({
  renderSignatureArtifacts: vi.fn(),
}));

vi.mock("@/lib/signatures/storage", () => ({
  buildSignatureArtifactPath: vi.fn((collectionId: string, memberId: string, revisionId: string, kind: string) => `signatures/${collectionId}/${memberId}/${revisionId}.${kind}`),
  uploadPrivateSignatureArtifact: vi.fn(),
  deletePrivateSignatureArtifacts: vi.fn(),
  getPrivateSignatureArtifact: vi.fn(),
}));

import { applySignatureRosterSnapshot, cleanupPendingSignatureArtifacts, createAdHocSignatureMember, createSignatureRosterPreview, deleteSignatureCollection, ensureSignatureCreativeStaffCollection, getReadySignatureArtifact, getSignatureCollection, getSignatureCollectionZip, getSignatureMemberCaptureBootstrap, listSignatureCollections, removeSignatureCapture, resetSignatureCollection, saveSignatureCapture, signatureArtifactFilename, syncSignatureCreativeStaff, updateSignatureMemberRequired } from "@/lib/services/signatures";
import { createAuditEntryTx } from "@/lib/audit";
import { renderSignatureArtifacts } from "@/lib/signatures/artifacts";
import { deletePrivateSignatureArtifacts, getPrivateSignatureArtifact, uploadPrivateSignatureArtifact } from "@/lib/signatures/storage";

const actor = { id: "staff-1", role: Role.STAFF };
const request = {
  requestId: "request-123456789012",
  expectedCaptureVersion: 0,
  settingsVersion: 1,
  strokes: [{ points: [{ x: 10, y: 10 }] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.signatureSaveOperation.findUnique.mockResolvedValue(null);
  dbMock.signatureCapture.findFirst.mockResolvedValue({
    id: "capture-1",
    collectionId: "collection-1",
    memberId: "member-1",
    captureVersion: 0,
    settingsVersion: 1,
    collection: {
      id: "collection-1",
      sportCode: "MBB",
      season: "2026-27",
      status: SignatureCollectionStatus.OPEN,
      settingsVersion: 1,
      penSettings: {
        strokeColor: "#111827",
        strokeWidth: 4,
        cropPadding: 24,
        maxWidth: 1600,
        maxHeight: 900,
      },
    },
    member: { id: "member-1", active: true, linkedUserId: null },
    currentRevision: null,
  });
  tx.signatureCapture.findUnique.mockResolvedValue({
    captureVersion: 0,
    collectionId: "collection-1",
    memberId: "member-1",
    settingsVersion: 1,
  });
  tx.signatureArtifactRevision.findFirst.mockResolvedValue(null);
  tx.signatureArtifactRevision.create.mockResolvedValue({ id: "revision-1" });
  tx.signatureSaveOperation.create.mockResolvedValue({ id: "operation-1" });
  tx.signatureSaveOperation.findUnique.mockResolvedValue({
    id: "operation-1",
    requestId: request.requestId,
    captureId: "capture-1",
    revisionId: "revision-1",
    expectedCaptureVersion: 0,
    status: SignatureSaveStatus.FINALIZING,
    revision: null,
  });
  tx.signatureArtifactRevision.updateMany.mockResolvedValue({ count: 1 });
  tx.signatureSaveOperation.updateMany.mockResolvedValue({ count: 1 });
  dbMock.signatureSaveOperation.updateMany.mockResolvedValue({ count: 1 });
  dbMock.signatureArtifactRevision.findMany.mockResolvedValue([]);
  vi.mocked(renderSignatureArtifacts).mockResolvedValue({
    svg: "<svg />",
    png: Buffer.from("png"),
    pngHash: "png-hash",
    svgHash: "svg-hash",
    width: 100,
    height: 80,
    strokeWidth: 4,
    cropBounds: { x: 0, y: 0, width: 100, height: 80 },
  });
});

describe("signature save lifecycle", () => {
  it("binds an idempotency key to its original signature target", async () => {
    dbMock.signatureSaveOperation.findUnique.mockResolvedValue({
      collectionId: "other-collection",
      memberId: "other-member",
      actorUserId: actor.id,
      expectedCaptureVersion: request.expectedCaptureVersion,
      settingsVersion: request.settingsVersion,
      status: SignatureSaveStatus.COMMITTED,
      revision: null,
    });

    await expect(saveSignatureCapture({ actor, collectionId: "collection-1", memberId: "member-1", request })).rejects.toMatchObject({ status: 409 });
    expect(dbMock.signatureCapture.findFirst).toHaveBeenCalledTimes(1);
    expect(renderSignatureArtifacts).not.toHaveBeenCalled();
  });

  it("distinguishes an in-progress idempotent retry from a failed operation", async () => {
    const existing = {
      collectionId: "collection-1",
      memberId: "member-1",
      captureId: "capture-1",
      actorUserId: actor.id,
      expectedCaptureVersion: request.expectedCaptureVersion,
      settingsVersion: request.settingsVersion,
      revision: null,
    };
    dbMock.signatureSaveOperation.findUnique.mockResolvedValue({
      ...existing,
      status: SignatureSaveStatus.UPLOADING,
      updatedAt: new Date(),
    });
    await expect(saveSignatureCapture({ actor, collectionId: "collection-1", memberId: "member-1", request })).rejects.toMatchObject({
      status: 425,
      message: "This signature is still saving; try again shortly",
    });

    dbMock.signatureSaveOperation.findUnique.mockResolvedValue({
      ...existing,
      status: SignatureSaveStatus.FAILED,
    });
    await expect(saveSignatureCapture({ actor, collectionId: "collection-1", memberId: "member-1", request })).rejects.toMatchObject({
      status: 409,
      message: "This save request failed; try saving again",
    });
  });

  it("resumes a stale UPLOADING operation with the same verified draft and immutable paths", async () => {
    const revision = {
      id: "revision-stale",
      revision: 1,
      state: SignatureArtifactState.PENDING_DELETE,
      pngPath: "signatures/collection-1/member-1/revision-stale.png",
      svgPath: "signatures/collection-1/member-1/revision-stale.svg",
      pngHash: "png-hash",
      svgHash: "svg-hash",
      width: 100,
      height: 80,
      committedAt: null,
      replacedAt: null,
    };
    dbMock.signatureSaveOperation.findUnique.mockResolvedValue({
      id: "operation-stale",
      requestId: request.requestId,
      collectionId: "collection-1",
      memberId: "member-1",
      captureId: "capture-1",
      actorUserId: actor.id,
      expectedCaptureVersion: 0,
      settingsVersion: 1,
      status: SignatureSaveStatus.UPLOADING,
      revisionId: revision.id,
      revision,
      capture: { captureVersion: 0, currentRevision: null },
      updatedAt: new Date(Date.now() - 61_000),
    });
    tx.signatureSaveOperation.findUnique.mockResolvedValue({
      id: "operation-stale",
      requestId: request.requestId,
      captureId: "capture-1",
      revisionId: revision.id,
      expectedCaptureVersion: 0,
      status: SignatureSaveStatus.FINALIZING,
      revision,
    });
    tx.signatureCapture.findUnique.mockResolvedValue({
      id: "capture-1",
      captureVersion: 0,
      settingsVersion: 1,
      currentRevisionId: null,
      currentRevision: null,
      collection: { status: SignatureCollectionStatus.OPEN },
      member: { active: true },
    });
    tx.signatureArtifactRevision.update.mockResolvedValue({
      ...revision,
      state: SignatureArtifactState.READY,
      committedAt: new Date(),
    });
    tx.signatureCapture.update.mockResolvedValue({ captureVersion: 1 });
    tx.signatureCollection.updateMany.mockResolvedValue({ count: 1 });
    vi.mocked(uploadPrivateSignatureArtifact).mockResolvedValue(undefined);

    await expect(saveSignatureCapture({ actor, collectionId: "collection-1", memberId: "member-1", request })).resolves.toMatchObject({
      status: "committed",
      captureVersion: 1,
    });

    expect(uploadPrivateSignatureArtifact).toHaveBeenCalledTimes(2);
    expect(uploadPrivateSignatureArtifact).toHaveBeenCalledWith(expect.objectContaining({
      path: revision.pngPath,
      allowOverwrite: true,
    }));
    expect(dbMock.signatureSaveOperation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "operation-stale", updatedAt: expect.any(Date) }),
    }));
  });

  it("treats a concurrent finalizer's committed result as the idempotent answer", async () => {
    const readyRevision = {
      id: "revision-1",
      revision: 1,
      state: SignatureArtifactState.READY,
      pngPath: "one.png",
      svgPath: "one.svg",
      pngHash: "png-hash",
      svgHash: "svg-hash",
      width: 100,
      height: 80,
      committedAt: new Date(),
      replacedAt: null,
    };
    dbMock.signatureSaveOperation.findUnique.mockResolvedValue({
      id: "operation-1",
      requestId: request.requestId,
      collectionId: "collection-1",
      memberId: "member-1",
      captureId: "capture-1",
      actorUserId: actor.id,
      expectedCaptureVersion: 0,
      settingsVersion: 1,
      status: SignatureSaveStatus.FINALIZING,
      revisionId: readyRevision.id,
      revision: readyRevision,
      capture: { captureVersion: 3, currentRevision: readyRevision },
      updatedAt: new Date(Date.now() - 61_000),
    });
    tx.signatureSaveOperation.findUnique.mockResolvedValue({
      id: "operation-1",
      requestId: request.requestId,
      captureId: "capture-1",
      revisionId: readyRevision.id,
      expectedCaptureVersion: 0,
      status: SignatureSaveStatus.COMMITTED,
      revision: readyRevision,
      capture: { captureVersion: 3 },
    });

    await expect(saveSignatureCapture({ actor, collectionId: "collection-1", memberId: "member-1", request })).resolves.toMatchObject({
      status: "committed",
      captureVersion: 3,
      revision: { id: readyRevision.id },
    });
    expect(uploadPrivateSignatureArtifact).not.toHaveBeenCalled();
    expect(tx.signatureCapture.update).not.toHaveBeenCalled();
  });

  it("does not delete artifacts when the upload status response is ambiguous after commit", async () => {
    vi.mocked(uploadPrivateSignatureArtifact).mockResolvedValue(undefined);
    dbMock.signatureSaveOperation.updateMany.mockRejectedValueOnce(new Error("status response lost"));
    tx.signatureSaveOperation.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(saveSignatureCapture({ actor, collectionId: "collection-1", memberId: "member-1", request })).rejects.toMatchObject({
      status: 503,
    });

    expect(deletePrivateSignatureArtifacts).not.toHaveBeenCalled();
    expect(tx.signatureSaveOperation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "operation-1", status: { not: "COMMITTED" } },
      data: expect.objectContaining({ status: "FAILED" }),
    }));
  });

  it("fences a delete that wins while the private files are uploading", async () => {
    vi.mocked(uploadPrivateSignatureArtifact).mockResolvedValue(undefined);
    dbMock.signatureSaveOperation.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(saveSignatureCapture({ actor, collectionId: "collection-1", memberId: "member-1", request })).rejects.toMatchObject({
      status: 409,
      message: "This signature save was cancelled; return to the roster before trying again",
    });

    const [paths] = vi.mocked(deletePrivateSignatureArtifacts).mock.calls[0] ?? [];
    expect(paths).toEqual([
      expect.stringMatching(/^signatures\/collection-1\/member-1\/.+\.png$/),
      expect.stringMatching(/^signatures\/collection-1\/member-1\/.+\.svg$/),
    ]);
    expect(tx.signatureSaveOperation.updateMany).not.toHaveBeenCalled();
  });

  it("self-cleans a late upload after collection deletion wins the interleaving", async () => {
    let releaseUpload!: () => void;
    let uploadStarted!: () => void;
    const uploadBarrier = new Promise<void>((resolve) => { uploadStarted = resolve; });
    const uploadRelease = new Promise<void>((resolve) => { releaseUpload = resolve; });
    let uploadCalls = 0;
    vi.mocked(uploadPrivateSignatureArtifact).mockImplementation(async () => {
      uploadCalls += 1;
      if (uploadCalls === 1) {
        uploadStarted();
        await uploadRelease;
      }
    });
    dbMock.signatureSaveOperation.updateMany.mockResolvedValueOnce({ count: 0 });
    tx.signatureCollection.findUnique
      .mockResolvedValueOnce({ id: "collection-1", status: SignatureCollectionStatus.OPEN, collectionVersion: 5 })
      .mockResolvedValueOnce({ id: "collection-1", status: SignatureCollectionStatus.ARCHIVED, collectionVersion: 6 });
    tx.signatureCapture.findMany.mockResolvedValue([{ id: "capture-1" }]);
    tx.signatureArtifactRevision.findMany
      .mockResolvedValueOnce([{ id: "revision-1", pngPath: "one.png", svgPath: "one.svg" }])
      .mockResolvedValueOnce([]);
    tx.signatureCollection.update.mockResolvedValue({ collectionVersion: 6 });

    const savePromise = saveSignatureCapture({ actor, collectionId: "collection-1", memberId: "member-1", request });
    await uploadBarrier;

    await expect(deleteSignatureCollection({
      actor: { id: "admin-1", role: Role.ADMIN },
      collectionId: "collection-1",
      expectedCollectionVersion: 5,
    })).resolves.toEqual({ deleted: true });

    releaseUpload();
    await expect(savePromise).rejects.toMatchObject({
      status: 409,
      message: "This signature save was cancelled; return to the roster before trying again",
    });
    expect(deletePrivateSignatureArtifacts).toHaveBeenCalledTimes(2);
  });

  it("re-reads the durable request after a P2002 race and returns the winner", async () => {
    const readyRevision = {
      id: "revision-winner",
      revision: 1,
      state: SignatureArtifactState.READY,
      pngPath: "winner.png",
      svgPath: "winner.svg",
      pngHash: "png-hash",
      svgHash: "svg-hash",
      width: 100,
      height: 80,
      committedAt: new Date(),
      replacedAt: null,
    };
    dbMock.signatureSaveOperation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "operation-winner",
        requestId: request.requestId,
        collectionId: "collection-1",
        memberId: "member-1",
        captureId: "capture-1",
        actorUserId: actor.id,
        expectedCaptureVersion: 0,
        settingsVersion: 1,
        status: SignatureSaveStatus.COMMITTED,
        revisionId: readyRevision.id,
        revision: readyRevision,
        capture: { captureVersion: 1, currentRevision: readyRevision },
        updatedAt: new Date(),
      });
    tx.signatureSaveOperation.create.mockRejectedValueOnce(Object.assign(new Error("unique request"), { code: "P2002" }));

    await expect(saveSignatureCapture({ actor, collectionId: "collection-1", memberId: "member-1", request })).resolves.toMatchObject({
      status: "committed",
      captureVersion: 1,
      revision: { id: readyRevision.id },
    });
    expect(dbMock.signatureSaveOperation.findUnique).toHaveBeenCalledTimes(2);
    expect(uploadPrivateSignatureArtifact).not.toHaveBeenCalled();
  });

  it("keeps a second iPad's stale draft when another device wins the member version", async () => {
    dbMock.signatureCapture.findFirst.mockResolvedValue({
      id: "capture-1",
      collectionId: "collection-1",
      memberId: "member-1",
      captureVersion: 1,
      settingsVersion: 1,
      collection: { id: "collection-1", sportCode: "MBB", season: "2026-27", status: SignatureCollectionStatus.OPEN, settingsVersion: 1, penSettings: {} },
      member: { id: "member-1", active: true, linkedUserId: null },
      currentRevision: null,
    });

    await expect(saveSignatureCapture({ actor, collectionId: "collection-1", memberId: "member-1", request })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("already signed or changed on another iPad"),
    });
    expect(renderSignatureArtifacts).not.toHaveBeenCalled();
    expect(uploadPrivateSignatureArtifact).not.toHaveBeenCalled();
  });

  it("keeps the current capture when the second artifact upload fails", async () => {
    vi.mocked(uploadPrivateSignatureArtifact)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("SVG store unavailable"));

    await expect(saveSignatureCapture({ actor, collectionId: "collection-1", memberId: "member-1", request })).rejects.toMatchObject({
      status: 503,
    });

    expect(uploadPrivateSignatureArtifact).toHaveBeenCalledTimes(2);
    expect(deletePrivateSignatureArtifacts).toHaveBeenCalledTimes(1);
    expect(tx.signatureCapture.update).not.toHaveBeenCalled();
    expect(tx.signatureSaveOperation.update).not.toHaveBeenCalled();
    expect(tx.signatureSaveOperation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "operation-1", status: { not: "COMMITTED" } },
      data: expect.objectContaining({ status: "FAILED" }),
    }));
  });

  it("retains the prior READY revision when a recapture commits", async () => {
    const priorRevision = { id: "revision-old", pngHash: "old-png", svgHash: "old-svg" };
    dbMock.signatureCapture.findFirst.mockResolvedValue({
      id: "capture-1",
      collectionId: "collection-1",
      memberId: "member-1",
      captureVersion: 0,
      settingsVersion: 1,
      collection: {
        id: "collection-1",
        sportCode: "MBB",
        season: "2026-27",
        status: SignatureCollectionStatus.OPEN,
        settingsVersion: 1,
        penSettings: {
          strokeColor: "#111827",
          strokeWidth: 4,
          cropPadding: 24,
          maxWidth: 1600,
          maxHeight: 900,
        },
      },
      member: { id: "member-1", active: true, linkedUserId: null },
      currentRevision: priorRevision,
    });
    tx.signatureCapture.findUnique
      .mockResolvedValueOnce({ captureVersion: 0, collectionId: "collection-1", memberId: "member-1", settingsVersion: 1 })
      .mockResolvedValueOnce({
        id: "capture-1",
        captureVersion: 0,
        settingsVersion: 1,
        currentRevisionId: "revision-old",
        currentRevision: priorRevision,
        collection: { status: SignatureCollectionStatus.OPEN },
        member: { active: true },
      });
    tx.signatureArtifactRevision.findFirst.mockResolvedValue({ revision: 1 });
    tx.signatureArtifactRevision.update
      .mockResolvedValueOnce(priorRevision)
      .mockResolvedValueOnce({
        id: "revision-1",
        revision: 2,
        state: "READY",
        width: 100,
        height: 80,
        pngHash: "png-hash",
        svgHash: "svg-hash",
        committedAt: new Date("2026-08-16T12:00:00Z"),
        replacedAt: null,
      });
    tx.signatureCapture.update.mockResolvedValue({ captureVersion: 1 });
    tx.signatureCollection.updateMany.mockResolvedValue({ count: 0 });
    vi.mocked(uploadPrivateSignatureArtifact).mockResolvedValue(undefined);

    await expect(saveSignatureCapture({ actor, collectionId: "collection-1", memberId: "member-1", request })).resolves.toMatchObject({
      status: "committed",
      captureVersion: 1,
      revision: { revision: 2 },
    });

    expect(tx.signatureArtifactRevision.update).toHaveBeenNthCalledWith(1, {
      where: { id: "revision-old" },
      data: { replacedAt: expect.any(Date) },
    });
    expect(deletePrivateSignatureArtifacts).not.toHaveBeenCalled();
  });

  it("writes a linked team member through the same-season Creative Staff capture", async () => {
    dbMock.signatureCapture.findFirst
      .mockResolvedValueOnce({
        id: "team-capture",
        collectionId: "team-collection",
        memberId: "team-member",
        captureVersion: 0,
        settingsVersion: 1,
        collection: { id: "team-collection", sportCode: "MBB", season: "2026-27", status: SignatureCollectionStatus.OPEN, settingsVersion: 1, penSettings: {} },
        member: { id: "team-member", active: true, linkedUserId: "user-1" },
        currentRevision: null,
      })
      .mockResolvedValueOnce({
        id: "creative-capture",
        collectionId: "creative-collection",
        memberId: "creative-member",
        captureVersion: 0,
        settingsVersion: 1,
        collection: {
          id: "creative-collection",
          sportCode: "CREATIVE",
          season: "2026-27",
          status: SignatureCollectionStatus.OPEN,
          settingsVersion: 1,
          penSettings: { strokeColor: "#111827", strokeWidth: 4, cropPadding: 24, maxWidth: 1600, maxHeight: 900 },
        },
        member: { id: "creative-member", active: true, linkedUserId: "user-1" },
        currentRevision: null,
      });
    tx.signatureCapture.findUnique
      .mockResolvedValueOnce({ captureVersion: 0, collectionId: "creative-collection", memberId: "creative-member", settingsVersion: 1 })
      .mockResolvedValueOnce({
        id: "creative-capture",
        captureVersion: 0,
        settingsVersion: 1,
        currentRevisionId: null,
        currentRevision: null,
        collection: { status: SignatureCollectionStatus.OPEN },
        member: { active: true },
      });
    tx.signatureCapture.update.mockResolvedValue({ captureVersion: 1 });
    tx.signatureSaveOperation.findUnique.mockResolvedValue({
      id: "operation-1",
      requestId: request.requestId,
      captureId: "creative-capture",
      revisionId: "revision-1",
      expectedCaptureVersion: 0,
      status: SignatureSaveStatus.FINALIZING,
      revision: null,
    });
    tx.signatureCollection.updateMany.mockResolvedValue({ count: 1 });
    tx.signatureArtifactRevision.update.mockResolvedValue({
      id: "revision-1",
      revision: 1,
      state: "READY",
      width: 100,
      height: 80,
      pngHash: "png-hash",
      svgHash: "svg-hash",
      committedAt: new Date("2026-08-16T12:00:00Z"),
      replacedAt: null,
    });
    vi.mocked(uploadPrivateSignatureArtifact).mockResolvedValue(undefined);

    await expect(saveSignatureCapture({ actor, collectionId: "team-collection", memberId: "team-member", request })).resolves.toMatchObject({ status: "committed", captureVersion: 1 });

    expect(tx.signatureSaveOperation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ collectionId: "creative-collection", memberId: "creative-member", captureId: "creative-capture" }),
    });
    expect(uploadPrivateSignatureArtifact).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringMatching(/^signatures\/creative-collection\/creative-member\//) }));
  });
});

describe("signature download filenames", () => {
  it("uses jersey-number and roster-name filenames", () => {
    expect(signatureArtifactFilename("Colton Joseph", "svg", 1)).toBe("1_Colton_Joseph.svg");
    expect(signatureArtifactFilename("José O’Neill Jr.", "svg", 5)).toBe("5_Jose_ONeill_Jr.svg");
    expect(signatureArtifactFilename("Erik Role", "png")).toBe("Erik_Role.png");
    expect(signatureArtifactFilename("---", "png")).toBe("signature.png");
    expect(signatureArtifactFilename("Erik Role", "svg", null, 2)).toBe("Erik_Role_v2.svg");
  });

  it("allows a retained READY revision to download with a versioned filename", async () => {
    dbMock.signatureArtifactRevision.findUnique.mockResolvedValue({
      id: "revision-2",
      revision: 2,
      state: "READY",
      pngPath: "old.png",
      svgPath: "old.svg",
      capture: {
        currentRevisionId: "revision-3",
        member: { name: "Erik Role", jerseyNumber: null },
      },
    });

    await expect(getReadySignatureArtifact("revision-2", "png")).resolves.toMatchObject({
      path: "old.png",
      filename: "Erik_Role_v2.png",
    });
  });
});

describe("signature collection ZIP export", () => {
  it("exports current SVGs with clean unique names", async () => {
    dbMock.signatureCollection.findUnique.mockResolvedValue({
      sportCode: "MBB",
      season: "2026-27",
      members: [
        { name: "José Role", jerseyNumber: 1, roleGroup: "PLAYER", linkedUserId: null, capture: { currentRevision: { state: SignatureArtifactState.READY, pngPath: "one.png", svgPath: "one.svg" } } },
        { name: "Jose Role", jerseyNumber: 1, roleGroup: "PLAYER", linkedUserId: null, capture: { currentRevision: { state: SignatureArtifactState.READY, pngPath: "two.png", svgPath: "two.svg" } } },
        { name: "Blank Signer", jerseyNumber: null, roleGroup: "PLAYER", linkedUserId: null, capture: { currentRevision: null } },
      ],
    });
    vi.mocked(getPrivateSignatureArtifact).mockImplementation(async (path) => ({
      stream: new Response(`<svg data-path="${path}" />`).body,
    }) as never);

    await expect(getSignatureCollectionZip("collection-1")).resolves.satisfy((archive: { filename: string; fileCount: number; body: Buffer }) => {
      expect(archive.filename).toBe("mbb-2026-27-signatures-svg.zip");
      expect(archive.fileCount).toBe(2);
      expect(archive.body.includes(Buffer.from("1_Jose_Role.svg"))).toBe(true);
      expect(archive.body.includes(Buffer.from("1_Jose_Role_2.svg"))).toBe(true);
      return true;
    });
    expect(getPrivateSignatureArtifact).toHaveBeenCalledWith("one.svg");
    expect(getPrivateSignatureArtifact).toHaveBeenCalledWith("two.svg");
  });

  it("exports current PNGs when the PNG format is requested", async () => {
    dbMock.signatureCollection.findUnique.mockResolvedValue({
      sportCode: "FB",
      season: "2026-27",
      members: [
        { name: "Player One", jerseyNumber: 1, roleGroup: "PLAYER", linkedUserId: null, capture: { currentRevision: { state: SignatureArtifactState.READY, pngPath: "one.png", svgPath: "one.svg" } } },
        { name: "Player Two", jerseyNumber: 2, roleGroup: "PLAYER", linkedUserId: null, capture: { currentRevision: { state: SignatureArtifactState.READY, pngPath: "two.png", svgPath: "two.svg" } } },
      ],
    });
    vi.mocked(getPrivateSignatureArtifact).mockImplementation(async (path) => ({
      stream: new Response(`png:${path}`).body,
    }) as never);

    await expect(getSignatureCollectionZip("collection-1", "png")).resolves.satisfy((archive: { filename: string; fileCount: number; body: Buffer }) => {
      expect(archive.filename).toBe("fb-2026-27-signatures-png.zip");
      expect(archive.fileCount).toBe(2);
      expect(archive.body.includes(Buffer.from("1_Player_One.png"))).toBe(true);
      expect(archive.body.includes(Buffer.from("2_Player_Two.png"))).toBe(true);
      return true;
    });
    expect(getPrivateSignatureArtifact).toHaveBeenCalledWith("one.png");
    expect(getPrivateSignatureArtifact).toHaveBeenCalledWith("two.png");
  });

  it("refuses an empty export", async () => {
    dbMock.signatureCollection.findUnique.mockResolvedValue({
      sportCode: "VB",
      season: "2026-27",
      members: [{ name: "Blank Signer", jerseyNumber: null, roleGroup: "PLAYER", linkedUserId: null, capture: { currentRevision: null } }],
    });

    await expect(getSignatureCollectionZip("collection-1")).rejects.toMatchObject({
      status: 404,
      message: "No committed SVG signatures are available for this roster",
    });
    expect(getPrivateSignatureArtifact).not.toHaveBeenCalled();
  });

  it("uses the canonical Creative Staff artifact for a linked team staff member", async () => {
    dbMock.signatureCollection.findUnique.mockResolvedValue({
      sportCode: "MBB",
      season: "2026-27",
      members: [{ name: "Erik Role", jerseyNumber: null, roleGroup: "SUPPORT_STAFF", linkedUserId: "user-1", capture: { currentRevision: null } }],
    });
    dbMock.signatureCapture.findMany.mockResolvedValue([{
      member: { linkedUserId: "user-1" },
      currentRevision: { state: SignatureArtifactState.READY, pngPath: "creative.png", svgPath: "creative.svg" },
    }]);
    vi.mocked(getPrivateSignatureArtifact).mockResolvedValue({ stream: new Response("<svg />").body } as never);

    await expect(getSignatureCollectionZip("collection-1")).resolves.toMatchObject({ fileCount: 1 });
    expect(getPrivateSignatureArtifact).toHaveBeenCalledWith("creative.svg");
  });
});

describe("signature history erasure", () => {
  it("removes every retained revision for one signer", async () => {
    tx.signatureCapture.findUnique.mockResolvedValue({
      id: "capture-1",
      captureVersion: 3,
      currentRevision: { id: "revision-3", pngHash: "png-3", svgHash: "svg-3" },
      collection: { status: SignatureCollectionStatus.OPEN },
      revisions: [
        { id: "revision-2", pngPath: "two.png", svgPath: "two.svg" },
        { id: "revision-3", pngPath: "three.png", svgPath: "three.svg" },
      ],
    });
    tx.signatureCapture.update.mockResolvedValue({ captureVersion: 4 });
    tx.signatureArtifactRevision.updateMany.mockResolvedValue({ count: 2 });
    dbMock.signatureArtifactRevision.updateMany.mockResolvedValue({ count: 1 });

    await expect(removeSignatureCapture({ actor, collectionId: "collection-1", memberId: "member-1", expectedCaptureVersion: 3 })).resolves.toEqual({
      removed: true,
      captureVersion: 4,
    });

    expect(tx.signatureArtifactRevision.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["revision-2", "revision-3"] } },
      data: expect.objectContaining({ state: "PENDING_DELETE" }),
    }));
    expect(deletePrivateSignatureArtifacts).toHaveBeenCalledWith(["two.png", "two.svg"]);
    expect(deletePrivateSignatureArtifacts).toHaveBeenCalledWith(["three.png", "three.svg"]);
  });

  it("resets all retained revisions across the collection", async () => {
    tx.signatureCollection.findUnique.mockResolvedValue({ id: "collection-1", status: SignatureCollectionStatus.OPEN, collectionVersion: 5 });
    tx.signatureCapture.findMany.mockResolvedValue([
      {
        id: "capture-1",
        currentRevisionId: "revision-2",
        captureVersion: 2,
        revisions: [
          { id: "revision-1", pngPath: "one.png", svgPath: "one.svg" },
          { id: "revision-2", pngPath: "two.png", svgPath: "two.svg" },
        ],
      },
    ]);
    tx.signatureCapture.updateMany.mockResolvedValue({ count: 1 });
    tx.signatureArtifactRevision.updateMany.mockResolvedValue({ count: 2 });
    tx.signatureCollection.update.mockResolvedValue({ collectionVersion: 6 });
    dbMock.signatureArtifactRevision.updateMany.mockResolvedValue({ count: 1 });

    await expect(resetSignatureCollection({ actor, collectionId: "collection-1", expectedCollectionVersion: 5 })).resolves.toEqual({
      collectionVersion: 6,
      resetCount: 1,
    });

    expect(tx.signatureArtifactRevision.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["revision-1", "revision-2"] } },
      data: expect.objectContaining({ state: "PENDING_DELETE" }),
    }));
  });

  it("archives, cleans, and then removes a collection in dependency-safe order", async () => {
    tx.signatureCollection.findUnique
      .mockResolvedValueOnce({ id: "collection-1", status: SignatureCollectionStatus.OPEN, collectionVersion: 5 })
      .mockResolvedValueOnce({ id: "collection-1", status: SignatureCollectionStatus.ARCHIVED, collectionVersion: 6 });
    tx.signatureCapture.findMany.mockResolvedValue([{ id: "capture-1" }]);
    tx.signatureArtifactRevision.findMany
      .mockResolvedValueOnce([{ id: "revision-1", pngPath: "one.png", svgPath: "one.svg" }])
      .mockResolvedValueOnce([]);
    tx.signatureCollection.update.mockResolvedValue({ collectionVersion: 6 });
    dbMock.signatureArtifactRevision.updateMany.mockResolvedValue({ count: 1 });

    await expect(deleteSignatureCollection({ actor: { id: "admin-1", role: Role.ADMIN }, collectionId: "collection-1", expectedCollectionVersion: 5 })).resolves.toEqual({ deleted: true });

    expect(tx.signatureCapture.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["capture-1"] } },
      data: { currentRevisionId: null, captureVersion: { increment: 1 } },
    }));
    expect(deletePrivateSignatureArtifacts).toHaveBeenCalledWith(["one.png", "one.svg"]);
    expect(tx.signatureSaveOperation.deleteMany).toHaveBeenCalledWith({ where: { collectionId: "collection-1" } });
    expect(tx.signatureMember.updateMany).toHaveBeenCalledWith({ where: { collectionId: "collection-1" }, data: { sourceSnapshotId: null } });
    expect(tx.signatureCollection.delete).toHaveBeenCalledWith({ where: { id: "collection-1" } });
  });

  it("keeps an archived collection retryable when private cleanup fails", async () => {
    tx.signatureCollection.findUnique.mockResolvedValueOnce({ id: "collection-1", status: SignatureCollectionStatus.OPEN, collectionVersion: 5 });
    tx.signatureCapture.findMany.mockResolvedValue([]);
    tx.signatureArtifactRevision.findMany.mockResolvedValue([{ id: "revision-1", pngPath: "one.png", svgPath: "one.svg" }]);
    tx.signatureCollection.update.mockResolvedValue({ collectionVersion: 6 });
    vi.mocked(deletePrivateSignatureArtifacts).mockRejectedValueOnce(new Error("private store unavailable"));

    await expect(deleteSignatureCollection({ actor: { id: "admin-1", role: Role.ADMIN }, collectionId: "collection-1", expectedCollectionVersion: 5 })).rejects.toMatchObject({
      status: 503,
      message: "Some signature files could not be removed; the archived roster was kept for retry",
    });
    expect(tx.signatureCollection.delete).not.toHaveBeenCalled();
  });

  it("does not clean a pending revision while a live save still owns it", async () => {
    dbMock.signatureArtifactRevision.findMany.mockResolvedValue([]);

    await expect(cleanupPendingSignatureArtifacts()).resolves.toEqual({ abandoned: 1, attempted: 0, deleted: 0 });

    expect(dbMock.signatureSaveOperation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: [SignatureSaveStatus.UPLOADING, SignatureSaveStatus.FINALIZING] },
        updatedAt: { lte: expect.any(Date) },
      }),
      data: expect.objectContaining({ status: SignatureSaveStatus.FAILED }),
    }));
    expect(dbMock.signatureArtifactRevision.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        state: SignatureArtifactState.PENDING_DELETE,
        saveOperations: { none: { status: { in: [SignatureSaveStatus.UPLOADING, SignatureSaveStatus.FINALIZING, SignatureSaveStatus.COMMITTED] } } },
      },
    }));
    expect(deletePrivateSignatureArtifacts).not.toHaveBeenCalled();
  });

  it("reports abandoned save operations separately from pending artifact cleanup", async () => {
    dbMock.signatureSaveOperation.updateMany.mockResolvedValue({ count: 2 });
    dbMock.signatureArtifactRevision.findMany.mockResolvedValue([]);

    await expect(cleanupPendingSignatureArtifacts()).resolves.toEqual({ abandoned: 2, attempted: 0, deleted: 0 });
  });

  it("cleans pending revisions with bounded Blob concurrency and one durable state update", async () => {
    const revisions = Array.from({ length: 10 }, (_, index) => ({
      id: `revision-${index}`,
      pngPath: `${index}.png`,
      svgPath: `${index}.svg`,
    }));
    dbMock.signatureArtifactRevision.findMany.mockResolvedValue(revisions);
    dbMock.signatureArtifactRevision.updateMany.mockResolvedValue({ count: revisions.length });
    let active = 0;
    let maximumActive = 0;
    vi.mocked(deletePrivateSignatureArtifacts).mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
    });

    await expect(cleanupPendingSignatureArtifacts(revisions.length)).resolves.toEqual({
      abandoned: 1,
      attempted: revisions.length,
      deleted: revisions.length,
    });

    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(8);
    expect(deletePrivateSignatureArtifacts).toHaveBeenCalledTimes(revisions.length);
    expect(dbMock.signatureArtifactRevision.updateMany).toHaveBeenCalledTimes(1);
    expect(dbMock.signatureArtifactRevision.updateMany).toHaveBeenCalledWith({
      where: { id: { in: revisions.map((revision) => revision.id) }, state: SignatureArtifactState.PENDING_DELETE },
      data: { state: SignatureArtifactState.DELETED, deletedAt: expect.any(Date) },
    });
  });
});

describe("roster apply concurrency", () => {
  it("returns an already-applied snapshot after a duplicate tap even when the observed version is stale", async () => {
    tx.signatureRosterSnapshot.findUnique.mockResolvedValue({
      id: "snapshot-1",
      collectionId: "collection-1",
      status: SignatureSnapshotStatus.APPLIED,
      collection: { status: SignatureCollectionStatus.OPEN, collectionVersion: 2 },
    });
    tx.signatureRosterSnapshot.findFirst.mockResolvedValue({ id: "snapshot-1" });
    tx.signatureMember.count.mockResolvedValue(18);

    await expect(applySignatureRosterSnapshot({
      actor,
      snapshotId: "snapshot-1",
      expectedCollectionVersion: 1,
    })).resolves.toEqual({
      collectionId: "collection-1",
      collectionVersion: 2,
      memberCount: 18,
      unchanged: true,
    });
    expect(tx.signatureMember.update).not.toHaveBeenCalled();
    expect(tx.signatureCollection.update).not.toHaveBeenCalled();
    expect(dbMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      maxWait: 10_000,
      timeout: 30_000,
    });
  });
});

describe("roster identity merge", () => {
  it("moves a signed historical capture when the normalized player name matches despite a jersey change", async () => {
    const entry = {
      sourceExternalId: "14146",
      sourceProfileUrl: "https://uwbadgers.com/sports/football/roster/aaron-witt/14146",
      name: "Aaron Witt",
      normalizedName: "aaron witt",
      jerseyNumber: 92,
      roleGroup: "PLAYER",
      title: "Linebacker • Senior",
      hometown: null,
    } as const;
    const targetCapture = {
      id: "current-capture",
      memberId: "current-member",
      captureVersion: 0,
      currentRevisionId: null,
      capturedAt: null,
      capturedById: null,
      currentRevision: null,
      saveOperations: [],
      _count: { revisions: 0 },
    };
    const historicalCapture = {
      id: "historical-capture",
      memberId: "historical-member",
      captureVersion: 2,
      currentRevisionId: "historical-revision",
      capturedAt: new Date("2026-08-20T12:00:00Z"),
      capturedById: "staff-1",
      currentRevision: { id: "historical-revision", state: SignatureArtifactState.READY },
      saveOperations: [],
      _count: { revisions: 2 },
    };
    const target = {
      id: "current-member",
      sourceExternalId: "14146",
      sourceProfileUrl: entry.sourceProfileUrl,
      name: "Aaron Witt",
      normalizedName: entry.normalizedName,
      jerseyNumber: entry.jerseyNumber,
      roleGroup: "PLAYER",
      title: entry.title,
      active: true,
      required: true,
      birthday: null,
      hometown: null,
      instagramHandle: null,
      tiktokHandle: null,
      xHandle: null,
      capture: targetCapture,
    };
    const historical = {
      id: "historical-member",
      sourceExternalId: "15412",
      sourceProfileUrl: "https://uwbadgers.com/sports/football/roster/aaron-witt/15412",
      name: "Aaron Witt",
      normalizedName: entry.normalizedName,
      jerseyNumber: 59,
      roleGroup: "PLAYER",
      title: "Linebacker • Junior",
      active: false,
      required: true,
      birthday: null,
      hometown: null,
      instagramHandle: null,
      tiktokHandle: null,
      xHandle: null,
      capture: historicalCapture,
    };
    tx.signatureRosterSnapshot.findUnique.mockResolvedValue({
      id: "snapshot-1",
      collectionId: "collection-1",
      status: SignatureSnapshotStatus.PREVIEW,
      entries: [entry],
      collection: { status: SignatureCollectionStatus.OPEN, collectionVersion: 4, settingsVersion: 1 },
    });
    tx.signatureMember.findMany
      .mockResolvedValueOnce([target, historical])
      .mockResolvedValueOnce([{ id: "current-member" }, { id: "historical-member" }]);
    tx.signatureCapture.findMany.mockResolvedValue([historicalCapture, targetCapture]);
    tx.signatureArtifactRevision.updateMany.mockResolvedValue({ count: 2 });
    tx.signatureSaveOperation.updateMany.mockResolvedValue({ count: 0 });
    tx.signatureCollection.update.mockResolvedValue({ id: "collection-1", collectionVersion: 5 });

    await expect(applySignatureRosterSnapshot({
      actor,
      snapshotId: "snapshot-1",
      expectedCollectionVersion: 4,
    })).resolves.toMatchObject({
      collectionId: "collection-1",
      collectionVersion: 5,
      memberCount: 2,
      mergedCount: 1,
      merges: [{
        sourceExternalId: "15412",
        targetSourceExternalId: "14146",
        artifactTransferred: true,
        transferredRevisionCount: 2,
      }],
    });

    expect(tx.signatureCapture.update).toHaveBeenNthCalledWith(1, {
      where: { id: "historical-capture" },
      data: { currentRevisionId: null },
    });
    expect(tx.signatureArtifactRevision.updateMany).toHaveBeenCalledWith({
      where: { captureId: "historical-capture" },
      data: { captureId: "current-capture" },
    });
    expect(tx.signatureCapture.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: "current-capture" },
      data: expect.objectContaining({ currentRevisionId: "historical-revision" }),
    }));
    expect(createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "MERGE_ROSTER_MEMBER",
      entityId: "current-member",
      before: expect.objectContaining({ matchedBy: ["normalizedName", "roleGroup"] }),
    }));
  });

  it("leaves duplicate normalized-name candidates for review", async () => {
    const entry = {
      sourceExternalId: "new-player",
      sourceProfileUrl: "https://uwbadgers.com/sports/football/roster/jordan-smith/new-player",
      name: "Jordan Smith",
      normalizedName: "jordan smith",
      jerseyNumber: 10,
      roleGroup: "PLAYER",
      title: "Safety • Junior",
    } as const;
    const historical = (id: string, sourceExternalId: string, jerseyNumber: number) => ({
      id,
      sourceExternalId,
      normalizedName: entry.normalizedName,
      jerseyNumber,
      roleGroup: "PLAYER",
      active: false,
    });
    tx.signatureRosterSnapshot.findUnique.mockResolvedValue({
      id: "snapshot-1",
      collectionId: "collection-1",
      status: SignatureSnapshotStatus.PREVIEW,
      entries: [entry],
      collection: { status: SignatureCollectionStatus.OPEN, collectionVersion: 4, settingsVersion: 1 },
    });
    tx.signatureMember.findMany
      .mockResolvedValueOnce([
        historical("historical-1", "old-1", 10),
        historical("historical-2", "old-2", 21),
      ])
      .mockResolvedValueOnce([{ id: "new-member" }, { id: "historical-1" }, { id: "historical-2" }]);
    tx.signatureMember.create.mockResolvedValue({ id: "new-member", required: true });
    tx.signatureCollection.update.mockResolvedValue({ id: "collection-1", collectionVersion: 5 });

    await expect(applySignatureRosterSnapshot({
      actor,
      snapshotId: "snapshot-1",
      expectedCollectionVersion: 4,
    })).resolves.toMatchObject({ mergedCount: 0, memberCount: 3 });

    expect(tx.signatureCapture.findMany).not.toHaveBeenCalled();
    expect(tx.signatureArtifactRevision.updateMany).not.toHaveBeenCalled();
  });

  it("does not resurrect a historical signature that was explicitly erased", async () => {
    const entry = {
      sourceExternalId: "new-player",
      sourceProfileUrl: "https://uwbadgers.com/sports/football/roster/erased-player/new-player",
      name: "Erased Player",
      normalizedName: "erased player",
      jerseyNumber: 44,
      roleGroup: "PLAYER",
      title: "Cornerback • Sophomore",
    } as const;
    tx.signatureRosterSnapshot.findUnique.mockResolvedValue({
      id: "snapshot-1",
      collectionId: "collection-1",
      status: SignatureSnapshotStatus.PREVIEW,
      entries: [entry],
      collection: { status: SignatureCollectionStatus.OPEN, collectionVersion: 4, settingsVersion: 1 },
    });
    tx.signatureMember.findMany
      .mockResolvedValueOnce([{
        id: "historical-member",
        sourceExternalId: "old-player",
        normalizedName: entry.normalizedName,
        jerseyNumber: 44,
        roleGroup: "PLAYER",
        active: false,
        capture: {
          id: "historical-capture",
          captureVersion: 3,
          currentRevisionId: null,
          currentRevision: null,
          capturedAt: null,
          capturedById: null,
          saveOperations: [],
          _count: { revisions: 1 },
        },
      }])
      .mockResolvedValueOnce([{ id: "new-member" }, { id: "historical-member" }]);
    tx.signatureMember.create.mockResolvedValue({ id: "new-member", required: true });
    tx.signatureCollection.update.mockResolvedValue({ id: "collection-1", collectionVersion: 5 });

    await expect(applySignatureRosterSnapshot({
      actor,
      snapshotId: "snapshot-1",
      expectedCollectionVersion: 4,
    })).resolves.toMatchObject({ mergedCount: 0, memberCount: 2 });

    expect(tx.signatureCapture.findMany).not.toHaveBeenCalled();
    expect(tx.signatureArtifactRevision.updateMany).not.toHaveBeenCalled();
  });
});

describe("signature collection detail shape", () => {
  it("loads one applied snapshot and an explicitly bounded READY revision history", async () => {
    const revision = (number: number) => ({
      id: `revision-${number}`,
      revision: number,
      state: SignatureArtifactState.READY,
      width: 100,
      height: 80,
      pngHash: `png-${number}`,
      svgHash: `svg-${number}`,
      pngPath: `${number}.png`,
      svgPath: `${number}.svg`,
      committedAt: new Date(`2026-08-${String(10 + number).padStart(2, "0")}T12:00:00.000Z`),
      replacedAt: number === 6 ? null : new Date("2026-08-18T12:00:00.000Z"),
    });
    dbMock.signatureCollection.findUnique.mockResolvedValue({
      id: "collection-1",
      sportCode: "MBB",
      season: "2026-27",
      status: SignatureCollectionStatus.OPEN,
      collectionVersion: 4,
      settingsVersion: 1,
      penSettings: { strokeColor: "#111827", strokeWidth: 4, cropPadding: 24, maxWidth: 1600, maxHeight: 900 },
      snapshots: [],
      members: [{
        id: "player-1",
        sourceExternalId: "player-1",
        name: "Bucky Badger",
        jerseyNumber: 1,
        title: "Guard",
        roleGroup: "PLAYER",
        required: true,
        active: true,
        linkedUserId: null,
        birthday: null,
        hometown: null,
        instagramHandle: null,
        tiktokHandle: null,
        xHandle: null,
        capture: {
          captureVersion: 6,
          settingsVersion: 1,
          currentRevision: revision(6),
          revisions: [6, 5, 4, 3, 2, 1].map(revision),
          _count: { revisions: 8 },
        },
      }],
    });

    const detail = await getSignatureCollection("collection-1");
    expect(detail).toMatchObject({
      members: [{
        artifact: { id: "revision-6" },
        revisions: [
          { id: "revision-6" },
          { id: "revision-5" },
          { id: "revision-4" },
          { id: "revision-3" },
          { id: "revision-2" },
          { id: "revision-1" },
        ],
        revisionCount: 8,
        revisionHistoryTruncated: true,
      }],
    });
    expect(detail.members[0]).not.toHaveProperty("athleteProfile");
    expect(detail.members[0]).not.toHaveProperty("athleteProfileComplete");

    const query = dbMock.signatureCollection.findUnique.mock.calls.at(-1)?.[0] as {
      include: { members: { include: Record<string, unknown> } };
    };
    expect(query.include.members.include).not.toHaveProperty("sourceSnapshot");
    expect(query.include.members.include).toMatchObject({
      capture: {
        include: {
          revisions: { take: 6 },
          _count: { select: { revisions: { where: { state: SignatureArtifactState.READY } } } },
        },
      },
    });
  });
});

describe("signature member capture bootstrap", () => {
  it("returns only the requested member and its effective capture contract", async () => {
    dbMock.signatureMember.findFirst.mockResolvedValue({
      id: "player-1",
      name: "Bucky Badger",
      jerseyNumber: 1,
      title: "Guard",
      roleGroup: "PLAYER",
      active: true,
      linkedUserId: null,
      collection: {
        id: "collection-1",
        sportCode: "MBB",
        season: "2026-27",
        status: SignatureCollectionStatus.OPEN,
        collectionVersion: 4,
      },
      capture: {
        captureVersion: 2,
        settingsVersion: 3,
        currentRevision: { id: "revision-2", state: SignatureArtifactState.READY },
        collection: {
          sportCode: "MBB",
          season: "2026-27",
          status: SignatureCollectionStatus.OPEN,
          settingsVersion: 3,
          penSettings: { strokeColor: "#111827", strokeWidth: 4, cropPadding: 24, maxWidth: 1600, maxHeight: 900 },
        },
      },
    });

    await expect(getSignatureMemberCaptureBootstrap("collection-1", "player-1")).resolves.toEqual({
      collection: {
        id: "collection-1",
        season: "2026-27",
        status: SignatureCollectionStatus.OPEN,
        collectionVersion: 4,
      },
      member: {
        id: "player-1",
        name: "Bucky Badger",
        jerseyNumber: 1,
        title: "Guard",
        roleGroup: "PLAYER",
        active: true,
        captureVersion: 2,
        settingsVersion: 3,
        captureSettings: { strokeColor: "#111827", strokeWidth: 4, cropPadding: 24, maxWidth: 1600, maxHeight: 900 },
        artifact: { id: "revision-2" },
      },
    });

    const query = dbMock.signatureMember.findFirst.mock.calls.at(-1)?.[0] as {
      select: { capture: { select: Record<string, unknown> } } & Record<string, unknown>;
    };
    expect(query.select).not.toHaveProperty("sourceProfileUrl");
    expect(query.select).not.toHaveProperty("birthday");
    expect(query.select).not.toHaveProperty("hometown");
    expect(query.select).not.toHaveProperty("instagramHandle");
    expect(query.select).not.toHaveProperty("tiktokHandle");
    expect(query.select).not.toHaveProperty("xHandle");
    expect(query.select.capture.select).not.toHaveProperty("revisions");
  });
});

describe("roster source metadata", () => {
  it("keeps official hometowns in the snapshot without writing profile fields", async () => {
    tx.signatureRosterSnapshot.findUnique.mockResolvedValue({
      id: "snapshot-1",
      collectionId: "collection-1",
      status: SignatureSnapshotStatus.PREVIEW,
      entries: [
        {
          sourceExternalId: "existing-player",
          sourceProfileUrl: "https://uwbadgers.com/sports/mens-basketball/roster/existing-player/1",
          name: "Existing Player",
          normalizedName: "existing player",
          jerseyNumber: 4,
          roleGroup: "PLAYER",
          title: "Guard • Junior",
          hometown: "Madison, Wis.",
        },
        {
          sourceExternalId: "new-player",
          sourceProfileUrl: "https://uwbadgers.com/sports/mens-basketball/roster/new-player/2",
          name: "New Player",
          normalizedName: "new player",
          jerseyNumber: 5,
          roleGroup: "PLAYER",
          title: "Forward • Freshman",
          hometown: "Austin, Texas",
        },
      ],
      collection: { status: SignatureCollectionStatus.OPEN, collectionVersion: 4, settingsVersion: 1 },
    });
    tx.signatureMember.findMany
      .mockResolvedValueOnce([{ id: "member-existing", sourceExternalId: "existing-player", required: true, roleGroup: "PLAYER" }])
      .mockResolvedValueOnce([{ id: "member-existing" }, { id: "member-new" }]);
    tx.signatureMember.create.mockResolvedValue({ id: "member-new", sourceExternalId: "new-player", required: true, roleGroup: "PLAYER" });
    tx.signatureCollection.update.mockResolvedValue({ id: "collection-1", collectionVersion: 5 });

    await expect(applySignatureRosterSnapshot({
      actor,
      snapshotId: "snapshot-1",
      expectedCollectionVersion: 4,
    })).resolves.toMatchObject({ collectionId: "collection-1", collectionVersion: 5, memberCount: 2 });

    const existingUpdate = tx.signatureMember.update.mock.calls.find(([call]) => call.where?.id === "member-existing")?.[0];
    const newMemberCreate = tx.signatureMember.create.mock.calls.find(([call]) => call.data?.sourceExternalId === "new-player")?.[0];
    expect(existingUpdate?.data).not.toHaveProperty("hometown");
    expect(newMemberCreate?.data).not.toHaveProperty("hometown");
  });
});

describe("sport roster previews", () => {
  it.each(["FB", "VB"] as const)("creates a %s collection preview without falling back to MBB", async (sportCode) => {
    tx.signatureCollection.upsert.mockResolvedValue({
      id: `${sportCode.toLowerCase()}-collection`,
      collectionVersion: 1,
      status: SignatureCollectionStatus.OPEN,
    });
    tx.signatureRosterSnapshot.findUnique.mockResolvedValue(null);
    tx.signatureRosterSnapshot.create.mockResolvedValue({
      id: `${sportCode.toLowerCase()}-snapshot`,
      createdAt: new Date("2026-08-16T12:00:00Z"),
    });

    await expect(createSignatureRosterPreview({
      actor,
      sportCode,
      season: "2026-27",
      sourceUrl: `https://uwbadgers.com/${sportCode.toLowerCase()}`,
      sourceHash: `${sportCode.toLowerCase()}-hash`,
      parserVersion: `uwbadgers-${sportCode.toLowerCase()}-v1`,
      fetchedAt: new Date("2026-08-16T12:00:00Z"),
      entries: [{
        sourceExternalId: `${sportCode.toLowerCase()}-player-1`,
        sourceProfileUrl: "https://uwbadgers.com/sports/roster/player/1",
        name: "Test Player",
        normalizedName: "test player",
        jerseyNumber: 1,
        roleGroup: "PLAYER",
        title: "Guard • Junior",
      }],
    })).resolves.toMatchObject({
      collectionId: `${sportCode.toLowerCase()}-collection`,
      snapshotId: `${sportCode.toLowerCase()}-snapshot`,
      candidateCount: 1,
    });

    expect(tx.signatureCollection.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { sportCode_season: { sportCode, season: "2026-27" } },
      create: expect.objectContaining({ sportCode, season: "2026-27" }),
    }));
    expect(tx.signatureRosterSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourceKey: `UW_BADGERS_${sportCode}` }),
    }));
  });

  it("seeds Administration members as required standalone support staff", async () => {
    tx.signatureRosterSnapshot.findUnique.mockResolvedValue({
      id: "admin-snapshot",
      collectionId: "admin-collection",
      status: SignatureSnapshotStatus.PREVIEW,
      entries: [{
        sourceExternalId: "1325",
        sourceProfileUrl: "https://uwbadgers.com/staff-directory/shawn-eichorst/1325",
        name: "Shawn Eichorst",
        normalizedName: "shawn eichorst",
        jerseyNumber: null,
        roleGroup: "SUPPORT_STAFF",
        title: "Director of Athletics",
      }],
      collection: { sportCode: "ADMIN", status: SignatureCollectionStatus.OPEN, collectionVersion: 1, settingsVersion: 1 },
    });
    tx.signatureMember.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "admin-member" }]);
    tx.signatureMember.create.mockResolvedValue({ id: "admin-member", sourceExternalId: "1325", required: true, roleGroup: "SUPPORT_STAFF" });
    tx.signatureCollection.update.mockResolvedValue({ id: "admin-collection", collectionVersion: 2 });

    await expect(applySignatureRosterSnapshot({
      actor,
      snapshotId: "admin-snapshot",
      expectedCollectionVersion: 1,
    })).resolves.toMatchObject({ collectionId: "admin-collection", collectionVersion: 2, memberCount: 1 });

    expect(tx.signatureMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        collectionId: "admin-collection",
        name: "Shawn Eichorst",
        roleGroup: "SUPPORT_STAFF",
        title: "Director of Athletics",
        required: true,
      }),
    });
  });
});

describe("ad-hoc signatures", () => {
  it("creates a required manual signer and capture in the season ad-hoc roster", async () => {
    tx.signatureCollection.upsert.mockResolvedValue({
      id: "ad-hoc-collection",
      status: SignatureCollectionStatus.OPEN,
      collectionVersion: 2,
      settingsVersion: 1,
    });
    tx.signatureMember.create.mockResolvedValue({ id: "member-1", name: "Bucky Badger", title: "Alumni" });
    tx.signatureCapture.create.mockResolvedValue({ id: "capture-1" });
    tx.signatureCollection.update.mockResolvedValue({ collectionVersion: 3 });

    await expect(createAdHocSignatureMember({
      actor,
      season: "2026-27",
      name: "  Bucky Badger  ",
      category: " Alumni ",
    })).resolves.toMatchObject({
      collectionId: "ad-hoc-collection",
      memberId: "member-1",
      collectionVersion: 3,
    });

    expect(tx.signatureMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        collectionId: "ad-hoc-collection",
        name: "Bucky Badger",
        normalizedName: "bucky badger",
        roleGroup: "SUPPORT_STAFF",
        title: "Alumni",
        required: true,
      }),
      select: expect.any(Object),
    });
    expect(tx.signatureCapture.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ collectionId: "ad-hoc-collection", memberId: "member-1" }),
    });
  });
});

describe("signature readiness requirements", () => {
  it("counts only student-athletes in primary progress and linked staff in the quiet secondary count", async () => {
    dbMock.signatureCollection.findMany.mockResolvedValue([{
      id: "collection-1",
      sportCode: "MBB",
      season: "2026-27",
      status: SignatureCollectionStatus.OPEN,
      collectionVersion: 4,
      settingsVersion: 1,
      updatedAt: new Date("2026-08-16T12:00:00.000Z"),
      members: [
        { id: "player-1", active: true, required: true, roleGroup: "PLAYER", linkedUserId: null },
        { id: "player-2", active: true, required: true, roleGroup: "PLAYER", linkedUserId: null },
        { id: "coach-1", active: true, required: true, roleGroup: "COACHING_STAFF", linkedUserId: "user-1" },
        { id: "staff-1", active: true, required: false, roleGroup: "SUPPORT_STAFF", linkedUserId: null },
      ],
      captures: [{ memberId: "player-1" }],
    }]);
    dbMock.signatureCapture.findMany.mockResolvedValue([
      { collection: { season: "2026-27" }, member: { linkedUserId: "user-1" } },
    ]);

    await expect(listSignatureCollections()).resolves.toMatchObject([{
      completeness: { complete: 1, required: 2, percent: 50 },
      staffCompleteness: { complete: 1, total: 2 },
    }]);
  });

  it("rejects making a player optional", async () => {
    tx.signatureCollection.findUnique.mockResolvedValue({ collectionVersion: 4, status: SignatureCollectionStatus.OPEN });
    tx.signatureMember.findFirst.mockResolvedValue({ id: "player-1", required: true, roleGroup: "PLAYER" });

    await expect(updateSignatureMemberRequired({
      actor,
      collectionId: "collection-1",
      memberId: "player-1",
      required: false,
      expectedCollectionVersion: 4,
    })).rejects.toMatchObject({ status: 400, message: "Players always require a signature" });

    expect(tx.signatureMember.update).not.toHaveBeenCalled();
    expect(tx.signatureCollection.update).not.toHaveBeenCalled();
  });

  it("keeps readiness controls available for non-player members", async () => {
    tx.signatureCollection.findUnique.mockResolvedValue({ collectionVersion: 4, status: SignatureCollectionStatus.OPEN });
    tx.signatureMember.findFirst.mockResolvedValue({ id: "staff-1", required: true, roleGroup: "SUPPORT_STAFF" });
    tx.signatureMember.update.mockResolvedValue({ id: "staff-1" });
    tx.signatureCollection.update.mockResolvedValue({ collectionVersion: 5 });

    await expect(updateSignatureMemberRequired({
      actor,
      collectionId: "collection-1",
      memberId: "staff-1",
      required: false,
      expectedCollectionVersion: 4,
    })).resolves.toEqual({ collectionVersion: 5 });

    expect(tx.signatureMember.update).toHaveBeenCalledWith({ where: { id: "staff-1" }, data: { required: false } });
  });
});

describe("Creative staff roster sync", () => {
  it("creates a standalone Creative staff collection", async () => {
    tx.signatureCollection.findUnique.mockResolvedValue(null);
    tx.signatureCollection.create.mockResolvedValue({
      id: "creative-collection-1",
      sportCode: "CREATIVE",
      season: "2026-27",
      status: SignatureCollectionStatus.OPEN,
      collectionVersion: 1,
    });

    await expect(ensureSignatureCreativeStaffCollection({ actor, season: "2026-27" })).resolves.toMatchObject({
      id: "creative-collection-1",
      sportCode: "CREATIVE",
      season: "2026-27",
      created: true,
    });
    expect(tx.signatureCollection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sportCode: "CREATIVE", season: "2026-27" }),
      select: expect.any(Object),
    });
  });

  it("adds active full-time staff identified by area or creative job title", async () => {
    tx.signatureCollection.findUnique.mockResolvedValue({ id: "collection-1", sportCode: "CREATIVE", status: SignatureCollectionStatus.OPEN, collectionVersion: 4, settingsVersion: 2 });
    tx.user.findMany.mockResolvedValue([{ id: "user-jerry", name: "Jerry Mao", title: "Creative Director" }]);
    tx.signatureMember.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "member-1" }]);
    tx.signatureMember.create.mockResolvedValue({ id: "member-1" });
    tx.signatureCapture.createMany.mockResolvedValue({ count: 1 });
    tx.signatureCollection.update.mockResolvedValue({ collectionVersion: 5 });

    await expect(syncSignatureCreativeStaff({
      actor,
      collectionId: "collection-1",
      expectedCollectionVersion: 4,
    })).resolves.toMatchObject({
      activeCount: 1,
      added: 1,
      collectionVersion: 5,
      unchanged: false,
    });

    expect(tx.signatureMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceExternalId: "creative-staff:user-jerry",
        linkedUserId: "user-jerry",
        roleGroup: "CREATIVE_STAFF",
        required: true,
      }),
    });
    expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        active: true,
        hiddenFromRoster: false,
        staffingType: "FT",
        OR: expect.arrayContaining([
          { title: { contains: "Creative", mode: "insensitive" } },
          { title: { contains: "Digital Media", mode: "insensitive" } },
        ]),
      }),
    }));
  });

  it("is version-checked and leaves an unchanged roster idempotent", async () => {
    tx.signatureCollection.findUnique.mockResolvedValue({ id: "collection-1", sportCode: "CREATIVE", status: SignatureCollectionStatus.OPEN, collectionVersion: 4, settingsVersion: 2 });
    tx.user.findMany.mockResolvedValue([{ id: "user-1", name: "Erik Role", title: "Creative Director" }]);
    tx.signatureMember.findMany
      .mockResolvedValueOnce([{ id: "member-1", linkedUserId: "user-1", required: true, active: true, name: "Erik Role", title: "Creative Director" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "member-1" }]);
    tx.signatureCapture.createMany.mockResolvedValue({ count: 0 });

    await expect(syncSignatureCreativeStaff({
      actor,
      collectionId: "collection-1",
      expectedCollectionVersion: 4,
    })).resolves.toMatchObject({ unchanged: true, collectionVersion: 4, activeCount: 1 });

    expect(tx.signatureCollection.update).not.toHaveBeenCalled();
    expect(tx.signatureMember.create).not.toHaveBeenCalled();
  });

  it("links an exact uniquely named team staff member to the Creative Staff identity", async () => {
    tx.signatureCollection.findUnique.mockResolvedValue({ id: "collection-1", sportCode: "CREATIVE", season: "2026-27", status: SignatureCollectionStatus.OPEN, collectionVersion: 4, settingsVersion: 2 });
    tx.user.findMany.mockResolvedValue([{ id: "user-1", name: "AJ Harrison", title: "Brand Communications" }]);
    tx.signatureMember.findMany
      .mockResolvedValueOnce([{ id: "creative-member", linkedUserId: "user-1", required: true, active: true, name: "AJ Harrison", title: "Brand Communications" }])
      .mockResolvedValueOnce([{ id: "team-member", normalizedName: "aj harrison", linkedUserId: null }])
      .mockResolvedValueOnce([{ id: "creative-member" }]);
    tx.signatureMember.updateMany.mockResolvedValue({ count: 1 });
    tx.signatureCapture.createMany.mockResolvedValue({ count: 0 });
    tx.signatureCollection.update.mockResolvedValue({ collectionVersion: 5 });

    await expect(syncSignatureCreativeStaff({ actor, collectionId: "collection-1", expectedCollectionVersion: 4 })).resolves.toMatchObject({
      linkedTeamMembers: 1,
      collectionVersion: 5,
      unchanged: false,
    });

    expect(tx.signatureMember.updateMany).toHaveBeenCalledWith({
      where: { id: "team-member", linkedUserId: null },
      data: { linkedUserId: "user-1" },
    });
  });

  it("rejects attempts to nest Creative staff inside a team roster", async () => {
    tx.signatureCollection.findUnique.mockResolvedValue({ id: "collection-1", sportCode: "MBB", status: SignatureCollectionStatus.OPEN, collectionVersion: 4, settingsVersion: 2 });

    await expect(syncSignatureCreativeStaff({
      actor,
      collectionId: "collection-1",
      expectedCollectionVersion: 4,
    })).rejects.toMatchObject({ status: 409 });
    expect(tx.user.findMany).not.toHaveBeenCalled();
  });
});
