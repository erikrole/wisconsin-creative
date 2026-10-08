import { GearPickFit, Prisma, Role } from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { withSerializationRetry } from "@/lib/serialization";
import {
  defaultAllowanceCents,
  findGearSku,
  formatUsd,
  GEAR_CATALOG,
  GEAR_PICK_CYCLE_ID,
  isItemAllowedForFit,
  type GearPickFitKey,
} from "@/lib/gear-picks/catalog";
import { isGearPickCycleOpen, priceGearPickLines, type GearPickLineInput } from "@/lib/gear-picks/pricing";
import type {
  GearPickAdminParticipant,
  GearPickAggregateRow,
  GearPickCycleDto,
  GearPickLineDto,
  GearPicksAdminResponse,
  GearPicksMeResponse,
  GearPickSubmissionDto,
  GearPickSubmissionStatus,
} from "@/lib/gear-picks/types";

type Actor = { id: string; role: Role; preview?: { actualRole: "ADMIN" } };

/** A real admin, including one using "Preview as" another role. */
function isSignedInAdmin(actor: Actor) {
  return actor.role === Role.ADMIN || actor.preview?.actualRole === "ADMIN";
}

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

const lineSelect = {
  sku: true,
  style: true,
  colorCode: true,
  size: true,
  quantity: true,
  unitPriceCents: true,
} as const;

const submissionSelect = {
  id: true,
  version: true,
  totalCents: true,
  submittedAt: true,
  updatedAt: true,
  lines: { select: lineSelect, orderBy: [{ sku: "asc" }, { size: "asc" }] },
} satisfies Prisma.GearPickSubmissionSelect;

type LineRow = Prisma.GearPickLineGetPayload<{ select: typeof lineSelect }>;
type SubmissionRow = Prisma.GearPickSubmissionGetPayload<{ select: typeof submissionSelect }>;

function cycleDto(
  cycle: { id: string; title: string; deadline: Date | null; launchedAt: Date | null },
  now: Date,
): GearPickCycleDto {
  return {
    id: cycle.id,
    title: cycle.title,
    deadline: cycle.deadline?.toISOString() ?? null,
    isOpen: isGearPickCycleOpen(cycle.deadline, now),
    launchedAt: cycle.launchedAt?.toISOString() ?? null,
  };
}

export function gearPickLineDto(line: LineRow): GearPickLineDto {
  const entry = findGearSku(line.sku);
  return {
    sku: line.sku,
    style: line.style,
    colorCode: line.colorCode,
    size: line.size,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    lineTotalCents: line.unitPriceCents * line.quantity,
    itemName: entry?.item.name ?? line.sku,
    colorLabel: entry?.color.label ?? line.colorCode,
    category: entry?.item.category ?? null,
  };
}

function submissionDto(submission: SubmissionRow | null): GearPickSubmissionDto | null {
  if (!submission) return null;
  return {
    version: submission.version,
    totalCents: submission.totalCents,
    submittedAt: submission.submittedAt?.toISOString() ?? null,
    updatedAt: submission.updatedAt.toISOString(),
    lines: submission.lines.map(gearPickLineDto),
  };
}

export function gearPickSubmissionStatus(
  submission: { submittedAt: Date | string | null } | null,
): GearPickSubmissionStatus {
  if (!submission) return "NOT_STARTED";
  return submission.submittedAt ? "SUBMITTED" : "DRAFT";
}

function auditLines(lines: { sku: string; size: string | null; quantity: number; unitPriceCents: number }[]) {
  return lines.map((line) => ({
    sku: line.sku,
    size: line.size,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
  }));
}

// ── Participant (self-service) ─────────────────────────────

export async function getMyGearPicks(user: Actor, now: Date = new Date()): Promise<GearPicksMeResponse> {
  return getGearPicksForUser(user.id, user, now);
}

/**
 * One person's cycle, participation, and saved list. Callers own the
 * self-or-manage access check. Before launch, non-admins see no cycle at all,
 * so the banner, /gear, and the profile tab stay admin-only. An admin using
 * "Preview as" still sees it, so the staff view can be checked before opening.
 */
