"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { IconSwap } from "@/components/ui/icon-swap";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";

const COPY_RESET_MS = 1600;

/**
 * One-tap copy for a server path. `label` renders it as a library quick-tool
 * tile (name over the path) instead of the compact inline button.
 */
export function ServerPathCopy({ path, label }: { path: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;

    const timer = window.setTimeout(() => setCopied(false), COPY_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
    } catch {
      setCopied(false);
      toast.error("Could not copy the Media Drive path", {
        description: "Select the visible path and copy it manually.",
      });
    }
  };

  const icon = (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span
        key={copied ? "copied" : "copy"}
        initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
        transition={{ type: "spring", duration: 0.3, bounce: 0 }}
        className="inline-flex items-center justify-center"
      >
        {copied ? (
          <CheckIcon className="size-4" aria-hidden="true" />
        ) : (
          <CopyIcon className="size-4" aria-hidden="true" />
        )}
      </motion.span>
    </AnimatePresence>
  );

  if (label) {
    return (
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy ${label}: ${path}`}
        aria-pressed={copied}
        title={path}
        className="resource-tool group transition-[background-color,scale] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]"
      >
        <span className="min-w-0 flex-1">
          <span className="resource-tool-name">{label}</span>
          <span className="resource-tool-detail resource-tool-path">{path}</span>
        </span>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-sm font-bold",
            copied ? "text-foreground" : "text-[var(--accent)]",
          )}
          aria-live="polite"
        >
          {icon}
          {copied ? "Copied" : "Copy"}
        </span>
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleCopy}
      aria-label={`Copy server path ${path}`}
      aria-pressed={copied}
      className={cn(
        "h-10 min-w-0 max-w-full justify-start gap-2 overflow-hidden px-3 font-mono text-[11px] leading-none transition-[background-color,color,box-shadow,scale] active:scale-[0.96]",
        "sm:max-w-[24rem]",
      )}
      title={path}
    >
      <IconSwap swapKey={copied ? "copied" : "copy"}>
          {copied ? (
            <CheckIcon data-icon="inline-start" aria-hidden="true" />
          ) : (
            <CopyIcon data-icon="inline-start" aria-hidden="true" />
          )}
        </IconSwap>
      <span className="min-w-0 flex-1 truncate text-left">{path}</span>
      <span
        className={cn(
          "shrink-0 text-[10px] font-medium uppercase tracking-normal",
          copied ? "text-foreground" : "text-muted-foreground",
        )}
        aria-live="polite"
      >
        {copied ? "Copied" : "Copy"}
      </span>
    </Button>
  );
}
