import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role, SignatureArtifactState, SignatureCollectionStatus, SignatureMemberGroup } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const tx = {
    signatureCollection: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    signatureCapture: { findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    signatureArtifactRevision: { findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    signatureSaveOperation: { updateMany: vi.fn(), deleteMany: vi.fn() },
    signatureMember: { updateMany: vi.fn(), deleteMany: vi.fn() },
    signatureRosterSnapshot: { deleteMany: vi.fn() },
  };
  return {
    tx,
    db: {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
      signatureCollection: { findMany: vi.fn(), findUnique: vi.fn() },
      signatureCapture: { findMany: vi.fn(), findFirst: vi.fn() },
      signatureMember: { findFirst: vi.fn() },
      signatureArtifactRevision: { findMany: vi.fn() },
    },
    audit: vi.fn(),
    cleanup: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.audit }));
vi.mock("@/lib/services/signatures-shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/signatures-shared")>()),
  cleanupSignatureRevisions: mocks.cleanup,
}));

import {
  archiveSignatureCollection,
  deleteSignatureCollection,
  getSignatureCollection,
  getSignatureMemberCaptureBootstrap,
  listSignatureCollections,
  resetSignatureCollection,
  restoreSignatureCollection,
} from "@/lib/services/signature-collections";

const { tx, db } = mocks;
const actor = { id: "admin-1", role: Role.ADMIN };
const input = { actor, collectionId: "c1", expectedCollectionVersion: 4 };
const pen = { strokeColor: "#111827", strokeWidth: 4, cropPadding: 24, maxWidth: 1600, maxHeight: 900 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cleanup.mockResolvedValue({ cleaned: 0, failed: [] });
  tx.signatureCapture.findMany.mockResolvedValue([]);
  tx.signatureArtifactRevision.findMany.mockResolvedValue([]);
});

describe("archive and restore", () => {
  it("archives an open collection, bumps its version and audits it", async () => {
    tx.signatureCollection.findUnique.mockResolvedValue({ id: "c1", status: SignatureCollectionStatus.OPEN, collectionVersion: 4 });
    tx.signatureCollection.update.mockResolvedValue({ id: "c1", status: SignatureCollectionStatus.ARCHIVED, collectionVersion: 5 });

    expect(await archiveSignatureCollection(input)).toEqual({ id: "c1", status: SignatureCollectionStatus.ARCHIVED, collectionVersion: 5 });
    expect(tx.signatureCollection.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: SignatureCollectionStatus.ARCHIVED, archivedById: "admin-1", collectionVersion: { increment: 1 } }),
    }));
    expect(mocks.audit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "ARCHIVE", before: { status: "OPEN", collectionVersion: 4 }, after: { status: "ARCHIVED", collectionVersion: 5 } }));
  });

  it("restores an archived collection and clears who archived it", async () => {
    tx.signatureCollection.findUnique.mockResolvedValue({ id: "c1", status: SignatureCollectionStatus.ARCHIVED, collectionVersion: 4 });
    tx.signatureCollection.update.mockResolvedValue({ id: "c1", status: SignatureCollectionStatus.OPEN, collectionVersion: 5 });

    await restoreSignatureCollection(input);

    expect(tx.signatureCollection.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: SignatureCollectionStatus.OPEN, archivedAt: null, archivedById: null }),
    }));
    expect(mocks.audit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "RESTORE" }));
  });

  it("treats a repeat tap as done, and refuses a missing or changed collection", async () => {
    tx.signatureCollection.findUnique.mockResolvedValueOnce({ id: "c1", status: SignatureCollectionStatus.ARCHIVED, collectionVersion: 9 });
    expect(await archiveSignatureCollection(input)).toEqual(expect.objectContaining({ collectionVersion: 9 }));
    tx.signatureCollection.findUnique.mockResolvedValueOnce({ id: "c1", status: SignatureCollectionStatus.OPEN, collectionVersion: 9 });
    expect(await restoreSignatureCollection(input)).toEqual(expect.objectContaining({ collectionVersion: 9 }));
    expect(tx.signatureCollection.update).not.toHaveBeenCalled();

    tx.signatureCollection.findUnique.mockResolvedValue(null);
    await expect(archiveSignatureCollection(input)).rejects.toMatchObject({ status: 404 });
    await expect(restoreSignatureCollection(input)).rejects.toMatchObject({ status: 404 });

    tx.signatureCollection.findUnique.mockResolvedValueOnce({ id: "c1", status: SignatureCollectionStatus.OPEN, collectionVersion: 3 });
    await expect(archiveSignatureCollection(input)).rejects.toMatchObject({ status: 409 });
    tx.signatureCollection.findUnique.mockResolvedValueOnce({ id: "c1", status: SignatureCollectionStatus.ARCHIVED, collectionVersion: 3 });
    await expect(restoreSignatureCollection(input)).rejects.toMatchObject({ status: 409 });
  });
});

