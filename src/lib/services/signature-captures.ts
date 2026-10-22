import { randomUUID } from "node:crypto";
import {
  Prisma,
  SignatureArtifactState,
  SignatureCollectionStatus,
  SignatureSaveStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { HttpError } from "@/lib/http";
import { isSerializationConflict, withSerializationRetry } from "@/lib/serialization";
import { renderSignatureArtifacts } from "@/lib/signatures/artifacts";
import { penSettingsSchema, type CaptureSaveRequest } from "@/lib/signatures/types";
import {
  buildSignatureArtifactPath,
  deletePrivateSignatureArtifacts,
  uploadPrivateSignatureArtifact,
} from "@/lib/signatures/storage";
import {
  signatureJson,
  STALE_SIGNATURE_CAPTURE_MESSAGE,
  publicArtifact,
  saveOperationInclude,
  assertSignatureSaveOperationTarget,
  committedSignatureSave,
  isStaleSignatureSave,
  isPrismaUniqueConflict,
  resolveSignatureCaptureTarget,
  cleanupSignatureRevisions,
  Actor,
} from "./signatures-shared";

export async function removeSignatureCapture(input: {
  actor: Actor;
  collectionId: string;
  memberId: string;
  expectedCaptureVersion: number;
}) {
  const target = await resolveSignatureCaptureTarget(input.collectionId, input.memberId, true);
  const result = await db.$transaction(async (tx) => {
    const capture = await tx.signatureCapture.findUnique({
      where: { id: target.id },
      include: {
        currentRevision: true,
        collection: true,
        revisions: {
          where: { state: SignatureArtifactState.READY },
          select: { id: true, pngPath: true, svgPath: true },
        },
      },
    });
    if (!capture) throw new HttpError(404, "Signature member is not ready for capture");
    if (capture.collection.status === SignatureCollectionStatus.ARCHIVED) throw new HttpError(409, "Archived signature collections are read-only");
    if (capture.captureVersion !== input.expectedCaptureVersion) throw new HttpError(409, "This signature changed elsewhere; reload before removing it");
    if (!capture.currentRevision) return { revisions: [], captureVersion: capture.captureVersion };
    const revision = capture.currentRevision;
    await tx.signatureCapture.update({ where: { id: capture.id }, data: { currentRevisionId: null, captureVersion: { increment: 1 } } });
    await tx.signatureArtifactRevision.updateMany({ where: { id: { in: capture.revisions.map((item) => item.id) } }, data: { state: SignatureArtifactState.PENDING_DELETE, replacedAt: new Date() } });
    await createAuditEntryTx(tx, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "SignatureCapture",
      entityId: capture.id,
      action: "REMOVE",
      before: { captureVersion: capture.captureVersion, revisionId: revision.id, pngHash: revision.pngHash, svgHash: revision.svgHash },
      after: { captureVersion: capture.captureVersion + 1, revisionId: null },
    });
    return { revisions: capture.revisions, captureVersion: capture.captureVersion + 1 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (result.revisions.length > 0) await cleanupSignatureRevisions(result.revisions);
  return { removed: result.revisions.length > 0, captureVersion: result.captureVersion };
}

async function markSaveFailed(input: {
  actor: Actor;
  captureId: string;
  requestId: string;
  revisionId: string;
  operationId: string;
  stage: "UPLOAD" | "FINALIZE";
  error: unknown;
}) {
  const message = input.error instanceof Error ? input.error.message.slice(0, 500) : "Signature save failed";
  return db.$transaction(async (tx) => {
    await tx.signatureArtifactRevision.updateMany({ where: { id: input.revisionId, state: SignatureArtifactState.PENDING_DELETE }, data: { state: SignatureArtifactState.PENDING_DELETE, errorMessage: message } });
    const failed = await tx.signatureSaveOperation.updateMany({ where: { id: input.operationId, status: { not: SignatureSaveStatus.COMMITTED } }, data: { status: SignatureSaveStatus.FAILED, errorMessage: message } });
    if (failed.count > 0) {
      await createAuditEntryTx(tx, {
        actorId: input.actor.id,
        actorRole: input.actor.role,
        entityType: "SignatureCapture",
        entityId: input.captureId,
        action: "SAVE_FAILED",
        after: { operationId: input.operationId, requestId: input.requestId, revisionId: input.revisionId, stage: input.stage, error: message },
      });
    }
    return failed.count;
  });
}

export async function saveSignatureCapture(input: { actor: Actor; collectionId: string; memberId: string; request: CaptureSaveRequest }) {
  const target = await resolveSignatureCaptureTarget(input.collectionId, input.memberId);
  let existingOperation = await db.signatureSaveOperation.findUnique({ where: { requestId: input.request.requestId }, include: saveOperationInclude });
  if (existingOperation) assertSignatureSaveOperationTarget(existingOperation, { actor: input.actor, target, request: input.request });
  if (existingOperation?.status === SignatureSaveStatus.COMMITTED) return committedSignatureSave(existingOperation);
  if (existingOperation?.status === SignatureSaveStatus.FAILED) {
    throw new HttpError(409, "This save request failed; try saving again");
  }
  if (existingOperation && !isStaleSignatureSave(existingOperation)) {
    throw new HttpError(425, "This signature is still saving; try again shortly");
  }

  if (target.collection.status === SignatureCollectionStatus.ARCHIVED) throw new HttpError(409, "Archived signature collections are read-only");
  if (target.captureVersion !== input.request.expectedCaptureVersion) throw new HttpError(409, STALE_SIGNATURE_CAPTURE_MESSAGE);
  if (target.collection.settingsVersion !== input.request.settingsVersion) throw new HttpError(409, "Pen settings changed; reload the capture surface");
  const settings = penSettingsSchema.parse(target.collection.penSettings);
  let artifacts: Awaited<ReturnType<typeof renderSignatureArtifacts>>;
  try {
    artifacts = await renderSignatureArtifacts(input.request.strokes, settings);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Signature")) {
      throw new HttpError(400, error.message);
    }
    throw new HttpError(503, "Signature rendering is temporarily unavailable");
  }
  let revisionId = existingOperation?.revision?.id ?? randomUUID();
  const pngPath = existingOperation?.revision?.pngPath ?? buildSignatureArtifactPath(target.collectionId, target.memberId, revisionId, "png");
  const svgPath = existingOperation?.revision?.svgPath ?? buildSignatureArtifactPath(target.collectionId, target.memberId, revisionId, "svg");

  if (existingOperation) {
    if (!existingOperation.revision) throw new HttpError(503, "This signature save cannot be recovered yet");
    if (existingOperation.revision.pngHash !== artifacts.pngHash || existingOperation.revision.svgHash !== artifacts.svgHash) {
      throw new HttpError(409, "This save request ID belongs to a different signature draft");
    }
    const claimed = await db.signatureSaveOperation.updateMany({
      where: { id: existingOperation.id, status: existingOperation.status, updatedAt: existingOperation.updatedAt },
      data: { status: existingOperation.status },
    });
    if (claimed.count === 0) {
      const winner = await db.signatureSaveOperation.findUnique({ where: { requestId: input.request.requestId }, include: saveOperationInclude });
      if (winner) {
        assertSignatureSaveOperationTarget(winner, { actor: input.actor, target, request: input.request });
        if (winner.status === SignatureSaveStatus.COMMITTED) return committedSignatureSave(winner);
      }
      throw new HttpError(425, "This signature is still saving; try again shortly");
    }
    existingOperation = { ...existingOperation, updatedAt: new Date() };
  }

  let operationId = existingOperation?.id;
  if (!operationId) try {
    const prepared = await withSerializationRetry(() => db.$transaction(async (tx) => {
      const current = await tx.signatureCapture.findUnique({ where: { id: target.id }, select: { captureVersion: true, collectionId: true, memberId: true, settingsVersion: true } });
      if (!current || current.collectionId !== target.collectionId || current.memberId !== target.memberId || current.captureVersion !== input.request.expectedCaptureVersion || current.settingsVersion !== input.request.settingsVersion) throw new HttpError(409, STALE_SIGNATURE_CAPTURE_MESSAGE);
      const latest = await tx.signatureArtifactRevision.findFirst({ where: { captureId: target.id }, orderBy: { revision: "desc" }, select: { revision: true } });
      const revision = await tx.signatureArtifactRevision.create({ data: { id: revisionId, captureId: target.id, revision: (latest?.revision ?? 0) + 1, state: SignatureArtifactState.PENDING_DELETE, pngPath, svgPath, pngHash: artifacts.pngHash, svgHash: artifacts.svgHash, width: artifacts.width, height: artifacts.height, cropBounds: signatureJson(artifacts.cropBounds) } });
      const operation = await tx.signatureSaveOperation.create({ data: { requestId: input.request.requestId, collectionId: target.collectionId, memberId: target.memberId, captureId: target.id, expectedCaptureVersion: input.request.expectedCaptureVersion, settingsVersion: input.request.settingsVersion, status: SignatureSaveStatus.UPLOADING, revisionId: revision.id, actorUserId: input.actor.id } });
      return { operationId: operation.id, revisionId: revision.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    operationId = prepared.operationId;
    revisionId = prepared.revisionId;
  } catch (error) {
    if (isPrismaUniqueConflict(error)) {
      const winner = await db.signatureSaveOperation.findUnique({ where: { requestId: input.request.requestId }, include: saveOperationInclude });
      if (winner) {
        assertSignatureSaveOperationTarget(winner, { actor: input.actor, target, request: input.request });
        if (winner.status === SignatureSaveStatus.COMMITTED) return committedSignatureSave(winner);
        if (winner.status === SignatureSaveStatus.FAILED) throw new HttpError(409, "This save request failed; try saving again");
      }
      throw new HttpError(425, "Another save is already processing this signature; retry this same save shortly");
    }
    if (isSerializationConflict(error)) {
      throw new HttpError(425, "Another save is settling this signature; retry this same save shortly");
    }
    throw error;
  }

  if (!existingOperation || existingOperation.status === SignatureSaveStatus.UPLOADING) {
    try {
      await uploadPrivateSignatureArtifact({ path: pngPath, body: artifacts.png, contentType: "image/png", allowOverwrite: Boolean(existingOperation) });
      await uploadPrivateSignatureArtifact({ path: svgPath, body: Buffer.from(artifacts.svg, "utf8"), contentType: "image/svg+xml", allowOverwrite: Boolean(existingOperation) });
      const finalizedForCommit = await db.signatureSaveOperation.updateMany({
        where: { id: operationId, status: SignatureSaveStatus.UPLOADING },
        data: { status: SignatureSaveStatus.FINALIZING },
      });
      if (finalizedForCommit.count === 0) {
        // Delete/reset can fail this operation while the Blob uploads are in
        // flight. The row may be gone by now, so the uploader must fence itself
        // and remove the paths it just created instead of relying on the DB row
        // for later cleanup.
        try { await deletePrivateSignatureArtifacts([pngPath, svgPath]); } catch { /* pending cleanup owns retry when the row still exists */ }
        throw new HttpError(409, "This signature save was cancelled; return to the roster before trying again");
      }
    } catch (error) {
      if (error instanceof HttpError && error.status === 409 && error.message === "This signature save was cancelled; return to the roster before trying again") {
        throw error;
      }
      const failedCount = await markSaveFailed({ actor: input.actor, captureId: target.id, requestId: input.request.requestId, revisionId, operationId, stage: "UPLOAD", error });
      // If the status update failed after the finalizer committed, the
      // operation is already the current capture. Never delete those paths
      // based on an ambiguous upload/finalization response.
      if (failedCount > 0) {
        try { await deletePrivateSignatureArtifacts([pngPath, svgPath]); } catch { /* durable pending-delete retry owns recovery */ }
      }
      throw new HttpError(503, "Signature files could not be stored; the existing signature was kept");
    }
  }

  let finalized: Awaited<ReturnType<typeof finalizeSignatureSave>>;
  try {
    finalized = await withSerializationRetry(
      () => finalizeSignatureSave({
        actor: input.actor,
        collectionId: target.collectionId,
        captureId: target.id,
        operationId,
        revisionId,
        expectedCaptureVersion: input.request.expectedCaptureVersion,
        settingsVersion: input.request.settingsVersion,
      }),
    );
  } catch (error) {
    if (!isSerializationConflict(error) && !(error instanceof HttpError && error.status === 425)) {
      await markSaveFailed({ actor: input.actor, captureId: target.id, requestId: input.request.requestId, revisionId, operationId, stage: "FINALIZE", error });
    }
    if (isSerializationConflict(error)) {
      throw new HttpError(425, "Another save is settling this signature; retry this same save shortly");
    }
    throw error;
  }

  return { status: "committed" as const, captureVersion: finalized.captureVersion, revision: publicArtifact(finalized.revision) };
}

async function finalizeSignatureSave(input: {
  actor: Actor;
  collectionId: string;
  captureId: string;
  operationId: string;
  revisionId: string;
  expectedCaptureVersion: number;
  settingsVersion: number;
}) {
  return db.$transaction(async (tx) => {
      const operation = await tx.signatureSaveOperation.findUnique({ where: { id: input.operationId }, include: { revision: true, capture: { select: { captureVersion: true } } } });
      if (!operation || operation.captureId !== input.captureId || operation.revisionId !== input.revisionId) {
        throw new HttpError(409, "This signature save operation changed while finalizing");
      }
      if (operation.status === SignatureSaveStatus.COMMITTED) {
        const revision = operation.revision ? publicArtifact(operation.revision) : null;
        if (!revision || !operation.revision) throw new HttpError(503, "The committed signature artifact is temporarily unavailable");
        return { captureVersion: operation.capture.captureVersion, revision: operation.revision };
      }
      if (operation.status === SignatureSaveStatus.FAILED) {
        throw new HttpError(409, "This save request failed; try saving again");
      }
      if (operation.status !== SignatureSaveStatus.FINALIZING) {
        throw new HttpError(425, "This signature is still uploading; try again shortly");
      }
      const current = await tx.signatureCapture.findUnique({ where: { id: input.captureId }, include: { currentRevision: true, collection: true, member: true } });
      if (!current || !current.member.active || current.captureVersion !== input.expectedCaptureVersion || current.settingsVersion !== input.settingsVersion || current.collection.status === SignatureCollectionStatus.ARCHIVED) {
        throw new HttpError(409, STALE_SIGNATURE_CAPTURE_MESSAGE);
      }
      if (current.currentRevisionId) {
        await tx.signatureArtifactRevision.update({ where: { id: current.currentRevisionId }, data: { replacedAt: new Date() } });
      }
      const now = new Date();
      const revision = await tx.signatureArtifactRevision.update({ where: { id: input.revisionId }, data: { state: SignatureArtifactState.READY, committedAt: now } });
      const capture = await tx.signatureCapture.update({ where: { id: input.captureId }, data: { currentRevisionId: revision.id, captureVersion: { increment: 1 }, capturedAt: now, capturedById: input.actor.id }, select: { captureVersion: true } });
      // Captures change what reset/delete will erase. A roster observed before
      // this commit must fail its version check, including recaptures.
      await tx.signatureCollection.update({ where: { id: input.collectionId }, data: { firstCaptureAt: current.collection.firstCaptureAt ?? now, collectionVersion: { increment: 1 }, updatedById: input.actor.id } });
      await tx.signatureSaveOperation.update({ where: { id: input.operationId }, data: { status: SignatureSaveStatus.COMMITTED, committedAt: now } });
      await createAuditEntryTx(tx, { actorId: input.actor.id, actorRole: input.actor.role, entityType: "SignatureCapture", entityId: input.captureId, action: "SAVE", before: { captureVersion: input.expectedCaptureVersion, priorRevisionId: current.currentRevisionId, priorPngHash: current.currentRevision?.pngHash ?? null, priorSvgHash: current.currentRevision?.svgHash ?? null }, after: { captureVersion: capture.captureVersion, operationId: input.operationId, requestId: operation.requestId, revisionId: revision.id, pngHash: revision.pngHash, svgHash: revision.svgHash, width: revision.width, height: revision.height } });
      return { captureVersion: capture.captureVersion, revision };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
