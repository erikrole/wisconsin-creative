import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";

/**
 * Hire invites (an AllowedEmail linked to an application) carry an applicant's email
 * and name, so they stay inside the ADMIN-only hiring boundary (D-065). Staff share the
 * generic allowlist permission, so the staff-facing onboarding APIs must not list, edit,
 * or delete them. Admins keep full visibility.
 */
export function excludeHiringInvites(role: Role): Prisma.AllowedEmailWhereInput | null {
  return role === "ADMIN" ? null : { applications: { none: {} } };
}

/** 404 (not 403, so existence is not revealed) for a non-admin touching a hire invite. */
export async function assertNotHiringInvite(role: Role, allowedEmailId: string): Promise<void> {
  if (role === "ADMIN") return;
  const linked = await db.allowedEmail.findFirst({
    where: { id: allowedEmailId, applications: { some: {} } },
    select: { id: true },
  });
  if (linked) throw new HttpError(404, "Allowed email not found");
}
