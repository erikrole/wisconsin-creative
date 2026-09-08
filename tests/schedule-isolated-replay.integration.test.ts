import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { getPublishPreflight, publishShiftGroup } from "@/lib/services/schedule-publication";
import { releasePendingScheduleVersion } from "@/workflows/pending-schedule-release";

// Deliberate opt-in against the retained incident clone only. Normal test runs
// never reach a database, and this cannot target the default/production host.
it.skipIf(process.env.WC_SCHEDULE_ISOLATED_REPLAY !== "1")("replays the blocked Hockey release without changing the isolated record", async () => {
  expect(new URL(process.env.DATABASE_URL!).hostname).toBe("ep-tiny-rain-ainaxdg2-pooler.c-4.us-east-1.aws.neon.tech");
  const id = "cmsoe6kbl000fla04e5i10z7l";
  const snapshot = () => db.shiftGroup.findUniqueOrThrow({ where: { id }, select: {
    publishedAt: true, publishedVersion: true, lastPublishedSnapshot: true,
    workingCopy: { select: { version: true, updatedById: true, updatedAt: true, payload: true, autoReleaseAt: true, autoReleaseError: true } },
    shifts: { orderBy: { id: "asc" }, select: { id: true, assignments: { select: { id: true, status: true, userId: true } } } },
  } });
  try {
    const before = await snapshot();
    expect(before.workingCopy?.version).toBe(2);
    const preflight = await getPublishPreflight(id);
    expect(preflight.blockers).toHaveLength(1);
    expect(preflight.blockers[0]!.message).toContain("Football vs Michigan State");
    expect(preflight.blockers[0]!.message).toContain("Sat, Oct 3 (all day)");
    await expect(publishShiftGroup(id, before.workingCopy!.updatedById, 2, "STAFF")).rejects.toMatchObject({ status: 409 });
    expect(await releasePendingScheduleVersion(id, 1)).toMatchObject({ status: "superseded" });
    expect(await snapshot()).toEqual(before);
  } finally { await db.$disconnect(); }
}, 30000);
