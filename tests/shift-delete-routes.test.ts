import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { DELETE as deleteShift } from "@/app/api/shifts/[id]/route";
import { DELETE as deleteGroupShift } from "@/app/api/shift-groups/[id]/shifts/[shiftId]/route";

const staffUser = {
  id: "staff-1",
  role: "STAFF" as const,
  email: "staff@example.com",
  name: "Staff One",
  avatarUrl: null,
  forcePasswordChange: false,
};

function deleteRequest(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "DELETE",
    headers: { host: "app.example.com", origin: "https://app.example.com" },
  });
}

describe("retired live shift delete routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
  });

  it("directs standalone shift deletion to the Event working schedule", async () => {
    const res = await deleteShift(
      deleteRequest("/api/shifts/shift-1?force=true"),
      { params: Promise.resolve({ id: "shift-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body.error).toContain("private working schedule editor");
  });

  it("directs group-scoped shift deletion to the Event working schedule", async () => {
    const res = await deleteGroupShift(
      deleteRequest("/api/shift-groups/group-1/shifts/shift-1?force=true"),
      { params: Promise.resolve({ id: "group-1", shiftId: "shift-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body.error).toContain("private working schedule editor");
  });

  it("still checks deletion permission before disclosing the retirement contract", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...staffUser, id: "student-1", role: "STUDENT" });

    const res = await deleteShift(
      deleteRequest("/api/shifts/shift-1"),
      { params: Promise.resolve({ id: "shift-1" }) },
    );

    expect(res.status).toBe(403);
  });
});
