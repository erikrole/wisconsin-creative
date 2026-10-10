import { Skeleton } from "@/components/ui/skeleton";

export default function WorkforceLoading() {
  return <div role="status" aria-label="Loading workforce" className="grid gap-5"><Skeleton className="h-16 w-full" /><Skeleton className="h-40 w-full" /><div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-80 w-full" /><Skeleton className="h-80 w-full" /></div></div>;
}
