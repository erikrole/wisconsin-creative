"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** An icon that pops in when `swapKey` changes (sort direction, copied, followed). Quiet on first render. */
export function IconSwap({
  swapKey,
  className,
  children,
}: {
  swapKey: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [seenKey, setSeenKey] = useState(swapKey);
  const [changed, setChanged] = useState(false);
  if (seenKey !== swapKey) {
    setSeenKey(swapKey);
    setChanged(true);
  }
  return (
    <span key={swapKey} className={cn("inline-flex items-center justify-center", changed && "wc-icon-swap", className)}>
      {children}
    </span>
  );
}
