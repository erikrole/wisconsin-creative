import { describe, it, expect } from "vitest";
import { Role } from "@prisma/client";
import { requireRole, requirePermission } from "@/lib/rbac";
import { getAllowedRoles, PERMISSIONS } from "@/lib/permissions";
import { HttpError } from "@/lib/http";

// Pure function tests — no mocking needed

describe("requireRole", () => {
  it("passes when user role is in allowed list", () => {
    expect(() => requireRole(Role.ADMIN, [Role.ADMIN, Role.STAFF])).not.toThrow();
  });

  it("passes for STUDENT role when allowed", () => {
    expect(() => requireRole(Role.STUDENT, [Role.ADMIN, Role.STAFF, Role.STUDENT])).not.toThrow();
  });

  it("throws 403 when user role is not in allowed list", () => {
    expect(() => requireRole(Role.STUDENT, [Role.ADMIN, Role.STAFF])).toThrow("Forbidden");
  });

  it("throws HttpError with status 403", () => {
    try {
      requireRole(Role.STUDENT, [Role.ADMIN]);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(HttpError);
      if (!(err instanceof HttpError)) throw err;
      expect(err.status).toBe(403);
    }
  });
});

describe("requirePermission", () => {
  it("passes for ADMIN on asset.delete", () => {
    expect(() => requirePermission(Role.ADMIN, "asset", "delete")).not.toThrow();
  });

  it("throws 403 for STUDENT on asset.delete", () => {
    expect(() => requirePermission(Role.STUDENT, "asset", "delete")).toThrow("Forbidden");
  });

  it("throws 403 for STAFF on asset.delete", () => {
    expect(() => requirePermission(Role.STAFF, "asset", "delete")).toThrow("Forbidden");
  });

  it("passes for STUDENT on booking.create", () => {
    expect(() => requirePermission(Role.STUDENT, "booking", "create")).not.toThrow();
  });

  it("passes for STAFF on shift.manage", () => {
    expect(() => requirePermission(Role.STAFF, "shift", "manage")).not.toThrow();
  });

  it("throws 403 for STUDENT on shift.manage", () => {
    expect(() => requirePermission(Role.STUDENT, "shift", "manage")).toThrow("Forbidden");
  });

  it("passes for STUDENT on asset.favorite", () => {
    expect(() => requirePermission(Role.STUDENT, "asset", "favorite")).not.toThrow();
  });

  it("shares accountability.view with internal roles but keeps cleanup admin-only", () => {
    for (const role of [Role.ADMIN, Role.STAFF, Role.STUDENT]) {
      expect(() => requirePermission(role, "accountability", "view")).not.toThrow();
    }
    expect(() => requirePermission(Role.COLLABORATOR, "accountability", "view")).toThrow(
      "Forbidden",
    );
    expect(() =>
      requirePermission(Role.STUDENT, "accountability", "manage_exclusions"),
    ).toThrow("Forbidden");
    expect(() =>
      requirePermission(Role.ADMIN, "accountability", "manage_exclusions"),
    ).not.toThrow();
  });

  it("shares scoreboard.view with every authenticated role", () => {
    for (const role of [Role.ADMIN, Role.STAFF, Role.STUDENT, Role.COLLABORATOR]) {
      expect(() => requirePermission(role, "scoreboard", "view")).not.toThrow();
    }
  });
});

describe("getAllowedRoles", () => {
  it("returns role list for known resource+action", () => {
    const roles = getAllowedRoles("asset", "view");
    expect(roles).toEqual(["ADMIN", "STAFF", "STUDENT"]);
  });

  it("throws Error for unknown resource", () => {
    expect(() => getAllowedRoles("nonexistent", "view")).toThrow("No permission defined");
  });

  it("throws Error for unknown action", () => {
    expect(() => getAllowedRoles("asset", "nonexistent")).toThrow("No permission defined");
  });
});

describe("PERMISSIONS map completeness", () => {
  const expectedResources = [
    "role_preview", "user", "asset", "category", "booking", "checkout",
    "bulk_sku", "calendar_source", "location", "location_mapping",
    "report", "notification", "diagnostics", "shift", "shift_assignment",
    "sport_config", "student_sport", "student_area", "shift_trade",
    "allowed_email", "kit", "kiosk_device", "resource", "license", "scoreboard",
  ];

  it("has all expected resources", () => {
    for (const resource of expectedResources) {
      expect(PERMISSIONS[resource]).toBeDefined();
    }
  });

  it("every permission has at least one allowed role", () => {
    for (const actions of Object.values(PERMISSIONS)) {
      for (const roles of Object.values(actions)) {
        expect(roles.length).toBeGreaterThan(0);
      }
    }
  });

  it("ADMIN has access to diagnostics.view", () => {
    expect(PERMISSIONS["diagnostics"]!.view).toContain("ADMIN");
    expect(PERMISSIONS["diagnostics"]!.view).not.toContain("STAFF");
    expect(PERMISSIONS["diagnostics"]!.view).not.toContain("STUDENT");
  });
});
