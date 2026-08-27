import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventEndsAt: vi.fn(),
  mutate: vi.fn(),
  rebase: vi.fn(),
  getEditor: vi.fn(),
  enqueue: vi.fn(),
  publish: vi.fn(),
  onShiftsWorked: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: (req: Request, context: { user: { id: string; role: "ADMIN" }; params: { id: string } }) => Promise<Response>) =>
    async (req: Request, context: { params: Promise<{ id: string }> }) => handler(req, {
      user: { id: "admin-1", role: "ADMIN" },
      params: await context.params,
    }),
}));

vi.mock("@/lib/http", () => ({
  ok: (data: unknown) => new Response(JSON.stringify(data), { status: 200 }),
}));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/lib/rbac", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/services/schedule-working-copy", () => ({
  discardWorkingSchedule: vi.fn(),
  getWorkingScheduleEditor: mocks.getEditor,
  getWorkingScheduleEventEndsAt: mocks.eventEndsAt,
  mutateWorkingSchedule: mocks.mutate,
  rebaseWorkingSchedule: mocks.rebase,
}));
vi.mock("@/lib/services/schedule-publication", () => ({ publishShiftGroup: mocks.publish }));
vi.mock("@/lib/schedule-auto-release", () => ({ enqueuePendingScheduleRelease: mocks.enqueue }));
vi.mock("@/lib/badges", () => ({ badges: { onShiftsWorked: mocks.onShiftsWorked } }));

import { PATCH } from "@/app/api/shift-groups/[id]/working-copy/route";

const run = PATCH as unknown as (
  req: Request,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;

const command = { type: "assign", slotKey: "slot-1", userId: "user-1" };

function request() {
  return new Request("https://app.example.com/api/shift-groups/group-1/working-copy", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: 2, command }),
  });
}

const context = { params: Promise.resolve({ id: "group-1" }) };

describe("past-event Schedule backfill route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutate.mockResolvedValue({ workingVersion: 3, marker: "mutated" });
    mocks.getEditor.mockResolvedValue({ marker: "published" });
    mocks.rebase.mockResolvedValue({ workingVersion: 4, marker: "rebased" });
    mocks.publish.mockResolvedValue({ affectedUserIds: ["user-1"] });
    mocks.enqueue.mockResolvedValue({ at: new Date("2026-09-01T20:10:00.000Z"), runId: "run-1" });
    mocks.onShiftsWorked.mockResolvedValue(undefined);
  });

  it("publishes an ended-event edit immediately and keeps recognition silent", async () => {
    mocks.eventEndsAt.mockResolvedValue(new Date("2026-08-25T20:00:00.000Z"));

    const response = await run(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.mutate).toHaveBeenCalledWith(
      "group-1",
      2,
      command,
      { id: "admin-1", role: "ADMIN" },
      null,
    );
    expect(mocks.publish).toHaveBeenCalledWith(
      "group-1",
      "admin-1",
      3,
      "ADMIN",
      { clearNotificationPending: true },
    );
    expect(mocks.onShiftsWorked).toHaveBeenCalledWith({ userId: "user-1" }, { notify: false });
    await expect(response.json()).resolves.toEqual({ data: { marker: "published" } });
  });

  it("publishes an ended-event rebase immediately without creating a timer", async () => {
    mocks.eventEndsAt.mockResolvedValue(new Date("2026-08-25T20:00:00.000Z"));

    const { POST } = await import("@/app/api/shift-groups/[id]/working-copy/route");
    const runPost = POST as unknown as (
      req: Request,
      context: { params: Promise<{ id: string }> },
    ) => Promise<Response>;
    const response = await runPost(
      new Request("https://app.example.com/api/shift-groups/group-1/working-copy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 3 }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.rebase).toHaveBeenCalledWith(
      "group-1",
      3,
      { id: "admin-1", role: "ADMIN" },
      null,
    );
    expect(mocks.publish).toHaveBeenCalledWith(
      "group-1",
      "admin-1",
      4,
      "ADMIN",
      { clearNotificationPending: true },
    );
    expect(mocks.onShiftsWorked).toHaveBeenCalledWith({ userId: "user-1" }, { notify: false });
    await expect(response.json()).resolves.toEqual({ data: { marker: "published" } });
  });

  it("keeps a future-event edit on the existing release timer", async () => {
    mocks.eventEndsAt.mockResolvedValue(new Date("2026-09-25T20:00:00.000Z"));

    const response = await run(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledWith({ shiftGroupId: "group-1", version: 3 });
    expect(mocks.mutate).toHaveBeenCalledWith(
      "group-1",
      2,
      command,
      { id: "admin-1", role: "ADMIN" },
      expect.objectContaining({ runId: "run-1" }),
    );
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.onShiftsWorked).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ data: { workingVersion: 3, marker: "mutated" } });
  });
});
