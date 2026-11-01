import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// ─── Mock modules ───────────────────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    escalationRule: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    systemConfig: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    location: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    department: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  GET as getEscalation,
  PATCH as patchEscalation,
} from "@/app/api/settings/escalation/route";
import {
  GET as getExtendPresets,
  PUT as putExtendPresets,
} from "@/app/api/settings/extend-presets/route";
import {
  GET as getDepartments,
  POST as postDepartment,
} from "@/app/api/departments/route";
import {
  PATCH as patchDepartment,
} from "@/app/api/departments/[id]/route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.systemConfig.findMany).mockResolvedValue([]);
  vi.mocked(db.location.findMany).mockResolvedValue([]);
  vi.mocked(db.user.findMany).mockResolvedValue([]);
});

const adminUser = {
  id: "admin-1",
  email: "admin@test.com",
  name: "Admin",
  role: "ADMIN" as const,
  avatarUrl: null,
};

const staffUser = {
  id: "staff-1",
  email: "staff@test.com",
  name: "Staff",
  role: "STAFF" as const,
  avatarUrl: null,
};

const studentUser = {
  id: "student-1",
  email: "student@test.com",
  name: "Student",
  role: "STUDENT" as const,
  avatarUrl: null,
};

function makeGetRequest(url = "https://app.example.com/api/settings/escalation") {
  return new Request(url, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

function makePatchRequest(body: Record<string, unknown>, url = "https://app.example.com/api/settings/escalation") {
  return new Request(url, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

function makePutRequest(body: Record<string, unknown>, url = "https://app.example.com/api/settings/extend-presets") {
  return new Request(url, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

function makePostRequest(body: Record<string, unknown>, url = "https://app.example.com/api/departments") {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

const noParams = { params: Promise.resolve({}) };

function escalationRuleRows(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.escalationRule.findMany>>;
}

function escalationRuleRow(row: unknown) {
  return row as Awaited<ReturnType<typeof db.escalationRule.findUnique>>;
}

function escalationRuleUpdateRow(row: unknown) {
  return row as Awaited<ReturnType<typeof db.escalationRule.update>>;
}

function systemConfigRow(row: unknown) {
  return row as Awaited<ReturnType<typeof db.systemConfig.findUnique>>;
}

function systemConfigUpsertRow(row: unknown = {}) {
  return row as Awaited<ReturnType<typeof db.systemConfig.upsert>>;
}

function departmentRows(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.department.findMany>>;
}

function departmentRow(row: unknown) {
  return row as Awaited<ReturnType<typeof db.department.findUnique>>;
}

function departmentCreateRow(row: unknown) {
  return row as Awaited<ReturnType<typeof db.department.create>>;
}

function departmentUpdateRow(row: unknown) {
  return row as Awaited<ReturnType<typeof db.department.update>>;
}

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/settings/escalation
// ═════════════════════════════════════════════════════════════════════════════
describe("GET /api/settings/escalation", () => {
  it("returns escalation rules and config for ADMIN", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.escalationRule.findMany).mockResolvedValue(escalationRuleRows([
      { id: "rule-1", name: "Overdue 24h", sortOrder: 1, enabled: true, notifyAdmins: true, notifyRequester: false },
    ]));
    vi.mocked(db.systemConfig.findUnique).mockResolvedValue(systemConfigRow({
      key: "escalation",
      value: {
        maxRequesterNotificationsPerDueDate: 4,
        maxOperationalNotificationsPerDueDate: 10,
      },
    }));

    const res = await getEscalation(makeGetRequest(), noParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rules).toHaveLength(1);
    expect(body.data.config.maxRequesterNotificationsPerDueDate).toBe(4);
    expect(body.data.config.maxOperationalNotificationsPerDueDate).toBe(10);
  });

  it("returns separate default requester and operations caps when no config exists", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.escalationRule.findMany).mockResolvedValue([]);
    vi.mocked(db.systemConfig.findUnique).mockResolvedValue(null);

    const res = await getEscalation(makeGetRequest(), noParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.config).toEqual({
      maxRequesterNotificationsPerDueDate: 5,
      maxOperationalNotificationsPerDueDate: 20,
    });
  });

  it("returns 403 for STAFF", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);

    const res = await getEscalation(makeGetRequest(), noParams);

    expect(res.status).toBe(403);
  });

  it("returns 403 for STUDENT", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await getEscalation(makeGetRequest(), noParams);

    expect(res.status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /api/settings/escalation
// ═════════════════════════════════════════════════════════════════════════════
describe("PATCH /api/settings/escalation", () => {
  it("updates requester and operations caps independently", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.systemConfig.findUnique).mockResolvedValue(null);
    vi.mocked(db.systemConfig.upsert).mockResolvedValue(systemConfigUpsertRow());

    const res = await patchEscalation(
      makePatchRequest({ maxRequesterNotificationsPerDueDate: 4 }),
      noParams
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config).toEqual({
      maxRequesterNotificationsPerDueDate: 4,
      maxOperationalNotificationsPerDueDate: 20,
    });
  });

  it("persists validated location responders", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.location.findFirst).mockResolvedValue({ id: "location-1", name: "Camp Randall" } as never);
    vi.mocked(db.user.count).mockResolvedValue(1);
    vi.mocked(db.systemConfig.findUnique).mockResolvedValue(null);
    vi.mocked(db.systemConfig.upsert).mockResolvedValue(systemConfigUpsertRow());

    const res = await patchEscalation(
      makePatchRequest({ locationId: "location-1", responderUserIds: ["staff-1"] }),
      noParams,
    );

    expect(res.status).toBe(200);
    expect(db.systemConfig.upsert).toHaveBeenCalledWith({
      where: { key: "overdue_responders:location-1" },
      update: { value: { userIds: ["staff-1"] } },
      create: { key: "overdue_responders:location-1", value: { userIds: ["staff-1"] } },
    });
  });

  it("updates an escalation rule", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    const beforeRule = {
      id: "esc_due_1h",
      enabled: true,
      notifyAdmins: false,
      notifyRequester: false,
    };
    vi.mocked(db.escalationRule.findUnique).mockResolvedValue(escalationRuleRow(beforeRule));
    vi.mocked(db.escalationRule.update).mockResolvedValue(escalationRuleUpdateRow({
      ...beforeRule,
      notifyAdmins: true,
    }));

    const res = await patchEscalation(
      makePatchRequest({ ruleId: "esc_due_1h", notifyAdmins: true }),
      noParams
    );

    expect(res.status).toBe(200);
    expect(db.escalationRule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "esc_due_1h" },
        data: { notifyAdmins: true },
      })
    );
  });

  it("returns 404 when updating non-existent rule", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.escalationRule.findUnique).mockResolvedValue(null);

    const res = await patchEscalation(
      makePatchRequest({ ruleId: "cm123456789012345678901234", enabled: false }),
      noParams
    );

    expect(res.status).toBe(404);
  });

  it("returns 403 for STAFF", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);

    const res = await patchEscalation(
      makePatchRequest({ maxRequesterNotificationsPerDueDate: 5 }),
      noParams
    );

    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid body (no fields to update)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);

    const res = await patchEscalation(
      makePatchRequest({ ruleId: "cm123456789012345678901234" }),
      noParams
    );

    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/settings/extend-presets
