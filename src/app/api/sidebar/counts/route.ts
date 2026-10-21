import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { getAllowedRoles } from "@/lib/permissions";

/**
 * Small "needs attention" counts for the web sidebar. Each count is only read for roles that can
 * act on it, so the sidebar never shows a number that leads to a page the viewer can't fix.
 */
export const GET = withAuth(async (_req, { user }) => {
  const canDecideWishes = getAllowedRoles("wish", "manage").includes(user.role);
  const canManageLicenses = getAllowedRoles("license", "manage").includes(user.role);

  const [openWishes, reportedLicenses] = await Promise.all([
    canDecideWishes ? db.wishItem.count({ where: { status: "OPEN" } }) : 0,
    // Reported codes are retired, not removed; they leave this count when staff delete them.
    canManageLicenses ? db.licenseCode.count({ where: { reportedBrokenAt: { not: null } } }) : 0,
  ]);

  return ok({ data: { openWishes, reportedLicenses } });
});
