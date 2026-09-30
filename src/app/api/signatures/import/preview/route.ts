import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit, SIGNATURE_IMPORT_LIMIT } from "@/lib/rate-limit";
import { createSignatureRosterPreview } from "@/lib/services/signatures";
import { fetchUWBadgersRoster } from "@/lib/signatures/uwbadgers";
import { signatureRosterImportSchema } from "@/lib/signatures/types";

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "signature", "import");
  await enforceRateLimit(`signature-import:${user.id}`, SIGNATURE_IMPORT_LIMIT);
  const body = signatureRosterImportSchema.parse(await req.json());
  const snapshot = await fetchUWBadgersRoster(body.sportCode, body.season);
  const preview = await createSignatureRosterPreview({ actor: user, sportCode: body.sportCode, season: body.season, ...snapshot });
  return ok({
    ...preview,
    sportCode: body.sportCode,
    season: body.season,
    sourceUrl: snapshot.sourceUrl,
    sourceHash: snapshot.sourceHash,
    parserVersion: snapshot.parserVersion,
    entries: snapshot.entries,
  }, 201);
});
