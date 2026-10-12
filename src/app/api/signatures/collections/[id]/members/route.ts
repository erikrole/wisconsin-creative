import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit, SIGNATURE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { addSignatureTeamPlayer } from "@/lib/services/signatures";
import { signatureTeamPlayerCreateSchema } from "@/lib/signatures/types";

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "signature", "roster");
  await enforceRateLimit(`signature-roster-add:${user.id}`, SIGNATURE_MUTATION_LIMIT);
  const body = signatureTeamPlayerCreateSchema.parse(await req.json());
  return ok(await addSignatureTeamPlayer({ actor: user, collectionId: params.id, ...body }));
});