// ═════════════════════════════════════════════════════════════════════════════
describe("GET /api/settings/extend-presets", () => {
  it("returns stored presets", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);
    vi.mocked(db.systemConfig.findUnique).mockResolvedValue(systemConfigRow({
      key: "extend_presets",
      value: [{ label: "+2 days", minutes: 2880 }],
    }));

    const res = await getExtendPresets(
      makeGetRequest("https://app.example.com/api/settings/extend-presets"),
      noParams
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.presets).toEqual([{ label: "+2 days", minutes: 2880 }]);
  });

  it("returns default presets when none configured", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);
    vi.mocked(db.systemConfig.findUnique).mockResolvedValue(null);

    const res = await getExtendPresets(
      makeGetRequest("https://app.example.com/api/settings/extend-presets"),
      noParams
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.presets).toHaveLength(3);
    expect(body.data.presets[0].label).toBe("+1 day");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PUT /api/settings/extend-presets
// ═════════════════════════════════════════════════════════════════════════════
describe("PUT /api/settings/extend-presets", () => {
  it("updates presets for ADMIN", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.systemConfig.upsert).mockResolvedValue(systemConfigUpsertRow());

    const presets = [
      { label: "+1 day", minutes: 1440 },
      { label: "+1 week", minutes: 10080 },
    ];

    const res = await putExtendPresets(
      makePutRequest({ presets }),
      noParams
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.presets).toEqual(presets);
  });

  it("returns 403 for STAFF", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);

    const res = await putExtendPresets(
      makePutRequest({ presets: [{ label: "+1 day", minutes: 1440 }] }),
      noParams
    );

    expect(res.status).toBe(403);
  });

  it("returns 403 for STUDENT", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await putExtendPresets(
      makePutRequest({ presets: [{ label: "+1 day", minutes: 1440 }] }),
      noParams
    );

    expect(res.status).toBe(403);
  });

  it("allows an empty presets array for custom-only extension", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.systemConfig.upsert).mockResolvedValue(systemConfigUpsertRow());

    const res = await putExtendPresets(
      makePutRequest({ presets: [] }),
      noParams
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.presets).toEqual([]);
  });

  it("returns 400 for invalid minutes (negative)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);

    const res = await putExtendPresets(
      makePutRequest({ presets: [{ label: "Bad", minutes: -1 }] }),
      noParams
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing label", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);

    const res = await putExtendPresets(
      makePutRequest({ presets: [{ label: "", minutes: 100 }] }),
      noParams
    );

    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Departments settings routes
// ═════════════════════════════════════════════════════════════════════════════
describe("Departments settings routes", () => {
  it("returns active departments by default", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.department.findMany).mockResolvedValue(departmentRows([
      { id: "dept-1", name: "Video", active: true, _count: { assets: 2, bulkSkus: 1 } },
    ]));

    const res = await getDepartments(makeGetRequest("https://app.example.com/api/departments"), noParams);

    expect(res.status).toBe(200);
    expect(db.department.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true },
    }));
  });

  it("keeps the department list internal", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...studentUser, role: "COLLABORATOR" } as never);

    const res = await getDepartments(makeGetRequest("https://app.example.com/api/departments"), noParams);

    expect(res.status).toBe(403);
    expect(db.department.findMany).not.toHaveBeenCalled();
  });

  it("includes inactive departments when requested", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.department.findMany).mockResolvedValue([]);

    const res = await getDepartments(makeGetRequest("https://app.example.com/api/departments?includeInactive=1"), noParams);

    expect(res.status).toBe(200);
    expect(db.department.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {},
    }));
  });

  it("creates a department for STAFF", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.department.create).mockResolvedValue(departmentCreateRow({ id: "dept-1", name: "Video" }));

    const res = await postDepartment(makePostRequest({ name: "  Video  " }), noParams);

    expect(res.status).toBe(201);
    expect(db.department.create).toHaveBeenCalledWith({ data: { name: "Video" } });
    expect(db.department.findUnique).not.toHaveBeenCalled();
  });

  it("reactivates an inactive department when create hits the unique constraint", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    const uniqueError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["name"] },
    });
    vi.mocked(db.department.create).mockRejectedValue(uniqueError);
    vi.mocked(db.department.findUnique).mockResolvedValue(departmentRow({
      id: "dept-1",
      name: "Video",
      active: false,
    }));
    vi.mocked(db.department.update).mockResolvedValue(departmentUpdateRow({
      id: "dept-1",
      name: "Video",
      active: true,
    }));

    const res = await postDepartment(makePostRequest({ name: "Video" }), noParams);

    expect(res.status).toBe(200);
    expect(db.department.update).toHaveBeenCalledWith({
      where: { id: "dept-1" },
      data: { active: true },
    });
  });

  it("returns 409 when create hits an active duplicate", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    const uniqueError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["name"] },
    });
    vi.mocked(db.department.create).mockRejectedValue(uniqueError);
    vi.mocked(db.department.findUnique).mockResolvedValue(departmentRow({
      id: "dept-1",
      name: "Video",
      active: true,
    }));

    const res = await postDepartment(makePostRequest({ name: "Video" }), noParams);

    expect(res.status).toBe(409);
    expect(db.department.update).not.toHaveBeenCalled();
  });

  it("blocks STUDENT department creation", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await postDepartment(makePostRequest({ name: "Video" }), noParams);

    expect(res.status).toBe(403);
  });

  it("renames and deactivates a department for STAFF", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(db.department.findUnique).mockResolvedValue(departmentRow({
      id: "dept-1",
      name: "Video",
      active: true,
    }));
    vi.mocked(db.department.update).mockResolvedValue(departmentUpdateRow({
      id: "dept-1",
      name: "Production",
      active: false,
      _count: { assets: 2, bulkSkus: 0 },
    }));

    const res = await patchDepartment(
      makePatchRequest({ name: "Production", active: false }, "https://app.example.com/api/departments/dept-1"),
      { params: Promise.resolve({ id: "dept-1" }) }
    );

    expect(res.status).toBe(200);
    expect(db.department.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "dept-1" },
      data: { name: "Production", active: false },
    }));
  });
});
