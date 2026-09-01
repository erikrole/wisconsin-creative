import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit, SIGNATURE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { getSignatureMemberCaptureBootstrap, removeSignatureMemberFromRoster } from "@/lib/services/signatures";
import { signatureCollectionVersionSchema } from "@/lib/signatures/types";

export const GET = withAuth<{ id: string; memberId: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "signature", "capture");
  return ok(await getSignatureMemberCaptureBootstrap(params.id, params.memberId));
});

export const DELETE = withAuth<{ id: string; memberId: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "signature", "remove");
  await enforceRateLimit(`signature-roster-remove:${user.id}`, SIGNATURE_MUTATION_LIMIT);
  const body = signatureCollectionVersionSchema.parse(await req.json());
  return ok(await removeSignatureMemberFromRoster({ actor: user, collectionId: params.id, memberId: params.memberId, ...body }));
});
