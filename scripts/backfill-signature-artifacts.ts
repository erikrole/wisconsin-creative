#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PrismaNeon } from "@prisma/adapter-neon";
import {
  Prisma,
  PrismaClient,
  SignatureArtifactState,
  SignatureCollectionStatus,
  SignatureMemberGroup,
  SignatureSnapshotStatus,
} from "@prisma/client";
import { del, get, put } from "@vercel/blob";

import { fetchUWBadgersRoster } from "../src/lib/signatures/uwbadgers";
import {
  DEFAULT_SIGNATURE_PEN_SETTINGS,
  SIGNATURE_ADMINISTRATION_SPORT_CODE,
  SIGNATURE_CREATIVE_STAFF_SPORT_CODE,
  getSignatureRosterSourceConfig,
  normalizeSignatureName,
  signatureRosterEntrySchema,
  signatureCollectionTitle,
  type SignatureImportedSportCode,
  type SignatureRosterEntry,
} from "../src/lib/signatures/types";

type ArtifactManifestEntry = {
  name: string;
  jerseyNumber: number | null;
  png: string;
  svg: string;
  pngHash: string;
  svgHash: string;
  pngChannels: number;
  width: number;
  height: number;
  cropBounds: { x: number; y: number; width: number; height: number };
};

type PreparedArtifact = ArtifactManifestEntry & {
  normalizedName: string;
  pngBytes: Buffer;
  svgBytes: Buffer;
};

type Actor = { id: string; role: "ADMIN" | "STAFF" };