describe("reset", () => {
  it("refuses a missing, archived or changed collection", async () => {
    tx.signatureCollection.findUnique.mockResolvedValueOnce(null);
    await expect(resetSignatureCollection(input)).rejects.toMatchObject({ status: 404 });

    tx.signatureCollection.findUnique.mockResolvedValueOnce({ id: "c1", status: SignatureCollectionStatus.ARCHIVED, collectionVersion: 4 });
    await expect(resetSignatureCollection(input)).rejects.toMatchObject({ status: 409, message: "Archived signature collections are read-only" });

    tx.signatureCollection.findUnique.mockResolvedValueOnce({ id: "c1", status: SignatureCollectionStatus.OPEN, collectionVersion: 2 });
    await expect(resetSignatureCollection(input)).rejects.toMatchObject({ status: 409, message: "Collection changed since this form was opened" });
    expect(tx.signatureCapture.updateMany).not.toHaveBeenCalled();
  });

  it("skips the bulk writes for an empty collection", async () => {
    tx.signatureCollection.findUnique.mockResolvedValue({ id: "c1", status: SignatureCollectionStatus.OPEN, collectionVersion: 4 });
    tx.signatureCollection.update.mockResolvedValue({ collectionVersion: 5 });

    expect(await resetSignatureCollection(input)).toEqual({ collectionVersion: 5, resetCount: 0 });
    expect(tx.signatureCapture.updateMany).not.toHaveBeenCalled();
    expect(tx.signatureArtifactRevision.updateMany).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledWith([]);
  });

  it("bumps blank captures too, so a save in flight cannot land after the reset", async () => {
    tx.signatureCollection.findUnique.mockResolvedValue({ id: "c1", status: SignatureCollectionStatus.OPEN, collectionVersion: 4 });
    tx.signatureCollection.update.mockResolvedValue({ collectionVersion: 5 });
    tx.signatureCapture.findMany.mockResolvedValue([
      { id: "cap1", currentRevisionId: "r1", captureVersion: 2, revisions: [{ id: "r1", pngPath: "a.png", svgPath: "a.svg" }] },
      { id: "cap2", currentRevisionId: null, captureVersion: 1, revisions: [] },
    ]);

    expect(await resetSignatureCollection(input)).toEqual({ collectionVersion: 5, resetCount: 2 });
    expect(tx.signatureCapture.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["cap1", "cap2"] } }, data: { currentRevisionId: null, captureVersion: { increment: 1 } } });
    expect(tx.signatureArtifactRevision.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["r1"] } }, data: expect.objectContaining({ state: SignatureArtifactState.PENDING_DELETE }) });
    expect(mocks.cleanup).toHaveBeenCalledWith([{ id: "r1", pngPath: "a.png", svgPath: "a.svg" }]);
  });
});

