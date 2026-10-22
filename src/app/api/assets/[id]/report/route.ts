import { CheckinReportType } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { reportAssetProblem } from "@/lib/services/damage-cases";

/**
 * POST /api/assets/[id]/report (multipart: type DAMAGED|LOST, description, optional photo `file`)
 *
 * Report a problem with an item any time, not only at a return. Students, staff and
 * admins can file one; collaborators can't. Opens a case on the Damage and loss page.
 */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  if (user.role === "COLLABORATOR") throw new HttpError(403, "You can't report items.");
  const form = await req.formData();
  const type = form.get("type");
  if (type !== CheckinReportType.DAMAGED && type !== CheckinReportType.LOST) {
    throw new HttpError(400, "Choose damaged or missing.");
  }
  const description = form.get("description");
  const file = form.get("file");
  const report = await reportAssetProblem({
    assetId: params.id,
    type,
    description: typeof description === "string" ? description.slice(0, 2000) : undefined,
    file: file instanceof File && file.size > 0 ? file : null,
    reporter: { id: user.id, role: user.role, name: user.name },
  });
  return ok({ data: { id: report.id, type: report.type } });
});
