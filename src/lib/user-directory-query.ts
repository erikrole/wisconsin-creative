import { Prisma, Role, ShiftArea, StudentYear } from "@prisma/client";
import type { AuthUser } from "@/lib/auth";
import { visibleUserWhere } from "@/lib/user-visibility";
import { optionalSportCodeSchema } from "@/lib/validation";

export type UserDirectoryActiveFilter = "active" | "inactive" | "all";

export type UserDirectoryFilters = {
  q?: string | null;
  role?: string | null;
  locationId?: string | null;
  year?: string | null;
  sport?: string | null;
  area?: string | null;
  /** The caller must already have checked permission to include hidden users. */
  includeHidden?: boolean;
  active?: UserDirectoryActiveFilter;
};

const DIRECTORY_ROLES: Set<string> = new Set(Object.values(Role));
const DIRECTORY_YEARS: Set<string> = new Set(Object.values(StudentYear));
const DIRECTORY_AREAS: Set<string> = new Set(Object.values(ShiftArea));

/**
 * Build the same roster predicates used by `/api/users` for other directory
 * actions. Keeping this in one place prevents a bulk operation from silently
 * targeting a different group than the admin can see.
 */
export function buildUserDirectoryQuery(
  actor: Pick<AuthUser, "email" | "role">,
  filters: UserDirectoryFilters = {},
) {
  const isCollaboratorDirectory = actor.role === Role.COLLABORATOR;
  const conditions: Prisma.UserWhereInput[] = isCollaboratorDirectory
    ? [{ active: true, hiddenFromRoster: false }]
    : [visibleUserWhere(actor, { includeHidden: filters.includeHidden === true })];

  const q = filters.q?.trim();
  if (q) {
    conditions.push({
      OR: isCollaboratorDirectory
        ? [{ name: { contains: q, mode: "insensitive" as const } }]
        : [
            { name: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
          ],
    });
  }

  if (filters.role && DIRECTORY_ROLES.has(filters.role)) {
    conditions.push({ role: filters.role as Role });
  }

  if (!isCollaboratorDirectory && filters.locationId?.trim()) {
    conditions.push({ locationId: filters.locationId.trim() });
  }

  const sport = optionalSportCodeSchema.parse(filters.sport ?? undefined);
  if (!isCollaboratorDirectory && sport) {
    conditions.push({ sportAssignments: { some: { sportCode: sport } } });
  }

  if (!isCollaboratorDirectory && filters.area && DIRECTORY_AREAS.has(filters.area)) {
    conditions.push({
      OR: [
        { primaryArea: filters.area as ShiftArea },
        { areaAssignments: { some: { area: filters.area as ShiftArea } } },
      ],
    });
  }

  // Year derives an expected graduation year from the Sept→Aug academic
  // calendar, while an explicit override always wins.
  if (!isCollaboratorDirectory && filters.year && DIRECTORY_YEARS.has(filters.year)) {
    const now = new Date();
    const acadYearEnd = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
    const yearGradMap: Record<string, Prisma.UserWhereInput> = {
      SENIOR: { gradYear: acadYearEnd },
      JUNIOR: { gradYear: acadYearEnd + 1 },
      SOPHOMORE: { gradYear: acadYearEnd + 2 },
      FRESHMAN: { gradYear: { gte: acadYearEnd + 3 } },
      GRAD: { gradYear: { lte: acadYearEnd - 1 } },
    };
    const derivedMatch = yearGradMap[filters.year]!;
    conditions.push({
      OR: [
        { studentYearOverride: filters.year as StudentYear },
        { AND: [{ studentYearOverride: null }, derivedMatch] },
      ],
    });
  }

  const summaryWhere: Prisma.UserWhereInput = { AND: [...conditions] };
  const active = filters.active ?? "active";

  if (!isCollaboratorDirectory) {
    if (active === "inactive") conditions.push({ active: false });
    else if (active !== "all") conditions.push({ active: true });
  }

  return {
    isCollaboratorDirectory,
    summaryWhere,
    where: conditions.length > 0 ? { AND: conditions } : {},
  };
}
