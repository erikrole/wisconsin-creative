import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { getWrappedRecap } from "@/lib/services/wrapped";
import { renderWrappedShareImage } from "@/lib/wrapped/share-image";

/**
 * The summary card image. It only ever renders the viewer's own recap; admins
 * may preview someone else's.
 */
export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "wrapped", "view");
  const requested = new URL(req.url).searchParams.get("userId");
  const targetId = requested && requested !== user.id ? requested : user.id;
  const other = targetId !== user.id;
  if (other) requirePermission(user.role, "wrapped", "preview");
  const preview = user.role === "ADMIN";

  const data = await getWrappedRecap(targetId, { preview, readOnly: other });
  if (!data || data.status !== "ready") throw new HttpError(404, "Wrapped isn't open yet");
  const summary = data.recap.cards.find((card) => card.layout === "summary");
  if (!summary) throw new HttpError(404, "No summary card for this person");
  const { person } = data.recap;

  const image = await renderWrappedShareImage(person, summary);
  return new NextResponse(image.body, {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
  });
});
