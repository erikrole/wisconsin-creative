import { AccountabilityExclusionReason } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { excludeBookingFromAccountability } from "@/lib/services/accountability";

const schema = z
  .object({
    bookingId: z.string().min(1),
    reason: z.nativeEnum(AccountabilityExclusionReason),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.reason === AccountabilityExclusionReason.OTHER && !value.note) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "An explanation is required for Other",
      });
    }
  });

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "accountability", "manage_exclusions");
  await enforceRateLimit(`accountability:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = schema.parse(await req.json());
  const exclusion = await excludeBookingFromAccountability({
    ...body,
    actorId: user.id,
    actorRole: user.role,
  });
  return ok({ data: exclusion }, 201);
});
