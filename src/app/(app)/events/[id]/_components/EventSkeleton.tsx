"use client";

import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Loading skeleton matching the event detail page layout */
export function EventSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Card elevation="flat" className="border-border/50 shadow-xs px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <Skeleton className="h-8 w-72" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-10 w-40" />
              <Skeleton className="h-10 w-48" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-10 w-20" />
          </div>
        </div>
      </Card>

      <Card elevation="flat" className="border-border/50 shadow-xs">
        <CardHeader className="flex-row items-center justify-between">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    </div>
  );
}
