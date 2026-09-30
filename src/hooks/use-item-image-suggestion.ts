"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftItemImage } from "@/lib/item-image-draft";
import { fetchFirstBhProductImage, type ItemImageSuggestionStatus } from "@/lib/item-image-suggestion";

export function useItemImageSuggestion({ query, enabled, image, scope, onImageChange }: {
  query: string;
  enabled: boolean;
  image: DraftItemImage | null;
  scope: number;
  onImageChange: (image: DraftItemImage | null) => void;
}) {
  const [status, setStatus] = useState<ItemImageSuggestionStatus>("idle");
  const automatic = useRef<{ query: string; image: DraftItemImage } | null>(null);
  const suppressed = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const current = useRef({ query, scope, image });
  current.current = { query, scope, image };

  const suppress = useCallback(() => {
    suppressed.current = true;
    controllerRef.current?.abort();
    automatic.current = null;
    setStatus("idle");
  }, []);

  useEffect(() => {
    suppressed.current = false;
    automatic.current = null;
    setStatus("idle");
  }, [scope]);

  useEffect(() => {
    if (!enabled || suppressed.current || (image && image !== automatic.current?.image)) {
      setStatus("idle");
      return;
    }
    const normalized = query.replace(/\s+/g, " ").trim();
    if (automatic.current?.image === image && automatic.current.query === query) { setStatus("ready"); return; }
    if (automatic.current) {
      automatic.current = null;
      onImageChange(null);
    }
    if (normalized.length < 3) { setStatus("idle"); return; }
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("loading");
    const timer = setTimeout(() => {
      void fetchFirstBhProductImage(normalized, controller.signal).then((outcome) => {
        if (controller.signal.aborted || suppressed.current || current.current.query !== query || current.current.scope !== scope) return;
        if (outcome.image) {
          automatic.current = { query, image: outcome.image };
          onImageChange(outcome.image);
        }
        setStatus(outcome.status);
      }).catch(() => {
        if (!controller.signal.aborted) setStatus("unavailable");
      });
    }, 1000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [enabled, image, onImageChange, query, scope]);

  return { status, suppress };
}
