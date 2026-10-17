import { PageSkeleton } from "@/components/PageSkeleton";

export default function Loading() {
  return <PageSkeleton title="Reports" metrics={2} rows={6} />;
}