const SERIALIZABLE = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 30_000,
} as const;

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() || null : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseExpectedBlankNumbers(): number[] {
  const value = option("--expected-blank-numbers");
  if (!value) return [];
  const numbers = value.split(",").map((part) => Number(part.trim()));
  if (numbers.some((number) => !Number.isInteger(number) || number < 0 || number > 999)) {
    throw new Error("--expected-blank-numbers must be a comma-separated list of jersey numbers.");
  }
  return [...new Set(numbers)].sort((left, right) => left - right);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

async function loadManifest(path: string): Promise<PreparedArtifact[]> {
  const raw = JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("The signature manifest must contain at least one asset.");

  const prepared: PreparedArtifact[] = [];
  const seen = new Set<string>();
  for (const [index, value] of raw.entries()) {
    if (!value || typeof value !== "object") throw new Error(`Manifest entry ${index + 1} is not an object.`);
    const entry = value as Partial<ArtifactManifestEntry>;
    assertString(entry.name, `Manifest entry ${index + 1} name`);
    assertString(entry.png, `Manifest entry ${index + 1} png`);
    assertString(entry.svg, `Manifest entry ${index + 1} svg`);
    assertString(entry.pngHash, `Manifest entry ${index + 1} pngHash`);
    assertString(entry.svgHash, `Manifest entry ${index + 1} svgHash`);
    if (entry.jerseyNumber !== null && (typeof entry.jerseyNumber !== "number" || !Number.isInteger(entry.jerseyNumber) || entry.jerseyNumber < 0)) {
      throw new Error(`Manifest entry ${index + 1} has an invalid jersey number.`);
    }
    const jerseyNumber = entry.jerseyNumber ?? null;
    const key = `${entry.jerseyNumber}:${normalizeSignatureName(entry.name)}`;
    if (seen.has(key)) throw new Error(`Manifest contains a duplicate signer: ${entry.name} (#${entry.jerseyNumber}).`);
    seen.add(key);

    const pngBytes = await readFile(resolve(entry.png));
    const svgBytes = await readFile(resolve(entry.svg));
    if (sha256(pngBytes) !== entry.pngHash) throw new Error(`PNG hash mismatch for ${entry.name}.`);
    if (sha256(svgBytes) !== entry.svgHash) throw new Error(`SVG hash mismatch for ${entry.name}.`);
    if (entry.pngChannels !== 4) throw new Error(`PNG for ${entry.name} is not an RGBA export.`);
    if (typeof entry.width !== "number" || typeof entry.height !== "number" || !Number.isInteger(entry.width) || !Number.isInteger(entry.height) || entry.width < 1 || entry.height < 1) {
      throw new Error(`Manifest dimensions are invalid for ${entry.name}.`);
    }
    const width = entry.width;
    const height = entry.height;
    if (entry.width > 1_600 || entry.height > 900) {
      throw new Error(`Manifest dimensions exceed the signature export contract for ${entry.name}.`);
    }
    const cropBounds = entry.cropBounds;
    if (!cropBounds || typeof cropBounds !== "object") throw new Error(`Crop bounds are missing for ${entry.name}.`);
    for (const field of ["x", "y", "width", "height"] as const) {
      assertFiniteNumber(cropBounds[field], `${entry.name} cropBounds.${field}`);
    }
    if (cropBounds.width <= 0 || cropBounds.height <= 0) throw new Error(`Crop bounds are empty for ${entry.name}.`);

    prepared.push({
      name: entry.name,
      normalizedName: normalizeSignatureName(entry.name),
      jerseyNumber,
      png: resolve(entry.png),
      svg: resolve(entry.svg),
      pngHash: entry.pngHash,
      svgHash: entry.svgHash,
      pngChannels: entry.pngChannels,
      width,
      height,
      cropBounds,
      pngBytes,
      svgBytes,
    });
  }
  return prepared;
}

function assertAssetCoverage(
  entries: SignatureRosterEntry[],
  assets: PreparedArtifact[],
  expectedBlankNumbers: number[],
) {
  const playerEntries = entries.filter((entry) => entry.roleGroup === SignatureMemberGroup.PLAYER);
  const playerByKey = new Map(
    playerEntries.map((entry) => [`${entry.jerseyNumber}:${entry.normalizedName}`, entry]),
  );
  const assetByKey = new Map(assets.map((asset) => [`${asset.jerseyNumber}:${asset.normalizedName}`, asset]));
  const orphanAssets = assets.filter((asset) => !playerByKey.has(`${asset.jerseyNumber}:${asset.normalizedName}`));
  if (orphanAssets.length > 0) {
    throw new Error(`Manifest contains assets with no matching player: ${orphanAssets.map((asset) => `${asset.name} (#${asset.jerseyNumber})`).join(", ")}.`);
  }

  const missingPlayers = playerEntries.filter((entry) => !assetByKey.has(`${entry.jerseyNumber}:${entry.normalizedName}`));
  const missingNumbers = missingPlayers.map((entry) => entry.jerseyNumber).filter((number): number is number => number !== null).sort((left, right) => left - right);
  if (missingNumbers.join(",") !== expectedBlankNumbers.join(",")) {
    throw new Error(`Captured-player coverage mismatch. Missing jersey numbers: ${missingNumbers.join(",") || "none"}; expected: ${expectedBlankNumbers.join(",") || "none"}.`);
  }
  if (playerEntries.some((entry) => entry.jerseyNumber === null)) {
    throw new Error("The roster parser returned a player without a jersey number.");
  }

  return {
    playerCount: playerEntries.length,
    assetCount: assets.length,
    blankNumbers: missingNumbers,
  };
}

function privateBlobAuth(): { token: string } | { storeId: string; oidcToken: string } {
  const token = process.env.SIGNATURE_BLOB_READ_WRITE_TOKEN;
  if (token) return { token };
  const storeId = process.env.SIGNATURE_BLOB_STORE_ID;
  const oidcToken = process.env.VERCEL_OIDC_TOKEN;
  if (storeId && oidcToken) return { storeId, oidcToken };
  throw new Error("Private Signature Blob storage is not configured.");
}

async function uploadPrivate(path: string, body: Buffer, contentType: "image/png" | "image/svg+xml") {
  await put(path, body, {
    access: "private",
    ...privateBlobAuth(),
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType,
    cacheControlMaxAge: 60,
  });
}

async function deletePrivate(paths: string[]) {
  if (paths.length > 0) await del(paths, privateBlobAuth());
}

async function readPrivate(path: string): Promise<Buffer> {
  const result = await get(path, { access: "private", useCache: false, ...privateBlobAuth() });
  if (!result || result.statusCode !== 200) throw new Error(`Private signature artifact is not readable: ${path}`);
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

function artifactPath(collectionId: string, memberId: string, revisionId: string, kind: "png" | "svg") {
  return `signatures/${collectionId}/${memberId}/${revisionId}.${kind}`;
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  entityType: string,
  entityId: string,
  action: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
) {
  await tx.auditLog.create({
    data: {
      actorUserId: actor.id,
      entityType,
      entityId,
      action,
      beforeJson: before as Prisma.InputJsonValue | undefined,
      afterJson: { ...after, _actorRole: actor.role } as Prisma.InputJsonValue,
    },
  });
}

async function findActor(db: PrismaClient): Promise<Actor> {
  const requested = option("--actor-email");
  const configured = requested
    ? [requested.toLocaleLowerCase("en-US")]
    : (process.env.INTERNAL_OPERATOR_EMAILS ?? "")
      .split(/[;,\s]+/)
      .map((email) => email.trim().toLocaleLowerCase("en-US"))
      .filter(Boolean);
  if (configured.length === 0) throw new Error("Provide --actor-email or configure INTERNAL_OPERATOR_EMAILS for the audited import.");

  const actor = await db.user.findFirst({
    where: {
      email: { in: configured },
      active: true,
      role: { in: ["ADMIN", "STAFF"] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true },
  });
  if (!actor || (actor.role !== "ADMIN" && actor.role !== "STAFF")) {
    throw new Error("The configured signature import actor is not an active ADMIN or STAFF user.");
  }
  return { id: actor.id, role: actor.role as Actor["role"] };
}

async function fetchCollection(db: PrismaClient, sportCode: string, season: string) {
  return db.signatureCollection.findUnique({
    where: { sportCode_season: { sportCode, season } },
    include: {
      members: {
        where: { active: true },
        include: { capture: { include: { currentRevision: true } } },
      },
    },
  });
}

async function applyRoster(
  db: PrismaClient,
  actor: Actor,
  snapshot: Awaited<ReturnType<typeof fetchUWBadgersRoster>>,
  sportCode: SignatureImportedSportCode,
  season: string,
) {
  const existingCollection = await db.signatureCollection.findUnique({
    where: { sportCode_season: { sportCode, season } },
    select: { collectionVersion: true },
  });
  const expectedCollectionVersion = existingCollection?.collectionVersion ?? 1;

  return db.$transaction(async (tx) => {
    const collection = await tx.signatureCollection.upsert({
      where: { sportCode_season: { sportCode, season } },
      create: {
        sportCode,
        season,
        penSettings: DEFAULT_SIGNATURE_PEN_SETTINGS,
        createdById: actor.id,
        updatedById: actor.id,
      },
      update: {},
      select: { id: true, collectionVersion: true, status: true, settingsVersion: true },
    });
    if (collection.status === SignatureCollectionStatus.ARCHIVED) throw new Error("The signature collection is archived.");
    if (collection.collectionVersion !== expectedCollectionVersion) throw new Error("The signature collection changed during the import preflight.");

    const existingSnapshot = await tx.signatureRosterSnapshot.findUnique({
      where: { collectionId_sourceHash: { collectionId: collection.id, sourceHash: snapshot.sourceHash } },
    });
    const rosterSnapshot = existingSnapshot ?? await tx.signatureRosterSnapshot.create({
      data: {
        collectionId: collection.id,
        status: SignatureSnapshotStatus.PREVIEW,
        sourceKey: snapshot.sourceKey,
        sourceUrl: snapshot.sourceUrl,
        sourceHash: snapshot.sourceHash,
        parserVersion: snapshot.parserVersion,
        fetchedAt: snapshot.fetchedAt,
        candidateCount: snapshot.entries.length,
        entries: snapshot.entries,
      },
    });
    if (!existingSnapshot) {
      await writeAudit(tx, actor, "SignatureRosterSnapshot", rosterSnapshot.id, "PREVIEW", undefined, {
        collectionId: collection.id,
        sourceHash: snapshot.sourceHash,
        parserVersion: snapshot.parserVersion,
        candidateCount: snapshot.entries.length,
      });
    }

    if (rosterSnapshot.status === SignatureSnapshotStatus.APPLIED) {
      const latestApplied = await tx.signatureRosterSnapshot.findFirst({
        where: { collectionId: collection.id, status: SignatureSnapshotStatus.APPLIED },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (latestApplied?.id === rosterSnapshot.id) {
        const memberCount = await tx.signatureMember.count({ where: { collectionId: collection.id } });
        return { collectionId: collection.id, collectionVersion: collection.collectionVersion, memberCount, unchanged: true };
      }
    }

    const entries = signatureRosterEntrySchema.array().parse(rosterSnapshot.entries) as SignatureRosterEntry[];
    if (entries.some((entry) => entry.roleGroup === SignatureMemberGroup.CREATIVE_STAFF)) {
      throw new Error("Creative staff must use the standalone Creative staff roster.");
    }
    const existingMembers = await tx.signatureMember.findMany({
      where: { collectionId: collection.id },
      select: { id: true, sourceExternalId: true, required: true, roleGroup: true },
    });
    const existingBySource = new Map(existingMembers.map((member) => [member.sourceExternalId, member]));
    for (const entry of entries) {
      const current = existingBySource.get(entry.sourceExternalId);
      if (current) {
        await tx.signatureMember.update({
          where: { id: current.id },
          data: {
            sourceSnapshotId: rosterSnapshot.id,
            sourceProfileUrl: entry.sourceProfileUrl,
            name: entry.name,
            normalizedName: entry.normalizedName,
            jerseyNumber: entry.jerseyNumber,
            roleGroup: entry.roleGroup,
            title: entry.title,
            required: entry.roleGroup === SignatureMemberGroup.PLAYER
              ? true
              : current.roleGroup === entry.roleGroup
                ? current.required
                : entry.roleGroup === SignatureMemberGroup.SUPPORT_STAFF || current.roleGroup === SignatureMemberGroup.SUPPORT_STAFF
                  ? false
                  : current.required,
            active: true,
          },
        });
      } else {
        const member = await tx.signatureMember.create({
          data: {
            collectionId: collection.id,
            sourceSnapshotId: rosterSnapshot.id,
            sourceExternalId: entry.sourceExternalId,
            sourceProfileUrl: entry.sourceProfileUrl,
            name: entry.name,
            normalizedName: entry.normalizedName,
            jerseyNumber: entry.jerseyNumber,
            roleGroup: entry.roleGroup,
            title: entry.title,
            required: getSignatureRosterSourceConfig(sportCode).requiredByDefault === true || entry.roleGroup !== SignatureMemberGroup.SUPPORT_STAFF,
          },
        });
        existingBySource.set(entry.sourceExternalId, {
          id: member.id,
          sourceExternalId: member.sourceExternalId,
          required: member.required,
          roleGroup: member.roleGroup,
        });
      }
    }

    const sourceIds = entries.map((entry) => entry.sourceExternalId);
    await tx.signatureMember.updateMany({
      where: { collectionId: collection.id, sourceExternalId: { notIn: sourceIds } },
      data: { active: false },
    });
    const members = await tx.signatureMember.findMany({ where: { collectionId: collection.id }, select: { id: true } });
    await tx.signatureCapture.createMany({
      data: members.map((member) => ({ collectionId: collection.id, memberId: member.id, settingsVersion: collection.settingsVersion })),
      skipDuplicates: true,
    });
    await tx.signatureRosterSnapshot.update({
      where: { id: rosterSnapshot.id },
      data: { status: SignatureSnapshotStatus.APPLIED, appliedAt: new Date(), appliedById: actor.id },
    });
    const updated = await tx.signatureCollection.update({
      where: { id: collection.id },
      data: { collectionVersion: { increment: 1 }, updatedById: actor.id },
      select: { id: true, collectionVersion: true },
    });
    await writeAudit(tx, actor, "SignatureRosterSnapshot", rosterSnapshot.id, "APPLY", {
      collectionVersion: expectedCollectionVersion,
      sourceHash: rosterSnapshot.sourceHash,
    }, {
      collectionVersion: updated.collectionVersion,
      candidateCount: rosterSnapshot.candidateCount,
    });
    return { collectionId: updated.id, collectionVersion: updated.collectionVersion, memberCount: members.length, unchanged: false };
  }, SERIALIZABLE);
}

function memberKey(jerseyNumber: number | null, normalizedName: string) {
  return `${jerseyNumber ?? "none"}:${normalizedName}`;
}

function assertDatabaseCoverage(
  collection: NonNullable<Awaited<ReturnType<typeof fetchCollection>>>,
  assets: PreparedArtifact[],
  expectedBlankNumbers: number[],
) {
  const players = collection.members.filter((member) => member.roleGroup === SignatureMemberGroup.PLAYER);
  const byKey = new Map(players.map((member) => [memberKey(member.jerseyNumber, member.normalizedName), member]));
  const missing = players.filter((member) => !assets.some((asset) => memberKey(asset.jerseyNumber, asset.normalizedName) === memberKey(member.jerseyNumber, member.normalizedName)));
  const missingNumbers = missing.map((member) => member.jerseyNumber).filter((number): number is number => number !== null).sort((left, right) => left - right);
  if (missingNumbers.join(",") !== expectedBlankNumbers.join(",")) {
    throw new Error(`Production roster coverage mismatch. Missing jersey numbers: ${missingNumbers.join(",") || "none"}; expected: ${expectedBlankNumbers.join(",") || "none"}.`);
  }
  for (const asset of assets) {
    const member = byKey.get(memberKey(asset.jerseyNumber, asset.normalizedName));
    if (!member) throw new Error(`No active Production player matches ${asset.name} (#${asset.jerseyNumber}).`);
    if (!member.capture) throw new Error(`Production capture row is missing for ${asset.name}.`);
  }
  for (const blankNumber of expectedBlankNumbers) {
    const member = players.find((candidate) => candidate.jerseyNumber === blankNumber);
    if (!member || member.capture?.currentRevisionId) throw new Error(`Expected #${blankNumber} to remain blank, but it already has a current signature.`);
  }
  return { playerCount: players.length, assetCount: assets.length, blankNumbers: missingNumbers };
}

function assertStandaloneStaffCoverage(
  collection: NonNullable<Awaited<ReturnType<typeof fetchCollection>>>,
  assets: PreparedArtifact[],
  memberName: string,
  roleGroup: SignatureMemberGroup,
) {
  const label = roleGroup === SignatureMemberGroup.CREATIVE_STAFF ? "Creative Staff" : "Administration";
  if (assets.length !== 1) throw new Error(`${label} artifact imports require exactly one manifest entry.`);
  const asset = assets[0];
  if (!asset) throw new Error(`${label} artifact manifest entry is missing.`);
  if (asset.jerseyNumber !== null) throw new Error(`${label} artifact manifests must use a null jersey number.`);
  const normalizedName = normalizeSignatureName(memberName);
  if (asset.normalizedName !== normalizedName) throw new Error(`Manifest signer ${asset.name} does not match --member-name ${memberName}.`);
  const matches = collection.members.filter((member) => member.roleGroup === roleGroup && member.normalizedName === normalizedName);
  if (matches.length !== 1) throw new Error(`Expected exactly one active ${label} member named ${memberName}; found ${matches.length}.`);
  const member = matches[0];
  if (!member) throw new Error(`${label} member ${memberName} is missing after matching.`);
  if (!member.capture) throw new Error(`${label} capture row is missing for ${memberName}.`);
  return { member, asset };
}

function assertStandaloneStaffSourceCoverage(
  entries: SignatureRosterEntry[],
  assets: PreparedArtifact[],
  memberName: string,
  roleGroup: SignatureMemberGroup,
) {
  const label = roleGroup === SignatureMemberGroup.CREATIVE_STAFF ? "Creative Staff" : "Administration";
  if (assets.length !== 1) throw new Error(`${label} artifact imports require exactly one manifest entry.`);
  const asset = assets[0];
  if (!asset) throw new Error(`${label} artifact manifest entry is missing.`);
  if (asset.jerseyNumber !== null) throw new Error(`${label} artifact manifests must use a null jersey number.`);
  const normalizedName = normalizeSignatureName(memberName);
  if (asset.normalizedName !== normalizedName) throw new Error(`Manifest signer ${asset.name} does not match --member-name ${memberName}.`);
  const matches = entries.filter((entry) => entry.roleGroup === roleGroup && entry.normalizedName === normalizedName);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label} source member named ${memberName}; found ${matches.length}.`);
  return { entry: matches[0], asset };
}

function assertTeamStaffCoverageInDatabase(
  collection: NonNullable<Awaited<ReturnType<typeof fetchCollection>>>,
  assets: PreparedArtifact[],
  memberName: string,
) {
  const label = `${signatureCollectionTitle(collection.sportCode)} staff`;
  if (assets.length !== 1) throw new Error(`${label} artifact imports require exactly one manifest entry.`);
  const asset = assets[0];
  if (!asset) throw new Error(`${label} artifact manifest entry is missing.`);
  if (asset.jerseyNumber !== null) throw new Error(`${label} artifact manifests must use a null jersey number.`);
  const normalizedName = normalizeSignatureName(memberName);
  if (asset.normalizedName !== normalizedName) throw new Error(`Manifest signer ${asset.name} does not match --member-name ${memberName}.`);
  const matches = collection.members.filter((member) => member.roleGroup !== SignatureMemberGroup.PLAYER && member.normalizedName === normalizedName);
  if (matches.length !== 1) throw new Error(`Expected exactly one active ${label} member named ${memberName}; found ${matches.length}.`);
  const member = matches[0];
  if (!member) throw new Error(`${label} member ${memberName} is missing after matching.`);
  if (!member.capture) throw new Error(`${label} capture row is missing for ${memberName}.`);
  return { member, asset };
}

function assertTeamStaffSourceCoverage(
  entries: SignatureRosterEntry[],
  assets: PreparedArtifact[],
  memberName: string,
  sportCode: string,
) {
  const label = `${signatureCollectionTitle(sportCode)} staff`;
  if (assets.length !== 1) throw new Error(`${label} artifact imports require exactly one manifest entry.`);
  const asset = assets[0];
  if (!asset) throw new Error(`${label} artifact manifest entry is missing.`);
  if (asset.jerseyNumber !== null) throw new Error(`${label} artifact manifests must use a null jersey number.`);
  const normalizedName = normalizeSignatureName(memberName);
  if (asset.normalizedName !== normalizedName) throw new Error(`Manifest signer ${asset.name} does not match --member-name ${memberName}.`);
  const matches = entries.filter((entry) => entry.roleGroup !== SignatureMemberGroup.PLAYER && entry.normalizedName === normalizedName);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label} source member named ${memberName}; found ${matches.length}.`);
  return { entry: matches[0], asset };
}

async function markRevisionFailed(db: PrismaClient, revisionId: string, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Signature import failed";
  await db.signatureArtifactRevision.updateMany({
    where: { id: revisionId, state: SignatureArtifactState.PENDING_DELETE },
    data: { errorMessage: message },
  });
}

async function importArtifact(
  db: PrismaClient,
  actor: Actor,
  collectionId: string,
  memberId: string,
  asset: PreparedArtifact,
) {
  const capture = await db.signatureCapture.findUnique({
    where: { memberId },
    include: { currentRevision: true, collection: true, member: true },
  });
  if (!capture || capture.collectionId !== collectionId) throw new Error(`Capture row is missing for ${asset.name}.`);
  if (capture.collection.status === SignatureCollectionStatus.ARCHIVED) throw new Error("The signature collection is archived.");
  if (capture.currentRevision) {
    if (capture.currentRevision.state !== SignatureArtifactState.READY || capture.currentRevision.pngHash !== asset.pngHash || capture.currentRevision.svgHash !== asset.svgHash) {
      throw new Error(`A different current signature already exists for ${asset.name}; refusing to replace it.`);
    }
    const [pngBytes, svgBytes] = await Promise.all([
      readPrivate(capture.currentRevision.pngPath),
      readPrivate(capture.currentRevision.svgPath),
    ]);
    if (sha256(pngBytes) !== asset.pngHash || sha256(svgBytes) !== asset.svgHash) throw new Error(`Stored artifact readback failed for ${asset.name}.`);
    return { name: asset.name, jerseyNumber: asset.jerseyNumber, status: "already-present" as const, revision: capture.currentRevision.revision };
  }

  const revisionId = randomUUID();
  const pngPath = artifactPath(collectionId, memberId, revisionId, "png");
  const svgPath = artifactPath(collectionId, memberId, revisionId, "svg");
  let revisionNumber = 0;
  try {
    await db.$transaction(async (tx) => {
      const current = await tx.signatureCapture.findUnique({ where: { id: capture.id }, select: { collectionId: true, memberId: true, captureVersion: true, currentRevisionId: true } });
      if (!current || current.collectionId !== collectionId || current.memberId !== memberId || current.currentRevisionId) throw new Error(`Signature changed before importing ${asset.name}.`);
      const latest = await tx.signatureArtifactRevision.findFirst({ where: { captureId: capture.id }, orderBy: { revision: "desc" }, select: { revision: true } });
      revisionNumber = (latest?.revision ?? 0) + 1;
      await tx.signatureArtifactRevision.create({
        data: {
          id: revisionId,
          captureId: capture.id,
          revision: revisionNumber,
          state: SignatureArtifactState.PENDING_DELETE,
          pngPath,
          svgPath,
          pngHash: asset.pngHash,
          svgHash: asset.svgHash,
          width: asset.width,
          height: asset.height,
          cropBounds: asset.cropBounds,
        },
      });
    }, SERIALIZABLE);

    await uploadPrivate(pngPath, asset.pngBytes, "image/png");
    await uploadPrivate(svgPath, asset.svgBytes, "image/svg+xml");
    const [storedPng, storedSvg] = await Promise.all([readPrivate(pngPath), readPrivate(svgPath)]);
    if (sha256(storedPng) !== asset.pngHash || sha256(storedSvg) !== asset.svgHash) throw new Error(`Stored artifact readback failed for ${asset.name}.`);

    await db.$transaction(async (tx) => {
      const current = await tx.signatureCapture.findUnique({ where: { id: capture.id }, include: { currentRevision: true, collection: true, member: true } });
      if (!current || current.collectionId !== collectionId || current.memberId !== memberId || current.currentRevisionId || current.collection.status === SignatureCollectionStatus.ARCHIVED) {
        throw new Error(`Signature changed before finalizing ${asset.name}.`);
      }
      const now = new Date();
      const revision = await tx.signatureArtifactRevision.update({ where: { id: revisionId }, data: { state: SignatureArtifactState.READY, committedAt: now } });
      const updatedCapture = await tx.signatureCapture.update({ where: { id: capture.id }, data: { currentRevisionId: revision.id, captureVersion: { increment: 1 }, capturedAt: now, capturedById: actor.id }, select: { captureVersion: true } });
      await tx.signatureCollection.updateMany({ where: { id: collectionId, firstCaptureAt: null }, data: { firstCaptureAt: now, updatedById: actor.id } });
      await writeAudit(tx, actor, "SignatureCapture", capture.id, "IMPORT", {
        captureVersion: current.captureVersion,
        priorRevisionId: current.currentRevisionId,
      }, {
        captureVersion: updatedCapture.captureVersion,
        revisionId: revision.id,
        revision: revision.revision,
        pngHash: revision.pngHash,
        svgHash: revision.svgHash,
        width: revision.width,
        height: revision.height,
        source: "illustrator-ios",
      });
    }, SERIALIZABLE);
  } catch (error) {
    await markRevisionFailed(db, revisionId, error);
    try {
      await deletePrivate([pngPath, svgPath]);
    } catch {
      // The durable PENDING_DELETE row remains available to cleanup tooling.
    }
    throw error;
  }
  return { name: asset.name, jerseyNumber: asset.jerseyNumber, status: "imported" as const, revision: revisionNumber };
}

async function main() {
  const requestedSportCode = option("--sport") ?? "VB";
  const season = option("--season") ?? "2026-27";
  const manifestPath = option("--manifest");
  const memberName = option("--member-name");
  const apply = hasFlag("--apply");
  const confirm = hasFlag("--confirm");
  const expectedBlankNumbers = parseExpectedBlankNumbers();
  if (!manifestPath) throw new Error("Provide --manifest <manifest.json>.");
  if (apply && !confirm) throw new Error("Refusing a Production write without --confirm.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const isStandaloneStaffImport = requestedSportCode === SIGNATURE_CREATIVE_STAFF_SPORT_CODE || requestedSportCode === SIGNATURE_ADMINISTRATION_SPORT_CODE;
  const standaloneStaffRoleGroup = requestedSportCode === SIGNATURE_ADMINISTRATION_SPORT_CODE
    ? SignatureMemberGroup.SUPPORT_STAFF
    : SignatureMemberGroup.CREATIVE_STAFF;
  const standaloneStaffLabel = requestedSportCode === SIGNATURE_ADMINISTRATION_SPORT_CODE ? "Administration" : "Creative Staff";
  const isTeamStaffImport = !isStandaloneStaffImport && Boolean(memberName);
  if (isStandaloneStaffImport && !memberName) throw new Error(`${standaloneStaffLabel} imports require --member-name <name>.`);

  const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
  try {
    const assets = await loadManifest(manifestPath);
    if (isStandaloneStaffImport) {
      const sourceSnapshot = requestedSportCode === SIGNATURE_ADMINISTRATION_SPORT_CODE
        ? await fetchUWBadgersRoster(SIGNATURE_ADMINISTRATION_SPORT_CODE, season)
        : null;
      const existingCollection = await fetchCollection(db, requestedSportCode, season);
      if (!sourceSnapshot && !existingCollection) throw new Error(`The Production ${SIGNATURE_CREATIVE_STAFF_SPORT_CODE} collection does not exist.`);
      const sourceMatch = sourceSnapshot
        ? assertStandaloneStaffSourceCoverage(sourceSnapshot.entries, assets, memberName!, standaloneStaffRoleGroup)
        : null;

      if (!apply) {
        const databaseMatch = existingCollection
          ? assertStandaloneStaffCoverage(existingCollection, assets, memberName!, standaloneStaffRoleGroup)
          : null;
        console.log(JSON.stringify({
          mode: "dry-run",
          sportCode: requestedSportCode,
          season,
          source: sourceSnapshot ? { url: sourceSnapshot.sourceUrl, hash: sourceSnapshot.sourceHash, parserVersion: sourceSnapshot.parserVersion, entryCount: sourceSnapshot.entries.length, member: sourceMatch?.entry ?? null } : null,
          collection: existingCollection ? { id: existingCollection.id, version: existingCollection.collectionVersion, status: existingCollection.status } : null,
          member: databaseMatch ? { id: databaseMatch.member.id, name: databaseMatch.member.name, roleGroup: databaseMatch.member.roleGroup, currentRevision: databaseMatch.member.capture?.currentRevision ? { id: databaseMatch.member.capture.currentRevision.id, revision: databaseMatch.member.capture.currentRevision.revision, state: databaseMatch.member.capture.currentRevision.state } : null } : null,
          asset: { name: assets[0]?.name, pngHash: assets[0]?.pngHash, svgHash: assets[0]?.svgHash, width: assets[0]?.width, height: assets[0]?.height },
          message: `No ${standaloneStaffLabel} roster or artifact writes were performed. Re-run with --apply --confirm to execute the guarded import.`,
        }, null, 2));
        return;
      }

      const actor = await findActor(db);
      privateBlobAuth();
      const roster = sourceSnapshot
        ? await applyRoster(db, actor, sourceSnapshot, SIGNATURE_ADMINISTRATION_SPORT_CODE, season)
        : null;
      const collection = await fetchCollection(db, requestedSportCode, season);
      if (!collection) throw new Error(`The Production ${requestedSportCode} collection was not readable after roster apply.`);
      const { member, asset } = assertStandaloneStaffCoverage(collection, assets, memberName!, standaloneStaffRoleGroup);
      const currentRevision = member.capture?.currentRevision ?? null;
      if (currentRevision && (currentRevision.state !== SignatureArtifactState.READY || currentRevision.pngHash !== asset.pngHash || currentRevision.svgHash !== asset.svgHash)) {
        throw new Error(`A different current signature already exists for ${member.name}; refusing to replace it.`);
      }
      const result = await importArtifact(db, actor, collection.id, member.id, asset);
      const finalCollection = await fetchCollection(db, requestedSportCode, season);
      const finalMember = finalCollection?.members.find((candidate) => candidate.id === member.id);
      const finalRevision = finalMember?.capture?.currentRevision;
      if (!finalRevision || finalRevision.state !== SignatureArtifactState.READY || finalRevision.pngHash !== asset.pngHash || finalRevision.svgHash !== asset.svgHash) {
        throw new Error(`${standaloneStaffLabel} artifact verification failed for ${member.name}.`);
      }
      console.log(JSON.stringify({
        mode: "applied",
        sportCode: requestedSportCode,
        season,
        actorRole: actor.role,
        source: sourceSnapshot ? { url: sourceSnapshot.sourceUrl, hash: sourceSnapshot.sourceHash, parserVersion: sourceSnapshot.parserVersion, entryCount: sourceSnapshot.entries.length } : null,
        roster,
        collection: { id: collection.id, version: finalCollection?.collectionVersion ?? collection.collectionVersion, status: finalCollection?.status ?? collection.status },
        member: { id: member.id, name: member.name, roleGroup: member.roleGroup },
        artifact: result,
        message: `Production ${standaloneStaffLabel} artifact and private readback verification completed.`,
      }, null, 2));
      return;
    }

    if (isTeamStaffImport) {
      const sportCode = requestedSportCode as SignatureImportedSportCode;
      const snapshot = await fetchUWBadgersRoster(sportCode, season);
      const sourceMatch = assertTeamStaffSourceCoverage(snapshot.entries, assets, memberName!, sportCode);
      const existingCollection = await fetchCollection(db, sportCode, season);

      if (!apply) {
        const databaseMatch = existingCollection
          ? assertTeamStaffCoverageInDatabase(existingCollection, assets, memberName!)
          : null;
        console.log(JSON.stringify({
          mode: "dry-run",
          sportCode,
          season,
          source: { url: snapshot.sourceUrl, hash: snapshot.sourceHash, parserVersion: snapshot.parserVersion, entryCount: snapshot.entries.length, member: sourceMatch.entry },
          collection: existingCollection ? { id: existingCollection.id, version: existingCollection.collectionVersion, status: existingCollection.status } : null,
          member: databaseMatch ? { id: databaseMatch.member.id, name: databaseMatch.member.name, roleGroup: databaseMatch.member.roleGroup, currentRevision: databaseMatch.member.capture?.currentRevision ? { id: databaseMatch.member.capture.currentRevision.id, revision: databaseMatch.member.capture.currentRevision.revision, state: databaseMatch.member.capture.currentRevision.state } : null } : null,
          asset: { name: assets[0]?.name, pngHash: assets[0]?.pngHash, svgHash: assets[0]?.svgHash, width: assets[0]?.width, height: assets[0]?.height },
          message: `No ${signatureCollectionTitle(sportCode)} staff roster or artifact writes were performed. Re-run with --apply --confirm to execute the guarded import.`,
        }, null, 2));
        return;
      }

      const actor = await findActor(db);
      privateBlobAuth();
      const roster = await applyRoster(db, actor, snapshot, sportCode, season);
      const collection = await fetchCollection(db, sportCode, season);
      if (!collection) throw new Error(`The Production ${sportCode} collection was not readable after roster apply.`);
      const { member, asset } = assertTeamStaffCoverageInDatabase(collection, assets, memberName!);
      const currentRevision = member.capture?.currentRevision ?? null;
      if (currentRevision && (currentRevision.state !== SignatureArtifactState.READY || currentRevision.pngHash !== asset.pngHash || currentRevision.svgHash !== asset.svgHash)) {
        throw new Error(`A different current signature already exists for ${member.name}; refusing to replace it.`);
      }
      const result = await importArtifact(db, actor, collection.id, member.id, asset);
      const finalCollection = await fetchCollection(db, sportCode, season);
      const finalMember = finalCollection?.members.find((candidate) => candidate.id === member.id);
      const finalRevision = finalMember?.capture?.currentRevision;
      if (!finalRevision || finalRevision.state !== SignatureArtifactState.READY || finalRevision.pngHash !== asset.pngHash || finalRevision.svgHash !== asset.svgHash) {
        throw new Error(`${signatureCollectionTitle(sportCode)} staff artifact verification failed for ${member.name}.`);
      }
      console.log(JSON.stringify({
        mode: "applied",
        sportCode,
        season,
        actorRole: actor.role,
        source: { url: snapshot.sourceUrl, hash: snapshot.sourceHash, parserVersion: snapshot.parserVersion, entryCount: snapshot.entries.length },
        roster,
        collection: { id: collection.id, version: finalCollection?.collectionVersion ?? collection.collectionVersion, status: finalCollection?.status ?? collection.status },
        member: { id: member.id, name: member.name, roleGroup: member.roleGroup },
        artifact: result,
        message: `${signatureCollectionTitle(sportCode)} staff artifact and private readback verification completed.`,
      }, null, 2));
      return;
    }

    const sportCode = requestedSportCode as SignatureImportedSportCode;
    const snapshot = await fetchUWBadgersRoster(sportCode, season);
    const sourceCoverage = assertAssetCoverage(snapshot.entries, assets, expectedBlankNumbers);
    const existingCollection = await fetchCollection(db, sportCode, season);
    if (!apply) {
      const databaseCoverage = existingCollection
        ? assertDatabaseCoverage(existingCollection, assets, expectedBlankNumbers)
        : null;
      console.log(JSON.stringify({
        mode: "dry-run",
        sportCode,
        season,
        source: { url: snapshot.sourceUrl, hash: snapshot.sourceHash, parserVersion: snapshot.parserVersion, entryCount: snapshot.entries.length },
        coverage: { source: sourceCoverage, database: databaseCoverage },
        collection: existingCollection ? { id: existingCollection.id, version: existingCollection.collectionVersion, status: existingCollection.status } : null,
        message: "No Production roster or artifact writes were performed. Re-run with --apply --confirm to execute the guarded import.",
      }, null, 2));
      return;
    }

    const actor = await findActor(db);
    privateBlobAuth();
    const roster = await applyRoster(db, actor, snapshot, sportCode, season);
    const collection = await fetchCollection(db, sportCode, season);
    if (!collection) throw new Error("The Production collection was not readable after roster apply.");
    const databaseCoverage = assertDatabaseCoverage(collection, assets, expectedBlankNumbers);
    const membersByKey = new Map(collection.members.map((member) => [memberKey(member.jerseyNumber, member.normalizedName), member]));
    const results = [];
    for (const asset of assets) {
      const member = membersByKey.get(memberKey(asset.jerseyNumber, asset.normalizedName));
      if (!member) throw new Error(`No Production member matched ${asset.name}.`);
      results.push(await importArtifact(db, actor, collection.id, member.id, asset));
    }
    const finalCollection = await fetchCollection(db, sportCode, season);
    if (!finalCollection) throw new Error("The Production collection disappeared during verification.");
    const finalCoverage = assertDatabaseCoverage(finalCollection, assets, expectedBlankNumbers);
    console.log(JSON.stringify({
      mode: "applied",
      sportCode,
      season,
      actorRole: actor.role,
      source: { url: snapshot.sourceUrl, hash: snapshot.sourceHash, parserVersion: snapshot.parserVersion, entryCount: snapshot.entries.length },
      roster,
      coverage: { source: sourceCoverage, beforeArtifacts: databaseCoverage, final: finalCoverage },
      artifacts: results,
      message: "Production roster and private artifact verification completed. Expected blank jersey members were not given artifacts.",
    }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
