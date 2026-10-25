"use client";

import { useState } from "react";
import Image from "next/image";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { isOptimizableAssetImageSrc, normalizeAssetImageSrc } from "@/lib/asset-image";

type AssetImageProps = {
  src: string | null | undefined;
  alt: string;
  size?: number;
  className?: string;
  fallbackClassName?: string;
};

export function AssetImage({
  src,
  alt,
  size = 36,
  className,
  fallbackClassName,
}: AssetImageProps) {
  const normalizedSrc = normalizeAssetImageSrc(src);
  // A new source gets a fresh attempt; only the src that failed stays hidden.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc !== null && failedSrc === normalizedSrc;

  if (!normalizedSrc || failed) {
    return (
      <div
        className={cn(
          "rounded-md bg-muted flex items-center justify-center shrink-0",
          fallbackClassName,
          className
        )}
        style={{ width: size, height: size }}
        role="img"
        aria-label={alt || "Item image placeholder"}
      >
        <Package className="size-4 text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md shrink-0 overflow-hidden outline outline-1 outline-black/10 dark:outline-white/10",
        className
      )}
      style={{ width: size, height: size }}
    >
      <Image
        src={normalizedSrc}
        alt={alt}
        width={size * 2}
        height={size * 2}
        className="size-full object-cover"
        unoptimized={!isOptimizableAssetImageSrc(normalizedSrc)}
        onError={() => setFailedSrc(normalizedSrc)}
      />
    </div>
  );
}
