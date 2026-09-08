import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { type StudentYear } from "@prisma/client";
import { sportLabel } from "@/lib/sports";
import { csvField } from "@/lib/csv";
import { shouldIncludeHiddenUsers } from "@/lib/user-visibility";

import { buildUserDirectoryQuery } from "@/lib/user-directory-query";

const MAX_EXPORT_ROWS = 5000;
const EXPORT_LIMIT = { max: 5, windowMs: 60_000 };

function canExportSensitiveContact(actorRole: string, targetRole: string): boolean {
  return actorRole === "ADMIN" || targetRole === "STUDENT";
}

// Derive student year from grad year using Sept→Aug academic calendar.
// Mirrors src/app/(app)/users/types.ts deriveStudentYear so list and export agree.
function deriveYear(
  gradYear: number | null,
  override: StudentYear | null,
  now: Date,
): StudentYear | null {
  if (override) return override;
  if (gradYear == null) return null;
  const acadYearEnd = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
  const remaining = gradYear - acadYearEnd;
  if (remaining <= -1) return "GRAD";
  if (remaining === 0) return "SENIOR";
  if (remaining === 1) return "JUNIOR";
  if (remaining === 2) return "SOPHOMORE";
  return "FRESHMAN";
}

export const GET = withAuth(async (req, { user }) => {
  // Full export is staff/admin only — student self-export not in v1.
  requireRole(user.role, ["ADMIN", "STAFF"]);
  const { allowed } = await checkRateLimit(`user:export:${user.id}`, EXPORT_LIMIT);
  if (!allowed) throw new HttpError(429, "Too many requests. Please wait a moment.");

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const roleParam = searchParams.get("role");
  const locationId = searchParams.get("locationId");
  const activeParam = searchParams.get("active");
  const yearParam = searchParams.get("year");
  const { where } = buildUserDirectoryQuery(user, {
    q,
    role: roleParam,
    locationId,
    year: yearParam,
    sport: searchParams.get("sport"),
    area: searchParams.get("area"),
    includeHidden: shouldIncludeHiddenUsers(searchParams, user),
    active: activeParam === "false" ? "inactive" : activeParam === "all" ? "all" : "active",
  });

  const matchedUsers = await db.user.findMany({
    where,
    orderBy: [{ role: "asc" }, { name: "asc" }, { id: "asc" }],
    take: MAX_EXPORT_ROWS + 1,
    include: {
      location: { select: { name: true } },
      sportAssignments: { select: { sportCode: true } },
      areaAssignments: { select: { area: true, isPrimary: true } },
      directReport: { select: { name: true } },
    },
  });

  const truncated = matchedUsers.length > MAX_EXPORT_ROWS;
  const users = matchedUsers.slice(0, MAX_EXPORT_ROWS);
  const now = new Date();
  const header = [
    "name", "role", "campus_email", "athletics_email", "phone",
    "title", "year", "grad_year",
    "primary_area", "areas", "sports", "location",
    "start_date", "direct_report",
    "top_size", "bottom_size", "shoe_size",
    "active", "created_at",
  ].join(",");

  const rows = users.map((u) => {
    // Match the collaborator profile read boundary: Staff see basic identity only.
    if (u.role === "COLLABORATOR" && user.role !== "ADMIN" && user.id !== u.id) {
      return [u.name, u.role, null, null, null, u.title, ...Array(13).fill(null)]
        .map(csvField).join(",");
    }
    const year = u.role === "STUDENT" ? deriveYear(u.gradYear, u.studentYearOverride, now) : null;
    const areas = u.areaAssignments
      .map((a) => `${a.area}${a.isPrimary ? "*" : ""}`)
      .join(" ");
    const sports = u.sportAssignments.map((s) => sportLabel(s.sportCode)).join(" ");
    const includeSensitiveContact = canExportSensitiveContact(user.role, u.role);
    return [
      csvField(u.name),
      csvField(u.role),
      csvField(u.email),
      csvField(includeSensitiveContact ? u.athleticsEmail : null),
      csvField(includeSensitiveContact ? u.phone : null),
      csvField(u.title),
      csvField(year),
      csvField(u.gradYear),
      csvField(u.primaryArea),
      csvField(areas),
      csvField(sports),
      csvField(u.location?.name ?? null),
      csvField(u.startDate ? u.startDate.toISOString().slice(0, 10) : null),
      csvField(u.directReport?.name ?? u.directReportName),
      csvField(u.topSize),
      csvField(u.bottomSize),
      csvField(u.shoeSize),
      csvField(u.active ? "true" : "false"),
      csvField(u.createdAt.toISOString()),
    ].join(",");
  });

  const body = [header, ...rows].join("\n");
  const filename = `users-${now.toISOString().slice(0, 10)}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Exported-Count": String(users.length),
      ...(truncated ? { "X-Truncated": "true" } : {}),
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
