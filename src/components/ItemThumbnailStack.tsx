"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { isOptimizableAssetImageSrc, normalizeAssetImageSrc } from "@/lib/asset-image";

export type ItemThumbnailStackItem = {
  id: string;
  name: string;
  imageUrl?: string | null;
  fallback?: string | null;
};

export function ItemThumbnailStack({
  items,
  totalCount,
  max = 3,
  className,
  surfaceClassName = "border-background bg-muted",
}: {
  items: ItemThumbnailStackItem[];
  totalCount: number;
  max?: number;
  className?: string;
  surfaceClassName?: string;
}) {
  if (totalCount === 0) return null;

  const visibleItems = items.slice(0, max);
  const overflow = totalCount - visibleItems.length;

  return (
    <div
      className={cn("flex items-center -space-x-2", className)}
      aria-label={`${totalCount} gear ${totalCount === 1 ? "item" : "items"}`}
    >
      {visibleItems.map((item) => {
        const fallback = item.fallback ?? item.name[0] ?? "?";
        return (
          <span
            key={item.id}
            className={cn(
              "relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 text-[9px] font-semibold text-muted-foreground",
              surfaceClassName,
            )}
            title={item.name}
            aria-label={item.name}
          >
            <StackImage src={item.imageUrl} fallback={fallback} />
          </span>
        );
      })}
      {overflow > 0 && (
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-semibold text-muted-foreground",
            surfaceClassName,
          )}
          aria-label={`${overflow} more gear ${overflow === 1 ? "item" : "items"}`}
        >
          +{overflow > 99 ? "99" : overflow}
        </span>
      )}
    </div>
  );
}

function StackImage({ src, fallback }: { src?: string | null; fallback: string }) {
  const normalizedSrc = normalizeAssetImageSrc(src);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc !== null && failedSrc === normalizedSrc;

  if (!normalizedSrc || failed) {
    return fallback.toUpperCase();
  }

  return (
    <Image
      src={normalizedSrc}
      alt=""
      fill
      sizes="24px"
      className="object-cover"
      loading="lazy"
      unoptimized={!isOptimizableAssetImageSrc(normalizedSrc)}
      onError={() => setFailedSrc(normalizedSrc)}
    />
  );
}
