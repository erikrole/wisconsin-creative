import { withHandler } from "@/lib/api-handler";
import { ok } from "@/lib/http";
import { requireRadioClipSession, revokeRadioClipSession } from "@/lib/services/radio-clip-auth";
// These routes use a Radio Clip bearer session, never a Wisconsin Creative cookie.
export const GET = withHandler(async req => {
  const { session, user } = await requireRadioClipSession(req);
  return ok({ version: 1, expiresAt: session.expiresAt.toISOString(), user });
});
export const DELETE = withHandler(async req => { await revokeRadioClipSession(req); return ok({ signedOut: true }); });