describe("delete", () => {
  beforeEach(() => {
    tx.signatureCollection.update.mockResolvedValue({ collectionVersion: 5 });
  });

  it("refuses a missing or changed collection before touching anything", async () => {
    tx.signatureCollection.findUnique.mockResolvedValueOnce(null);
    await expect(deleteSignatureCollection(input)).rejects.toMatchObject({ status: 404 });

    tx.signatureCollection.findUnique.mockResolvedValueOnce({ id: "c1", status: SignatureCollectionStatus.OPEN, collectionVersion: 3 });
    await expect(deleteSignatureCollection(input)).rejects.toMatchObject({ status: 409 });
    expect(tx.signatureSaveOperation.updateMany).not.toHaveBeenCalled();
  });

  it("finishes quietly when another delete already removed the collection", async () => {
    tx.signatureCollection.findUnique
      .mockResolvedValueOnce({ id: "c1", status: SignatureCollectionStatus.OPEN, collectionVersion: 4 })
      .mockResolvedValueOnce(null);

    expect(await deleteSignatureCollection(input)).toEqual({ deleted: true });
    expect(tx.signatureCollection.delete).not.toHaveBeenCalled();
    expect(tx.signatureCapture.updateMany).not.toHaveBeenCalled();
  });

  it("asks for a retry when the collection changed mid-delete or files remain", async () => {
    tx.signatureCollection.findUnique
      .mockResolvedValueOnce({ id: "c1", status: SignatureCollectionStatus.OPEN, collectionVersion: 4 })
      .mockResolvedValueOnce({ id: "c1", status: SignatureCollectionStatus.OPEN, collectionVersion: 6 });
    await expect(deleteSignatureCollection(input)).rejects.toMatchObject({ status: 409, message: "Collection changed while it was being deleted; retry the delete" });

    tx.signatureCollection.findUnique
      .mockResolvedValueOnce({ id: "c1", status: SignatureCollectionStatus.OPEN, collectionVersion: 4 })
      // Restored by someone else at the same version.
      .mockResolvedValueOnce({ id: "c1", status: SignatureCollectionStatus.OPEN, collectionVersion: 5 });
    await expect(deleteSignatureCollection(input)).rejects.toMatchObject({ status: 409 });

    tx.signatureCollection.findUnique
      .mockResolvedValueOnce({ id: "c1", status: SignatureCollectionStatus.OPEN, collectionVersion: 4 })
      .mockResolvedValueOnce({ id: "c1", status: SignatureCollectionStatus.ARCHIVED, collectionVersion: 5 });
    tx.signatureArtifactRevision.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "r9" }]);
    await expect(deleteSignatureCollection(input)).rejects.toMatchObject({ status: 503, message: "Some signature files are still pending removal; retry the delete" });
    expect(tx.signatureCollection.delete).not.toHaveBeenCalled();
  });
});

describe("member capture bootstrap", () => {
  const member = (extra: Record<string, unknown> = {}) => ({
    id: "m1", name: "Ada Badger", jerseyNumber: "7", title: null, roleGroup: SignatureMemberGroup.PLAYER, active: true, linkedUserId: null,
    collection: { id: "c1", sportCode: "FB", season: "2026-27", status: SignatureCollectionStatus.OPEN, collectionVersion: 4 },
    capture: { captureVersion: 2, settingsVersion: 1, currentRevision: { id: "r1", state: SignatureArtifactState.READY }, collection: { sportCode: "FB", season: "2026-27", status: "OPEN", settingsVersion: 1, penSettings: pen } },
    ...extra,
  });

  it("returns 404 for a missing member, one hidden from this roster, or one with no capture", async () => {
    db.signatureMember.findFirst.mockResolvedValueOnce(null);
    await expect(getSignatureMemberCaptureBootstrap("c1", "m1")).rejects.toMatchObject({ status: 404, message: "Signature member not found" });

    db.signatureMember.findFirst.mockResolvedValueOnce(member({ roleGroup: SignatureMemberGroup.CREATIVE_STAFF }));
    await expect(getSignatureMemberCaptureBootstrap("c1", "m1")).rejects.toMatchObject({ status: 404, message: "Signature member not found" });

    db.signatureMember.findFirst.mockResolvedValueOnce(member({ capture: null }));
    await expect(getSignatureMemberCaptureBootstrap("c1", "m1")).rejects.toMatchObject({ status: 404, message: "Signature member is not ready for capture" });
  });

  it("uses the member's Creative Staff capture when linked, and hides an artifact that is not ready", async () => {
    db.signatureMember.findFirst.mockResolvedValue(member({ linkedUserId: "u1", roleGroup: SignatureMemberGroup.COACHING_STAFF }));
    db.signatureCapture.findFirst.mockResolvedValue({
      captureVersion: 8, settingsVersion: 3, currentRevision: { id: "r2", state: SignatureArtifactState.PENDING_DELETE },
      collection: { sportCode: "CREATIVE", season: "2026-27", status: "OPEN", settingsVersion: 3, penSettings: { ...pen, strokeWidth: 6 } },
    });

    const { member: result } = await getSignatureMemberCaptureBootstrap("c1", "m1");

    expect(db.signatureCapture.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { collection: { sportCode: "CREATIVE", season: "2026-27" }, member: { active: true, linkedUserId: "u1" } },
    }));
    expect(result).toEqual(expect.objectContaining({ captureVersion: 8, settingsVersion: 3, artifact: null, captureSettings: expect.objectContaining({ strokeWidth: 6 }) }));
  });

  it("never looks for a canonical capture from inside the Creative Staff roster", async () => {
    db.signatureMember.findFirst.mockResolvedValue(member({
      linkedUserId: "u1", roleGroup: SignatureMemberGroup.CREATIVE_STAFF,
      collection: { id: "c1", sportCode: "CREATIVE", season: "2026-27", status: "OPEN", collectionVersion: 4 },
    }));

    expect((await getSignatureMemberCaptureBootstrap("c1", "m1")).member.artifact).toEqual({ id: "r1" });
    expect(db.signatureCapture.findFirst).not.toHaveBeenCalled();
  });
});

