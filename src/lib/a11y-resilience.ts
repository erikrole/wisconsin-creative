/**
 * Shared decisions for keyboard, focus, status, and failed-list recovery on
 * the high-traffic web screens. UI calls these so a regression is a function
 * result, not a silent change in a click handler.
 */

export function rowKeyActivates(event: {
  key: string;
  target: unknown;
  currentTarget: unknown;
}): boolean {
  if (event.key !== "Enter" && event.key !== " ") return false;
  return event.target === event.currentTarget;
}

export type ShortcutContext = "field" | "overlay" | "widget" | "page";

export function shortcutContext(target: EventTarget | null): ShortcutContext {
  if (typeof Element === "undefined" || !(target instanceof Element)) return "page";
  if (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
  ) {
    return "field";
  }
  if (target.closest("[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-radix-popper-content-wrapper]")) {
    return "overlay";
  }
  if (target.closest("[role='radiogroup'], [role='tablist']")) return "widget";
  return "page";
}

export type ItemsShortcut =
  | { type: "focus-search" }
  | { type: "clear-search" }
  | { type: "clear-selection" }
  | { type: "previous-page" }
  | { type: "next-page" };

export function itemsShortcut(input: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  context: ShortcutContext;
  searchFocused: boolean;
  hasSelection: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}): ItemsShortcut | null {
  if (input.context === "overlay") return null;
  if (input.key === "/" && input.context === "page" && !input.metaKey && !input.ctrlKey) {
    return { type: "focus-search" };
  }
  if (input.key === "Escape") {
    if (input.searchFocused) return { type: "clear-search" };
    if (input.hasSelection && input.context === "page") return { type: "clear-selection" };
    return null;
  }
  if (input.context !== "page") return null;
  if (input.key === "ArrowLeft" && input.canGoBack) return { type: "previous-page" };
  if (input.key === "ArrowRight" && input.canGoForward) return { type: "next-page" };
  return null;
}

export function scheduleEventActionName(verb: string, title: string, venueLabel: string): string {
  return `${verb} ${title}, ${venueLabel}`;
}

export function publishedEventsFromPayload(payload: unknown): { ok: true; events: unknown[] } | { ok: false } {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { data?: unknown }).data)) {
    return { ok: false };
  }
  return { ok: true, events: (payload as { data: unknown[] }).data };
}

export type ParentSearchOutcome =
  | { status: "idle" }
  | { status: "hits"; hits: unknown[] }
  | { status: "error" };

export function parentSearchOutcome(input: { query: string; ok: boolean; payload: unknown }): ParentSearchOutcome {
  if (input.query.trim().length < 2) return { status: "idle" };
  if (!input.ok) return { status: "error" };
  const data = input.payload && typeof input.payload === "object"
    ? (input.payload as { data?: unknown }).data
    : undefined;
  if (!Array.isArray(data)) return { status: "error" };
  return { status: "hits", hits: data };
}

export function reservationCandidatesFromPayload(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new Error("Could not read existing reservations");
  }
  return (payload as { data: unknown[] }).data;
}

export function gapCountCaption(count: number | null, failed: boolean): string {
  if (failed) return "Count unavailable";
  if (count === null) return "Counting...";
  if (count === 0) return "All items have a value";
  return `${count} item${count === 1 ? "" : "s"} missing`;
}

export function restoreDialogFocus(
  opener: { isConnected: boolean; focus: () => void } | null,
  event: { preventDefault: () => void },
): boolean {
  if (!opener?.isConnected) return false;
  event.preventDefault();
  opener.focus();
  return true;
}
