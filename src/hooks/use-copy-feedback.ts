"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "@/lib/clipboard";

export type CopyFeedbackResult = "copied" | "failed" | "superseded";

/**
 * Owns short-lived copied feedback for one control or a keyed group of controls.
 * Only the latest copy attempt may update the feedback, and every new success
 * receives the full display window.
 */
export function useCopyFeedback(resetAfterMs = 1600) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const latestAttemptRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current === null) return;
    window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      latestAttemptRef.current += 1;
      clearResetTimer();
    };
  }, [clearResetTimer]);

  const reset = useCallback(() => {
    latestAttemptRef.current += 1;
    clearResetTimer();
    setCopiedKey(null);
  }, [clearResetTimer]);

  const copy = useCallback(
    async (text: string, key = "default"): Promise<CopyFeedbackResult> => {
      const attempt = latestAttemptRef.current + 1;
      latestAttemptRef.current = attempt;
      clearResetTimer();

      const copied = await copyTextToClipboard(text);
      if (attempt !== latestAttemptRef.current) return "superseded";
      if (!copied) {
        setCopiedKey(null);
        return "failed";
      }

      setCopiedKey(key);
      resetTimerRef.current = window.setTimeout(() => {
        if (attempt === latestAttemptRef.current) setCopiedKey(null);
        resetTimerRef.current = null;
      }, resetAfterMs);
      return "copied";
    },
    [clearResetTimer, resetAfterMs],
  );

  return { copiedKey, copy, reset };
}