export async function getGearPicksForUser(
  userId: string,
  viewer: Actor,
  now: Date = new Date(),
): Promise<GearPicksMeResponse> {
  const [cycle, participant, profile] = await Promise.all([
    db.gearPickCycle.findUnique({
      where: { id: GEAR_PICK_CYCLE_ID },
      select: { id: true, title: true, deadline: true, launchedAt: true },
    }),
    db.gearPickParticipant.findUnique({
      where: { cycleId_userId: { cycleId: GEAR_PICK_CYCLE_ID, userId } },
      select: { id: true, fit: true, allowanceCents: true, submission: { select: submissionSelect } },
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { topSize: true, topSizeFit: true, shoeSize: true, shoeSizeSystem: true },
    }),
  ]);

  const isAdmin = viewer.role === Role.ADMIN;
  const visibleCycle = cycle && (cycle.launchedAt || isSignedInAdmin(viewer)) ? cycle : null;
  const visibleParticipant = visibleCycle ? participant : null;

  return {
    cycle: visibleCycle ? cycleDto(visibleCycle, now) : null,
    participant: visibleParticipant
      ? { id: visibleParticipant.id, fit: visibleParticipant.fit, allowanceCents: visibleParticipant.allowanceCents }
      : null,
    submission: submissionDto(visibleParticipant?.submission ?? null),
    profile: {
      topSize: profile?.topSize ?? null,
      topSizeFit: profile?.topSizeFit ?? null,
      shoeSize: profile?.shoeSize ?? null,
      shoeSizeSystem: profile?.shoeSizeSystem ?? null,
    },
    isAdmin,
  };
}

export async function saveMyGearPicks(params: {
  actor: Actor;
  lines: GearPickLineInput[];
  submit: boolean;
  /** The submission version the client last read; 0 when it has never saved. */
  version: number;
  now?: Date;
}): Promise<GearPickSubmissionDto> {
  const { actor, submit, version } = params;
  return withSerializationRetry(() =>
    db.$transaction(async (tx) => {
      const now = params.now ?? new Date();
      const cycle = await tx.gearPickCycle.findUnique({
        where: { id: GEAR_PICK_CYCLE_ID },
        select: { id: true, deadline: true, launchedAt: true },
      });
      if (!cycle || (!cycle.launchedAt && !isSignedInAdmin(actor))) {
        throw new HttpError(404, "Gear picks aren't open yet.");
      }

      const participant = await tx.gearPickParticipant.findUnique({
        where: { cycleId_userId: { cycleId: cycle.id, userId: actor.id } },
        select: {
          id: true,
          fit: true,
          allowanceCents: true,
          submission: { select: submissionSelect },
        },
      });
      if (!participant) {
        throw new HttpError(403, "You're not on this year's gear pick list. Ask an admin if that's a mistake.");
      }
      if (!isGearPickCycleOpen(cycle.deadline, now)) {
        throw new HttpError(409, "Gear picks are closed. Your saved list is locked.", { code: "GEAR_PICKS_CLOSED" });
      }

      const existing = participant.submission;
      const currentVersion = existing?.version ?? 0;
      if (currentVersion !== version) {
        throw new HttpError(
          409,
          "Your picks changed somewhere else since you opened this page. Reload to see the latest list, then make your changes again.",
          { code: "GEAR_PICKS_STALE" },
        );
      }

      const priced = priceGearPickLines({
        fit: participant.fit,
        allowanceCents: participant.allowanceCents,
        lines: params.lines,
      });
      if (submit && priced.lines.length === 0) {
        throw new HttpError(400, "Add at least one item before you submit.");
      }

      const lineData = priced.lines.map((line) => ({
        sku: line.sku,
        style: line.style,
        colorCode: line.colorCode,
        size: line.size,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
      }));

      let submissionId: string;
      if (existing) {
        await tx.gearPickLine.deleteMany({ where: { submissionId: existing.id } });
        const updated = await tx.gearPickSubmission.update({
          where: { id: existing.id },
          data: {
            totalCents: priced.totalCents,
            version: { increment: 1 },
            submittedAt: existing.submittedAt ?? (submit ? now : null),
          },
          select: { id: true },
        });
        submissionId = updated.id;
      } else {
        const created = await tx.gearPickSubmission.create({
          data: {
            participantId: participant.id,
            totalCents: priced.totalCents,
            submittedAt: submit ? now : null,
          },
          select: { id: true },
        });
        submissionId = created.id;
      }
      if (lineData.length > 0) {
        await tx.gearPickLine.createMany({
          data: lineData.map((line) => ({ ...line, submissionId })),
        });
      }

      const saved = await tx.gearPickSubmission.findUniqueOrThrow({
        where: { id: submissionId },
        select: submissionSelect,
      });

      await createAuditEntryTx(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "gear_pick_submission",
        entityId: submissionId,
        action: submit ? "submit" : "save_draft",
        before: existing
          ? {
              version: existing.version,
              totalCents: existing.totalCents,
              submittedAt: existing.submittedAt?.toISOString() ?? null,
              lines: auditLines(existing.lines),
            }
          : undefined,
        after: {
          cycleId: cycle.id,
          participantId: participant.id,
          version: saved.version,
          totalCents: saved.totalCents,
          submittedAt: saved.submittedAt?.toISOString() ?? null,
          lines: auditLines(saved.lines),
        },
      });

      return submissionDto(saved)!;
    }, SERIALIZABLE),
  );
}

