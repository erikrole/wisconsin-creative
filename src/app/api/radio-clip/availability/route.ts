import { radioClipAuthEnabled } from "@/lib/radio-clip-feature";
import { withHandler } from "@/lib/api-handler";
import { ok } from "@/lib/http";
// Public rollout discovery only; no account lookup, grants or session mutation.
export const GET = withHandler(async () => ok({
  version: 1,
  available: radioClipAuthEnabled(),
}));
