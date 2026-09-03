/* ───── Shared types and helpers for booking-list components ───── */

import type { PickerAsset, PickerBulkSku } from "@/components/EquipmentPicker";
import type { TabKey as BookingSheetSection } from "@/components/booking-details/types";
import type { BookingKind } from "@/lib/booking-actions";
import { bookingStatusVisual, type BookingStatusVisual } from "@/lib/booking-status-display";
import { roundUpToQuarterHour } from "@/lib/quarter-hour";

/* ───── Types ───── */

export type BookingItem = {
  id: string;
  title: string;
  refNumber?: string | null;
  startsAt: string;
  endsAt: string;
  updatedAt: string;
  status: string;
  kind: "CHECKOUT" | "RESERVATION";
  custodyScope?: "PERSON" | "SHARED";
  sportCode: string | null;
  createdBy?: string;
  requester: { id: string; name: string; avatarUrl?: string | null };
  location: { id: string; name: string };
  serializedItems: Array<{ asset: { assetTag: string; brand: string; model: string; imageUrl?: string | null } }>;
  bulkItems: Array<{ bulkSku: { name: string }; plannedQuantity: number }>;
  event?: { id: string; summary: string; sportCode: string | null; opponent: string | null; isHome: boolean | null } | null;
};

export type FormUser = { id: string; name: string; avatarUrl?: string | null };
export type { Location } from "@/types/common";

export type CalendarEvent = {
  id: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  sportCode: string | null;
  isHome: boolean | null;
  opponent: string | null;
  rawLocationText: string | null;
  location: { id: string; name: string } | null;
};

export type AvailableAsset = PickerAsset;
export type BulkSkuOption = PickerBulkSku;
export type ListResponse = { data: BookingItem[]; total: number; limit: number; offset: number };

export type StatusOption = { value: string; label: string };

export type ContextMenuExtra = {
  action: string;
  label: string;
  kind?: "CHECKOUT" | "RESERVATION";
  danger?: boolean;
  opensSheet?: boolean;
  sheetTab?: BookingSheetSection;
  handler?: (bookingId: string, items: BookingItem[], reload: () => Promise<void>, setItems?: (updater: (items: BookingItem[]) => BookingItem[]) => void) => void | Promise<void>;
};

export type BookingListConfig = {
  kind: BookingKind | string; // string allows "ALL" discriminator for combined view
  apiBase: string;
  cancelApiBase?: string;
  label: string;
  labelPlural: string;
  /** Intent-driven button label, e.g. "Check out equipment" */
  actionLabel: string;
  /** Progressive form for loading state, e.g. "Checking out…" */
  actionLabelProgress: string;
  /** Label for the requester field, e.g. "Checked out to" */
  requesterLabel: string;
  /** Label for start date, e.g. "Pickup" */
  startLabel: string;
  /** Label for end date, e.g. "Return by" */
  endLabel: string;
  statusOptions: StatusOption[];
  defaultTieToEvent: boolean;
  hasSportFilter: boolean;
  activeOnly?: boolean;
  pastOnly?: boolean;
  scopeLabel?: string;
  overdueStatus: string;
  /** Status filter applied by default (e.g. "OPEN" to hide completed/cancelled) */
  defaultStatusFilter?: string;
  /** Multi-status filter applied by default when no explicit status/special filter is selected. */
  defaultStatusFilters?: string[];
  showEventBadge: boolean;
  contextMenuExtras: ContextMenuExtra[];
};

export type SortKey = "title" | "startsAt" | "endsAt";
export type SortDir = "asc" | "desc";

/* ───── Helpers ───── */

export function formatDateCol(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase(),
    day: d.toLocaleDateString("en-US", { weekday: "short" }),
  };
}

export function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const hours = Math.round(ms / (1000 * 60 * 60));
  if (hours < 1) return "< 1 hour";
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""}`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days !== 1 ? "s" : ""}`;
  const weeks = Math.round(days / 7);
  return `${weeks} week${weeks !== 1 ? "s" : ""}`;
}

export function toSortParam(key: SortKey, dir: SortDir): string {
  if (key === "startsAt") return dir === "asc" ? "oldest" : "";
  if (key === "endsAt") return dir === "asc" ? "endsAt" : "endsAt_desc";
  return dir === "asc" ? "title" : "title_desc";
}

export function parseSortParam(s: string): { key: SortKey; dir: SortDir } | null {
  if (s === "oldest") return { key: "startsAt", dir: "asc" };
  if (s === "" || !s) return { key: "startsAt", dir: "desc" };
  if (s === "title") return { key: "title", dir: "asc" };
  if (s === "title_desc") return { key: "title", dir: "desc" };
  if (s === "endsAt") return { key: "endsAt", dir: "asc" };
  if (s === "endsAt_desc") return { key: "endsAt", dir: "desc" };
  return null;
}

export function getStatusVisual(status: string, isOverdue: boolean, kind?: "CHECKOUT" | "RESERVATION"): BookingStatusVisual {
  return bookingStatusVisual(status, { overdue: isOverdue, kind });
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function roundTo15Min(date: Date): Date {
  return roundUpToQuarterHour(date);
}

export function toLocalDateTimeValue(date: Date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}`;
}
