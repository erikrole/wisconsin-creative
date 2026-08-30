import { z } from "zod";
import { withAuth } from "@/lib/api";
import { verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { deactivateUserWithCleanup } from "@/lib/services/user-deactivation";

const schema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  confirmation: z.literal("DELETE"),
});

/** DELETE /api/me/account - erase direct account data and revoke access. */
export const DELETE = withAuth(async (req, { user }) => {
  await enforceRateLimit(`account-delete:${user.id}`, { max: 5, windowMs: 60_000 });

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new HttpError(400, error.errors[0]?.message ?? "Invalid request.");
    }
    throw error;
  }

  const record = await db.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true, active: true },
  });
  if (!record?.active || !record.passwordHash) {
    throw new HttpError(400, "This account cannot be deleted from the app.");
  }

  if (!(await verifyPassword(record.passwordHash, body.currentPassword))) {
    throw new HttpError(400, "Current password is incorrect.");
  }

  await deactivateUserWithCleanup({
    targetUserId: user.id,
    actorId: user.id,
    actorRole: user.role,
    erasePersonalData: true,
    audit: {
      action: "account_self_deleted",
      before: { active: true },
      after: {
        active: false,
        personalData: "erased",
        authentication: "revoked",
        retainedRecords: ["historical custody", "audit attribution"],
      },
    },
  });

  return ok({ success: true });
});