// ── Admin ──────────────────────────────────────────────────

async function loadCycleOrThrow(client: Prisma.TransactionClient | typeof db) {
  const cycle = await client.gearPickCycle.findUnique({
    where: { id: GEAR_PICK_CYCLE_ID },
    select: { id: true, title: true, deadline: true, launchedAt: true },
  });
  if (!cycle) throw new HttpError(404, "The 2027–28 gear pick cycle hasn't been set up.");
  return cycle;
}

export function aggregateGearPickTotals(
  lines: Pick<GearPickLineDto, "sku" | "itemName" | "colorLabel" | "size" | "quantity" | "lineTotalCents">[],
): GearPickAggregateRow[] {
  const byKey = new Map<string, GearPickAggregateRow>();
  for (const line of lines) {
    const key = `${line.sku}|${line.size ?? ""}`;
    const row = byKey.get(key) ?? {
      sku: line.sku,
      itemName: line.itemName,
      colorLabel: line.colorLabel,
      size: line.size,
      quantity: 0,
      totalCents: 0,
    };
    row.quantity += line.quantity;
    row.totalCents += line.lineTotalCents;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.itemName.localeCompare(b.itemName)
      || a.colorLabel.localeCompare(b.colorLabel)
      || (a.size ?? "").localeCompare(b.size ?? "", undefined, { numeric: true }),
  );
}

