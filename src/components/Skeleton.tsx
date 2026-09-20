"use client";

import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton table: simulates a data table */
export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="w-full">
      <div className="flex gap-4 px-4 py-2.5 border-b">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className="h-3" style={{ width: `${60 + (i % 3) * 10}%`, flex: 1 }} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 px-4 py-3 border-b last:border-0">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className="h-3.5" style={{ width: `${50 + ((r + c) % 4) * 10}%`, flex: 1 }} />
          ))}
        </div>
      ))}
    </div>
  );
}