describe("collection reads", () => {
  it("returns 404 for a missing collection", async () => {
    db.signatureCollection.findUnique.mockResolvedValue(null);
    await expect(getSignatureCollection("c1")).rejects.toMatchObject({ status: 404 });
  });

  it("lists open collections, counting linked staff by their Creative Staff signature", async () => {
    db.signatureCollection.findMany.mockResolvedValue([{
      id: "c1", sportCode: "FB", season: "2026-27", status: "OPEN", collectionVersion: 4, settingsVersion: 1, updatedAt: new Date("2026-10-25T14:00:00.000Z"),
      _count: { captures: 0 },
      members: [
        { id: "p1", active: true, required: true, roleGroup: SignatureMemberGroup.PLAYER, linkedUserId: null },
        { id: "s1", active: true, required: false, roleGroup: SignatureMemberGroup.COACHING_STAFF, linkedUserId: "u1" },
        { id: "s2", active: true, required: false, roleGroup: SignatureMemberGroup.COACHING_STAFF, linkedUserId: "u2" },
      ],
      // s2 has a team-roster artifact, but its canonical signature was removed.
      captures: [{ memberId: "s2" }],
    }]);
    db.signatureCapture.findMany.mockResolvedValue([
      { collection: { season: "2026-27" }, member: { linkedUserId: "u1" }, currentRevision: { state: SignatureArtifactState.READY } },
      { collection: { season: "2026-27" }, member: { linkedUserId: "u2" }, currentRevision: null },
    ]);

    const [row] = await listSignatureCollections();

    expect(db.signatureCollection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: SignatureCollectionStatus.OPEN } }));
    expect(row).toEqual(expect.objectContaining({
      completeness: { complete: 0, required: 1, percent: 0 },
      staffCompleteness: { complete: 1, total: 2 },
      downloadableCount: 1,
      hasRetainedSignatures: false,
      updatedAt: "2026-10-25T14:00:00.000Z",
    }));
  });

  it("shows an empty standalone staff roster as 0%, not complete", async () => {
    db.signatureCollection.findMany.mockResolvedValue([{
      id: "c2", sportCode: "ADMIN", season: "2026-27", status: "ARCHIVED", collectionVersion: 1, settingsVersion: 1, updatedAt: new Date(),
      _count: { captures: 2 },
      members: [{ id: "a1", active: false, required: true, roleGroup: SignatureMemberGroup.SUPPORT_STAFF, linkedUserId: null }],
      captures: [],
    }]);

    const [row] = await listSignatureCollections({ includeArchived: true });

    expect(db.signatureCollection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
    expect(db.signatureCapture.findMany).not.toHaveBeenCalled();
    expect(row!.completeness.percent).toBe(0);
    expect(row!.hasRetainedSignatures).toBe(true);
  });
});
