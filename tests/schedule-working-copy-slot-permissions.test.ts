import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "STAFF" as Role,
  eventEndsAt: vi.fn(),
  mutate: vi.fn(),
  history: vi.fn(),
  enqueue: vi.fn(),
  publish: vi.fn(),
  getEditor: vi.fn(),
  after: vi.fn(),
  notify: vi.fn(),
}));

// Replace session lookup, but exercise the real route, schema, RBAC, and HTTP
// error mapping. Service writes and release scheduling stay isolated fixtures.
vi.mock("@/lib/api", async () => {
  const { fail } = await import("@/lib/http");
  return {
    withAuth: (handler: (req: Request, context: {
      user: { id: string; role: Role };
      params: { id: string };
    }) => Promise<Response>) => async (req: Request) => {
      try {
        return await handler(req, {
          user: { id: "staff-1", role: mocks.role },
          params: { id: "group-1" },
        });
      } catch (error) {
        return fail(error);
      }
    },
  };
});
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SCHEDULE_MUTATION_LIMIT: { max: 120, windowMs: 60_000 },
}));
vi.mock("@/lib/services/schedule-working-copy", () => ({
  discardWorkingSchedule: vi.fn(),
  changeWorkingScheduleHistory: mocks.history,
  getWorkingScheduleEditor: mocks.getEditor,
  getWorkingScheduleEventEndsAt: mocks.eventEndsAt,
  mutateWorkingSchedule: mocks.mutate,
  rebaseWorkingSchedule: vi.fn(),
}));
vi.mock("@/lib/services/schedule-publication", () => ({
  getPublishPreflight: vi.fn(),
  publishShiftGroup: mocks.publish,
}));
vi.mock("@/lib/schedule-auto-release", () => ({ enqueuePendingScheduleRelease: mocks.enqueue }));
vi.mock("@/lib/badges", () => ({ badges: { onShiftsWorked: vi.fn() } }));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after,
}));
vi.mock("@/lib/services/notifications", () => ({
  createPublishedShiftGroupNotifications: mocks.notify,
  notifyPublishedScheduleFollowers: mocks.notify,
  notifyPublishedShiftGroupWorkers: mocks.notify,
}));

import { PATCH } from "@/app/api/shift-groups/[id]/working-copy/route";
import { POST as publishNow } from "@/app/api/shift-groups/[id]/publish/route";
import { HttpError } from "@/lib/http";

function request(command: unknown) {
  return PATCH(new Request("https://app.example.com/api/shift-groups/group-1/working-copy", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: 5, command }),
  }), { params: Promise.resolve({ id: "group-1" }) });
}

describe("working schedule slot permissions", () => {
  beforeEach(() => {
    mocks.role = Role.STAFF;
    mocks.eventEndsAt.mockResolvedValue(new Date("2099-09-18T02:00:00Z"));
    mocks.mutate.mockResolvedValue({ workingVersion: 6 });
    mocks.enqueue.mockResolvedValue({ at: new Date("2099-09-15T01:10:00Z"), runId: "release-1" });
  });

  it.each([Role.ADMIN, Role.STAFF])("allows %s to add a Photo Staff slot through the versioned release path", async (role) => {
    mocks.role = role;
    const command = { type: "adjustSlots", area: "PHOTO", workerType: "FT", delta: 1 };

    const response = await request(command);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { workingVersion: 6 } });
    expect(mocks.enqueue).toHaveBeenCalledWith({ shiftGroupId: "group-1", version: 6 });
    expect(mocks.mutate).toHaveBeenCalledWith("group-1", 5, command,
      { id: "staff-1", role }, expect.objectContaining({ runId: "release-1" }), undefined);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it.each([Role.ADMIN, Role.STAFF])("allows %s to add Student slots", async (role) => {
    mocks.role = role;
    expect((await request({ type: "adjustSlots", area: "PHOTO", workerType: "ST", delta: 1 })).status).toBe(200);
    expect(mocks.mutate).toHaveBeenCalledOnce();
  });

  it.each([
    [Role.STUDENT, "FT"],
    [Role.STUDENT, "ST"],
    [Role.COLLABORATOR, "FT"],
    [Role.COLLABORATOR, "ST"],
  ] as const)("rejects %s adding a %s slot before any write or release is scheduled", async (role, workerType) => {
    mocks.role = role;
    const response = await request({ type: "adjustSlots", area: "PHOTO", workerType, delta: 1 });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mocks.eventEndsAt).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it.each(["FT", "ST"])("preserves Staff removal of an open %s slot", async (workerType) => {
    expect((await request({ type: "adjustSlots", area: "PHOTO", workerType, delta: -1 })).status).toBe(200);
    expect(mocks.mutate).toHaveBeenCalledOnce();
  });

  it("rejects an invalid staffing class before scheduling a release", async () => {
    expect((await request({ type: "adjustSlots", area: "PHOTO", workerType: "STAFF", delta: 1 })).status).toBe(400);
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});

function publishRequest(body: unknown = { expectedVersion: 5 }) {
  return publishNow(new Request("https://app.example.com/api/shift-groups/group-1/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "group-1" }) });
}

describe("publish-now permissions", () => {
  beforeEach(() => {
    mocks.role = Role.STAFF;
    mocks.eventEndsAt.mockResolvedValue(new Date("2099-09-18T02:00:00Z"));
    mocks.publish.mockResolvedValue({ before: { publishedAt: null }, affectedUserIds: [] });
    mocks.getEditor.mockResolvedValue({ workingVersion: 0, hasWorkingCopy: false });
  });

  it.each([Role.ADMIN, Role.STAFF])("allows %s through the audited, versioned publication service", async (role) => {
    mocks.role = role;
    const response = await publishRequest();
    expect(response.status).toBe(200);
    expect(mocks.publish).toHaveBeenCalledWith("group-1", "staff-1", 5, role, {
      clearNotificationPending: false,
      manualPublish: true,
      requireWorkingCopy: true,
    });
    expect(mocks.getEditor).toHaveBeenCalledWith("group-1", "staff-1");
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it.each([Role.STUDENT, Role.COLLABORATOR])("rejects %s before publication or notifications", async (role) => {
    mocks.role = role;
    expect((await publishRequest()).status).toBe(403);
    expect(mocks.eventEndsAt).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it.each([{}, { expectedVersion: 0 }])("requires a valid pending version: %j", async (body) => {
    expect((await publishRequest(body)).status).toBe(400);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("preserves a publication conflict without scheduling notifications", async () => {
    mocks.publish.mockRejectedValueOnce(new HttpError(409, "The working schedule changed. Refresh and try again."));
    const response = await publishRequest();
    expect(response.status).toBe(409);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.getEditor).not.toHaveBeenCalled();
  });
});
