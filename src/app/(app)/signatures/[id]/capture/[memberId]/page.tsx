import { redirect } from "next/navigation";

// Web capture is retired (2026-10-07): signatures are captured in the native
// Wisconsin app on iPad. Old capture links land on the roster instead.
export default async function SignatureCaptureRoute({ params }: { params: Promise<{ id: string; memberId: string }> }) {
  const { id } = await params;
  redirect(`/signatures/${id}`);
}
