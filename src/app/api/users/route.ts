import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok, parsePagination } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { shouldIncludeHiddenUsers } from "@/lib/user-visibility";
import { requireCollaboratorCapability } from "@/lib/collaborator-access";
import { Prisma } from "@prisma/client";
import { buildUserDirectoryQuery } from "@/lib/user-directory-query";

export const GET = withAuth(async (req, { user }) => {
  requireRole(user.role, ["ADMIN", "STAFF", "STUDENT", "COLLABORATOR"]);
  const isCollaboratorDirectory = user.role === "COLLABORATOR";
  if (isCollaboratorDirectory) {
    requireCollaboratorCapability(user, "PEOPLE_DIRECTORY_VIEW");
  }

  const { searchParams } = new URL(req.url);
  const { limit, offset } = parsePagination(searchParams);

  const q = searchParams.get("q")?.trim();
  const roleParam = searchParams.get("role");
  const locationId = searchParams.get("locationId");
  const activeParam = searchParams.get("active");
  const sort = searchParams.get("sort") || "name";
  const includeHidden = isCollaboratorDirectory ? false : shouldIncludeHiddenUsers(searchParams, user);
  const directoryQuery = buildUserDirectoryQuery(user, {
    q,
    role: roleParam,
    locationId,
    year: searchParams.get("year"),
    sport: searchParams.get("sport"),
    area: searchParams.get("area"),
    includeHidden,
    active: activeParam === "false" ? "inactive" : activeParam === "all" ? "all" : "active",
  });
  const { summaryWhere, where } = directoryQuery;

  // Build orderBy
  const orderBy: Prisma.UserOrderByWithRelationInput[] = (() => {
    switch (isCollaboratorDirectory && !["name", "name_desc", "role", "role_desc"].includes(sort) ? "name" : sort) {
      case "name_desc":
        return [{ name: "desc" as const }];
      case "role":
        return [{ role: "asc" as const }, { name: "asc" as const }];
      case "role_desc":
        return [{ role: "desc" as const }, { name: "asc" as const }];
      case "email":
        return [{ email: "asc" as const }];
      case "email_desc":
        return [{ email: "desc" as const }];
      case "created":
        return [{ createdAt: "asc" as const }, { name: "asc" as const }];
      case "created_desc":
        return [{ createdAt: "desc" as const }, { name: "asc" as const }];
      case "lastActive":
        return [
          { lastActiveAt: { sort: "asc" as const, nulls: "last" as const } },
          { name: "asc" as const },
        ];
      case "lastActive_desc":
        return [
          { lastActiveAt: { sort: "desc" as const, nulls: "last" as const } },
          { name: "asc" as const },
        ];
      default:
        return [{ name: "asc" as const }];
    }
  })();

  const [data, total, active, inactive, missingPhotos, roleGroups] = await Promise.all([
    db.user.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
      include: {
        location: { select: { id: true, name: true } },
        collaboratorPolicy: {
          select: {
            id: true,
            status: true,
            version: true,
            affiliation: { select: { key: true, displayName: true, badgeLabel: true } },
            grants: { select: { capabilityKey: true } },
          },
        },
        sportAssignments: {
          select: {
            sportCode: true,
            defaultTraveler: true,
          },
        },
      },
    }),
    db.user.count({ where }),
    db.user.count({ where: { AND: [summaryWhere, { active: true }] } }),
    db.user.count({ where: { AND: [summaryWhere, { active: false }] } }),
    db.user.count({ where: { AND: [summaryWhere, { active: true }, { avatarUrl: null }] } }),
    db.user.groupBy({
      by: ["role"],
      where: { AND: [summaryWhere, { active: true }] },
      _count: { _all: true },
    }),
  ]);

  const byRole = {
    ADMIN: 0,
    STAFF: 0,
    STUDENT: 0,
    COLLABORATOR: 0,
  };
  for (const group of roleGroups) {
    byRole[group.role] = group._count._all;
  }

  return ok({
    data: data.map((u) => {
      if (isCollaboratorDirectory) {
        return {
          id: u.id,
          name: u.name,
          email: "",
          role: u.role,
          affiliation: u.affiliation,
          collaboratorProfile: u.collaboratorProfile,
          collaboratorPolicy: u.collaboratorPolicy ? {
            id: u.collaboratorPolicy.id,
            status: u.collaboratorPolicy.status,
            version: u.collaboratorPolicy.version,
            affiliation: u.collaboratorPolicy.affiliation,
          } : null,
          staffingType: u.staffingType,
          phone: null,
          slackHandle: null,
          slackProfileUrl: null,
          primaryArea: u.primaryArea,
          locationId: u.locationId,
          location: u.location?.name ?? null,
          avatarUrl: u.avatarUrl ?? null,
          active: true,
          hiddenFromRoster: false,
          sportAssignments: [],
          title: u.title ?? null,
          gradYear: u.gradYear ?? null,
          studentYearOverride: u.studentYearOverride ?? null,
          lastActiveAt: null,
        };
      }
      const collaboratorBasicOnly = u.role === "COLLABORATOR" && user.role !== "ADMIN" && user.id !== u.id;
      return {
      id: u.id,
      name: u.name,
      email: collaboratorBasicOnly ? "" : u.email,
      role: u.role,
      affiliation: u.affiliation,
      collaboratorProfile: u.collaboratorProfile,
      collaboratorPolicy: u.collaboratorPolicy ? {
        id: u.collaboratorPolicy.id,
        status: u.collaboratorPolicy.status,
        version: u.collaboratorPolicy.version,
        capabilities: u.collaboratorPolicy.grants.map((grant) => grant.capabilityKey),
        affiliation: u.collaboratorPolicy.affiliation,
      } : null,
      staffingType: u.staffingType,
      phone: collaboratorBasicOnly ? null : u.phone,
      slackHandle: collaboratorBasicOnly ? null : u.slackHandle ?? null,
      slackProfileUrl: collaboratorBasicOnly ? null : u.slackProfileUrl ?? null,
      primaryArea: collaboratorBasicOnly ? null : u.primaryArea,
      locationId: collaboratorBasicOnly ? null : u.locationId,
      location: collaboratorBasicOnly ? null : u.location?.name ?? null,
      avatarUrl: u.avatarUrl ?? null,
      active: u.active,
      hiddenFromRoster: u.hiddenFromRoster,
      sportAssignments: collaboratorBasicOnly ? [] : u.sportAssignments.map((assignment) => ({
        sportCode: assignment.sportCode,
        defaultTraveler: assignment.defaultTraveler,
      })),
      title: u.title ?? null,
      gradYear: collaboratorBasicOnly ? null : u.gradYear ?? null,
      studentYearOverride: collaboratorBasicOnly ? null : u.studentYearOverride ?? null,
      lastActiveAt: collaboratorBasicOnly ? null : u.lastActiveAt?.toISOString() ?? null,
    };
    }),
    total,
    limit,
    offset,
    stats: {
      total,
      active,
      inactive,
      missingPhotos,
      byRole,
    },
  });
});

export const POST = withAuth(async (req, { user }) => {
  requireRole(user.role, ["ADMIN", "STAFF"]);
  throw new HttpError(
    410,
    "Temporary-password onboarding has been retired. Add the email to the allowlist so the user can register and set their own password."
  );
});
