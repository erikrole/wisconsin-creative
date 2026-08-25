import { BookingKind, Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requirePermission, requirePermissionOrCollaboratorCapability } from "@/lib/rbac";
import { listBookings } from "@/lib/services/bookings";
import { loadCheckoutPolicies } from "@/lib/services/checkout-policies";
import { sanitizeCollaboratorBooking } from "@/lib/collaborator-gear";

export const GET = withAuth(async (req, { user }) => {
  if (user.role === "COLLABORATOR") {
    requirePermissionOrCollaboratorCapability(user, "checkout", "view", "MY_GEAR_VIEW");
  } else {
    requirePermission(user.role, "checkout", "view");
  }
  const { searchParams } = new URL(req.url);
  const filterParam = searchParams.get("filter");

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  let overdueThreshold = now;
  if (filterParam === "overdue") {
    const policies = await loadCheckoutPolicies();
    // Grace period: items are overdue only after endsAt + grace window has passed
    overdueThreshold = new Date(now.getTime() - policies.gracePeriodHours * 3_600_000);
  }

  const extraWhere: Prisma.BookingWhereInput | undefined =
    filterParam === "overdue"
      ? { status: "OPEN" as never, endsAt: { lt: overdueThreshold } }
      : filterParam === "due-today"
        ? { status: "OPEN" as never, endsAt: { gte: todayStart, lt: todayEnd } }
        : undefined;

  const collaboratorPreview = user.role === "COLLABORATOR" && user.preview?.role === "COLLABORATOR";
  const restrictTo = user.role === "STUDENT" || (user.role === "COLLABORATOR" && !collaboratorPreview)
    ? user.id
    : undefined;
  const result = await listBookings(BookingKind.CHECKOUT, searchParams, extraWhere, restrictTo);
  return ok({
    ...result,
    data: user.role === "COLLABORATOR"
      ? result.data.map(sanitizeCollaboratorBooking)
      : result.data,
  });
});

export const POST = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "checkout", "create");
  throw new HttpError(403, "Create a reservation in app/web. Direct checkout is only available at a kiosk.");
});
