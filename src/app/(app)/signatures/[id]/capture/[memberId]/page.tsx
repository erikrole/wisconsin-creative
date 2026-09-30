import { requireAuth } from "@/lib/auth";
import { requirePermission } from "@/lib/rbac";
import SignatureCapturePage from "./SignatureCapturePage";

export default async function SignatureCaptureRoute({ params }: { params: Promise<{ id: string; memberId: string }> }) {
  const user = await requireAuth();
  requirePermission(user.role, "signature", "capture");
  const { id, memberId } = await params;
  return <SignatureCapturePage key={`${user.id}:${id}:${memberId}`} collectionId={id} memberId={memberId} userId={user.id} />;
}
