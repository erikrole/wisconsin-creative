"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const COPY_RESET_MS = 1600;

export function ServerPathCopy({ path }: { path: string }) {
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
            <CheckIcon data-icon="inline-start" aria-hidden="true" />
          ) : (
            <CopyIcon data-icon="inline-start" aria-hidden="true" />
          )}
        </motion.span>
      </AnimatePresence>
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
