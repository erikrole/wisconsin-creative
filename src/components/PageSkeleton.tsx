import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";

/**
 * Generic page skeleton for loading.tsx files.
 * Shows PageHeader + metric cards + table card.
 */
export function PageSkeleton({
  title,
  rows = 6,
  metrics = 0,
}: {
  title: string;
  rows?: number;
  metrics?: number;
}) {
  return (
    <>
      <PageHeader title={title} />
      {metrics > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 mb-4">
          {Array.from({ length: metrics }, (_, i) => (
            <Card key={i} className="p-4 text-center">
              <Skeleton className="h-7 w-10 mx-auto mb-1" />
              <Skeleton className="h-3 w-16 mx-auto" />
            </Card>
          ))}
        </div>
      )}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 flex-1" style={{ maxWidth: `${60 + (i % 3) * 12}%` }} />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
