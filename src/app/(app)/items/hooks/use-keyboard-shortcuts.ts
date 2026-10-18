"use client";

import { useEffect, type RefObject } from "react";
import { itemsShortcut, shortcutContext } from "@/lib/a11y-resilience";

type ShortcutActions = {
  searchInputRef: RefObject<HTMLInputElement | null>;
  onClearSearch: () => void;
  onClearSelection: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  hasSelection: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export function useKeyboardShortcuts({
  searchInputRef,
  onClearSearch,
  onClearSelection,
  onPreviousPage,
  onNextPage,
  hasSelection,
  canGoBack,
  canGoForward,
}: ShortcutActions) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const action = itemsShortcut({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        context: shortcutContext(e.target),
        searchFocused: document.activeElement === searchInputRef.current,
        hasSelection,
        canGoBack,
        canGoForward,
      });
      if (!action) return;
      if (action.type === "focus-search") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (action.type === "clear-search") {
        onClearSearch();
        searchInputRef.current?.blur();
        return;
      }
      if (action.type === "clear-selection") {
        onClearSelection();
        return;
      }
      e.preventDefault();
      if (action.type === "previous-page") onPreviousPage();
      else onNextPage();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [searchInputRef, onClearSearch, onClearSelection, onPreviousPage, onNextPage, hasSelection, canGoBack, canGoForward]);
}