export async function getGearPicksAdmin(now: Date = new Date()): Promise<GearPicksAdminResponse> {
  const cycle = await loadCycleOrThrow(db);
  const [participants, users] = await Promise.all([
    db.gearPickParticipant.findMany({
      where: { cycleId: cycle.id },
      select: {
        id: true,
        fit: true,
        allowanceCents: true,
        user: { select: { id: true, name: true, email: true, active: true, topSize: true, shoeSize: true } },
        submission: { select: submissionSelect },
      },
      orderBy: [{ user: { name: "asc" } }, { id: "asc" }],
    }),
    db.user.findMany({
      where: { active: true, role: { not: Role.COLLABORATOR } },
      select: { id: true, name: true, role: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
  ]);

  const rows: GearPickAdminParticipant[] = participants.map((participant) => ({
    id: participant.id,
    fit: participant.fit,
    allowanceCents: participant.allowanceCents,
    user: participant.user,
    status: gearPickSubmissionStatus(participant.submission),
    submission: submissionDto(participant.submission),
  }));

  const participantUserIds = new Set(rows.map((row) => row.user.id));
  const allLines = rows.flatMap((row) => row.submission?.lines ?? []);

  return {
    cycle: cycleDto(cycle, now),
    participants: rows,
    totals: aggregateGearPickTotals(allLines),
    summary: {
      participantCount: rows.length,
      submittedCount: rows.filter((row) => row.status === "SUBMITTED").length,
      draftCount: rows.filter((row) => row.status === "DRAFT").length,
      notStartedCount: rows.filter((row) => row.status === "NOT_STARTED").length,
      totalCents: rows.reduce((sum, row) => sum + (row.submission?.totalCents ?? 0), 0),
    },
    candidates: users
      .filter((user) => !participantUserIds.has(user.id))
      .map((user) => ({ id: user.id, name: user.name, role: user.role })),
  };
}

export type GearPicksAdminChange =
  | { action: "setDeadline"; deadline: string | null }
  | { action: "setLaunched"; launched: boolean }
  | { action: "addParticipant"; userId: string; fit: GearPickFitKey; allowanceCents?: number }
  | { action: "updateParticipant"; participantId: string; fit?: GearPickFitKey; allowanceCents?: number }
  | { action: "removeParticipant"; participantId: string };

export async function applyGearPicksAdminChange(actor: Actor, change: GearPicksAdminChange) {
  return withSerializationRetry(() =>
    db.$transaction(async (tx) => {
      const cycle = await loadCycleOrThrow(tx);

      switch (change.action) {
        case "setDeadline": {
          const deadline = change.deadline ? new Date(change.deadline) : null;
          await tx.gearPickCycle.update({ where: { id: cycle.id }, data: { deadline } });
          await createAuditEntryTx(tx, {
            actorId: actor.id,
            actorRole: actor.role,
            entityType: "gear_pick_cycle",
            entityId: cycle.id,
            action: "set_deadline",
            before: { deadline: cycle.deadline?.toISOString() ?? null },
            after: { deadline: deadline?.toISOString() ?? null },
          });
          return { cycleId: cycle.id };
        }

        case "setLaunched": {
          const launchedAt = change.launched ? (cycle.launchedAt ?? new Date()) : null;
          await tx.gearPickCycle.update({ where: { id: cycle.id }, data: { launchedAt } });
          await createAuditEntryTx(tx, {
            actorId: actor.id,
            actorRole: actor.role,
            entityType: "gear_pick_cycle",
            entityId: cycle.id,
            action: change.launched ? "launch" : "unlaunch",
            before: { launchedAt: cycle.launchedAt?.toISOString() ?? null },
            after: { launchedAt: launchedAt?.toISOString() ?? null },
          });
          return { cycleId: cycle.id };
        }

        case "addParticipant": {
          const user = await tx.user.findUnique({
            where: { id: change.userId },
            select: { id: true, name: true, active: true, role: true },
          });
          if (!user || !user.active || user.role === Role.COLLABORATOR) {
            throw new HttpError(404, "That person isn't an active staff account.");
          }
          const allowanceCents = change.allowanceCents ?? defaultAllowanceCents(change.fit);
          // The (cycle, user) unique constraint decides duplicates; P2002 maps to a friendly 409.
          const participant = await tx.gearPickParticipant.create({
            data: {
              cycleId: cycle.id,
              userId: user.id,
              fit: change.fit as GearPickFit,
              allowanceCents,
            },
            select: { id: true },
          });
          await createAuditEntryTx(tx, {
            actorId: actor.id,
            actorRole: actor.role,
            entityType: "gear_pick_participant",
            entityId: participant.id,
            action: "add",
            after: { cycleId: cycle.id, userId: user.id, userName: user.name, fit: change.fit, allowanceCents },
          });
          return { participantId: participant.id };
        }

        case "updateParticipant": {
          const existing = await tx.gearPickParticipant.findFirst({
            where: { id: change.participantId, cycleId: cycle.id },
            select: {
              id: true,
              fit: true,
              allowanceCents: true,
              userId: true,
              user: { select: { name: true } },
              submission: { select: { totalCents: true, lines: { select: { sku: true } } } },
            },
          });
          if (!existing) throw new HttpError(404, "That participant is no longer on the list.");
          // A saved or submitted list must still be valid under the new fit and
          // allowance, or the order export would carry picks they can't have.
          const nextFit = (change.fit ?? existing.fit) as GearPickFitKey;
          const nextAllowance = change.allowanceCents ?? existing.allowanceCents;
          const saved = existing.submission;
          if (saved) {
            const outside = saved.lines
              .map((line) => findGearSku(line.sku))
              .find((entry) => entry && !isItemAllowedForFit(entry.item, nextFit));
            if (outside) {
              throw new HttpError(
                409,
                `${existing.user.name} has ${outside.item.name} saved, which isn't in that catalog. Ask them to remove it first.`,
                { code: "GEAR_PICKS_CONFLICT" },
              );
            }
            if (saved.totalCents > nextAllowance) {
              throw new HttpError(
                409,
                `${existing.user.name}'s saved picks total ${formatUsd(saved.totalCents)}, more than ${formatUsd(nextAllowance)}. Ask them to remove something first.`,
                { code: "GEAR_PICKS_CONFLICT" },
              );
            }
          }
          const data: Prisma.GearPickParticipantUpdateInput = {};
          if (change.fit) data.fit = change.fit as GearPickFit;
          if (change.allowanceCents !== undefined) data.allowanceCents = change.allowanceCents;
          const updated = await tx.gearPickParticipant.update({
            where: { id: existing.id },
            data,
            select: { id: true, fit: true, allowanceCents: true },
          });
          await createAuditEntryTx(tx, {
            actorId: actor.id,
            actorRole: actor.role,
            entityType: "gear_pick_participant",
            entityId: existing.id,
            action: "update",
            before: { fit: existing.fit, allowanceCents: existing.allowanceCents },
            after: { userId: existing.userId, fit: updated.fit, allowanceCents: updated.allowanceCents },
          });
          return { participantId: existing.id };
        }

        case "removeParticipant": {
          const existing = await tx.gearPickParticipant.findFirst({
            where: { id: change.participantId, cycleId: cycle.id },
            select: {
              id: true,
              fit: true,
              allowanceCents: true,
              user: { select: { id: true, name: true } },
              submission: { select: submissionSelect },
            },
          });
          if (!existing) throw new HttpError(404, "That participant is no longer on the list.");
          await tx.gearPickParticipant.delete({ where: { id: existing.id } });
          await createAuditEntryTx(tx, {
            actorId: actor.id,
            actorRole: actor.role,
            entityType: "gear_pick_participant",
            entityId: existing.id,
            action: "remove",
            before: {
              cycleId: cycle.id,
              userId: existing.user.id,
              userName: existing.user.name,
              fit: existing.fit,
              allowanceCents: existing.allowanceCents,
              submission: existing.submission
                ? {
                    totalCents: existing.submission.totalCents,
                    submittedAt: existing.submission.submittedAt?.toISOString() ?? null,
                    lines: auditLines(existing.submission.lines),
                  }
                : null,
            },
          });
          return { participantId: existing.id };
        }
      }
    }, SERIALIZABLE),
  );
}

// ── CSV export ─────────────────────────────────────────────

export const GEAR_PICKS_CSV_HEADER = [
  "Group",
  "Person",
  "Item #",
  "Item",
  "Color",
  "Size",
  "Qty",
  "Unit Price",
  "Line Total",
  "Submitted At",
] as const;

export type GearPicksCsvRow = {
  group: string;
  person: string;
  itemNumber: string;
  item: string;
  color: string;
  size: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  submittedAt: string;
};

function plainDollars(cents: number) {
  return formatUsd(cents).slice(1);
}

export function buildGearPicksCsvRows(participants: GearPickAdminParticipant[]): GearPicksCsvRow[] {
  const categoryOrder = new Map(GEAR_CATALOG.categories.map((category, index) => [category, index]));
  const rows: GearPicksCsvRow[] = [];
  for (const participant of participants) {
    // Only submitted picks go to the order sheet; drafts stay out of the export.
    if (!participant.submission?.submittedAt) continue;
    const lines = [...participant.submission.lines].sort(
      (a, b) =>
        (categoryOrder.get(a.category ?? "") ?? 99) - (categoryOrder.get(b.category ?? "") ?? 99)
        || a.itemName.localeCompare(b.itemName)
        || (a.size ?? "").localeCompare(b.size ?? "", undefined, { numeric: true }),
    );
    for (const line of lines) {
      rows.push({
        group: "Staff Pick",
        person: participant.user.name,
        itemNumber: line.sku,
        item: line.itemName,
        color: line.colorLabel,
        size: line.size ?? "",
        quantity: line.quantity,
        unitPrice: plainDollars(line.unitPriceCents),
        lineTotal: plainDollars(line.lineTotalCents),
        submittedAt: participant.submission?.submittedAt ?? "",
      });
    }
  }
  return rows;
}
