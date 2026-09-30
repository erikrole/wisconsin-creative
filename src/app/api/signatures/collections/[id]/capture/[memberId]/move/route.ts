import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit, SIGNATURE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { moveSignatureCapture } from "@/lib/services/signatures";
import { signatureCaptureMoveSchema } from "@/lib/signatures/types";

export const POST = withAuth<{ id: string; memberId: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "signature", "reassign");
  await enforceRateLimit(`signature-capture-move:${user.id}`, SIGNATURE_MUTATION_LIMIT);
  const body = signatureCaptureMoveSchema.parse(await req.json());
  return ok(await moveSignatureCapture({ actor: user, collectionId: params.id, memberId: params.memberId, ...body }));
});
