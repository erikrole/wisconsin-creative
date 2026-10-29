"use client";

import { Fragment, createElement, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  Camera,
  CalendarClock,
  ChevronDown,
  Cog,
  Copy,
  Heart,
  KeyRound,
  LogIn,
  LogOut,
  Package,
  Pencil,
  Plus,
  QrCode,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  Trash2,
  Upload,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { formatDateTime } from "@/lib/format";
import { AUDIT_CATEGORY_LABELS, auditCategory } from "@/lib/audit-actions";
import {
  EQUIPMENT_ACTIONS,
  HIDDEN_FIELDS,
  RETURN_ACTIONS,
  SYSTEM_ACTIONS,
  coalesceEntries,
  describeAction,
  entityHref,
  formatDuration,
  formatTimestamp,
  getChainedChange,
  getDateGroup,
  getFieldChanges,
  isPhantomEntry,
  type AuditEntry,
  type RenderEntry,
} from "@/lib/activity-timeline";
import { cn } from "@/lib/utils";

export { describeAction, type AuditEntry } from "@/lib/activity-timeline";

/* ── Props ── */

export type ActivityTimelineProps = {
  entries: AuditEntry[];
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** Context for generating descriptions */
  context?: "booking" | "item" | "report" | "user";
  /** Entity name for better descriptions */
  entityName?: string;
  /** Empty state message */
  emptyMessage?: string;
  /** Booking due date — return-type rows later than this get a "N late" note. */
  dueAt?: string | null;
};

/** Action color scheme */
type ActionColorKey =
  | "green"
  | "blue"
  | "amber"
  | "rose"
  | "purple"
  | "muted";

const ACTION_COLORS: Record<string, ActionColorKey> = {
  created: "green",
  create: "green",
  "booking.created": "green",
  checkin_completed: "green",
  items_returned: "green",
  items_returned_partial: "green",
  checkout_completed: "green",
  checkout_scan_completed: "green",
  scan_completed: "green",
  updated: "blue",
  update: "blue",
  owner_transferred: "blue",
  events_updated: "blue",
  extended: "blue",
  extend: "blue",
  duplicated: "blue",
  profile_update: "blue",
  avatar_uploaded: "blue",
  avatar_updated: "blue",
  avatar_deleted: "amber",
  avatar_removed: "amber",
  "booking.items_added": "amber",
  "booking.items_removed": "amber",
  "booking.items_qty_changed": "amber",
  marked_maintenance: "amber",
  cleared_maintenance: "amber",
  partial_return_recorded: "amber",
  cancelled: "rose",
  cancel: "rose",
  deleted: "rose",
  retired: "rose",
  cancelled_by_checkout_conversion: "blue",
  auto_escalation: "purple",
  cron_notification: "purple",
  admin_override: "purple",
  qr_generated: "muted",
  auto_complete: "muted",
  accessory_attached: "blue",
  accessory_detached: "amber",
  accessory_moved: "blue",
  image_uploaded: "blue",
  image_deleted: "amber",
  escalation_config_updated: "purple",
  escalation_rule_updated: "purple",
  profile_updated: "blue",
  draft_discarded: "rose",
  password_reset_requested: "muted",
  password_reset_completed: "muted",
  user_deactivated: "rose",
  user_activated: "green",
  role_changed: "purple",
  login: "green",
  logout: "muted",
  registered: "green",
  password_reset_self: "muted",
  kiosk_activated: "green",
  // Asset / bulk-SKU families
  asset_created: "green",
  asset_image_set: "blue",
  asset_image_uploaded: "blue",
  asset_image_removed: "amber",
  bulk_sku_image_set: "blue",
  bulk_sku_image_uploaded: "blue",
  bulk_sku_image_removed: "amber",
  favorite_added: "muted",
  favorite_removed: "muted",
  retire: "rose",
  reactivated: "green",
  duplicate: "blue",
  csv_import: "blue",
  convert_to_numbered: "purple",
  adjust: "blue",
  add_units: "green",
  mark_labels_printed: "muted",
  bulk_units_auto_lost: "rose",
  repair_stale_checked_out: "purple",
  // Kiosk custody family
  kiosk_pickup: "green",
  kiosk_checkout: "green",
  kiosk_checkin: "green",
  kiosk_checkout_updated: "blue",
  kiosk_checkout_item_added: "amber",
  checkout_item_added: "amber",
  checkout_item_removed: "amber",
  auto_completed_by_item_removal: "green",
  kiosk_checkout_item_removed: "amber",
  partial_bulk_checkin: "amber",
  pending_pickup_expired: "rose",
  fulfilled_by_kiosk_pickup: "green",
  partially_fulfilled_by_kiosk_pickup: "blue",
  admin_force_completed_checkout: "purple",
  admin_force_checkout: "purple",
  reservation_closed_remaining_released: "purple",
  completed_after_plan_edit: "green",
  "booking.item_substituted": "amber",
  nudge_sent: "muted",
  overdue_nudge_sent: "muted",
  auto_completed_by_kiosk_checkin: "green",
  auto_completed_by_bulk_checkin: "green",
  auto_completed_by_partial_checkin: "green",
};

/** Tinted circle behind the event-type icon, keyed by the action's color family. */
const NODE_CLASSES: Record<ActionColorKey, string> = {
  green:  "bg-[var(--green-bg)] text-[var(--green-text)]",
  blue:   "bg-[var(--blue-bg)] text-[var(--blue-text)]",
  amber:  "bg-[var(--orange-bg)] text-[var(--orange-text)]",
  rose:   "bg-[var(--red-bg)] text-[var(--red-text)]",
  purple: "bg-[var(--purple-bg)] text-[var(--purple-text)]",
  muted:  "bg-muted text-muted-foreground",
};

/** Event-type icon for the timeline rail. Exact matches first, then family prefixes. */
const ACTION_ICONS: Record<string, LucideIcon> = {
  created: Plus,
  create: Plus,
  "booking.created": Plus,
  asset_created: Plus,
  registered: Plus,
  cancelled: X,
  cancel: X,
  draft_discarded: X,
  deleted: Trash2,
  bulk_deleted: Trash2,
  retired: Trash2,
  retire: Trash2,
  bulk_retired: Trash2,
  reactivated: RotateCcw,
  bulk_unretired: RotateCcw,
  duplicated: Copy,
  duplicate: Copy,
  extended: CalendarClock,
  extend: CalendarClock,
  events_updated: CalendarClock,
  qr_generated: QrCode,
  favorite_added: Heart,
  favorite_removed: Heart,
  csv_import: Upload,
  login: LogIn,
  logout: LogOut,
  role_changed: UserRound,
  owner_transferred: UserRound,
  user_deactivated: UserRound,
  user_activated: UserRound,
  admin_override: ShieldAlert,
  admin_force_completed_checkout: ShieldAlert,
  admin_force_checkout: ShieldAlert,
  reservation_closed_remaining_released: ShieldAlert,
  nudge_sent: Bell,
  overdue_nudge_sent: Bell,
  auto_escalation: Bell,
  cron_notification: Bell,
};

const ICON_PREFIXES: [string, LucideIcon][] = [
  ["auto_completed_by", ScanLine],
  ["kiosk_", ScanLine],
  ["checkin", ScanLine],
  ["checkout_scan", ScanLine],
  ["scan_", ScanLine],
  ["partial_", ScanLine],
  ["fulfilled_by_kiosk", ScanLine],
  ["asset_image", Camera],
  ["bulk_sku_image", Camera],
  ["avatar_", Camera],
  ["image_", Camera],
  ["booking.items", Package],
  ["accessory_", Package],
  ["bulk_member", Package],
  ["add_units", Package],
  ["adjust", Package],
  ["convert_to_numbered", Package],
  ["password_", KeyRound],
  ["ics_token", KeyRound],
  ["calendar_event", CalendarClock],
];

function actionIcon(action: string, isSystem: boolean): LucideIcon {
  const exact = ACTION_ICONS[action];
  if (exact) return exact;
  const prefix = ICON_PREFIXES.find(([p]) => action.startsWith(p));
  if (prefix) return prefix[1];
  return isSystem ? Cog : Pencil;
}

/* ── Skeleton loader ── */

export function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex gap-3 items-start">
          <Skeleton className="size-8 rounded-full shrink-0" />
          <div className="flex-1 flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-3 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/* ── Single entry row ── */

function valuePillClass(kind: "old" | "new" | "mid", mono?: boolean) {
  return cn(
    "max-w-56 truncate rounded-md px-2 py-0.5",
    kind === "old" && "bg-[var(--red-bg)] text-[var(--red-text)] line-through",
    kind === "new" && "bg-[var(--green-bg)] font-medium text-[var(--green-text)]",
    kind === "mid" && "bg-muted text-muted-foreground",
    mono && "font-mono text-[11px]",
  );
}

function TimelineEntry({
  entry,
  context,
  entityName,
  dueAt,
}: {
  entry: RenderEntry;
  context: "booking" | "item" | "report" | "user";
  entityName?: string;
  dueAt?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const repeatCount = entry._count && entry._count > 1 ? entry._count : null;
  const isSystem = !entry.actor || SYSTEM_ACTIONS.has(entry.action);
  const actorName = entry.actor?.name
    ?? (SYSTEM_ACTIONS.has(entry.action) ? "System" : "Unknown user");
  const colorKey = ACTION_COLORS[entry.action] ?? "muted";
  const icon = createElement(actionIcon(entry.action, isSystem), { className: "size-3.5" });

  const description = describeAction(entry, actorName, context, entityName);
  const chained = getChainedChange(entry);
  const changes = chained ? [] : getFieldChanges(entry);
  const actorRole = (entry.afterJson?._actorRole as string | undefined) ?? null;

  // Cheqroom-style lateness context: a return after the due date names its
  // slip. Compared against the booking's final due date (extends update it).
  const lateByMs =
    dueAt && RETURN_ACTIONS.has(entry.action)
      ? new Date(entry.createdAt).getTime() - new Date(dueAt).getTime()
      : 0;
  const lateBy = lateByMs > 60_000 ? formatDuration(lateByMs) : null;

  // On user / report contexts each row references a different entity — make the
  // row clickable when a detail page exists. Item-context rows that reference a
  // booking also link out; other rows already live on the entity's own page.
  const linkable =
    (context === "user" ||
      context === "report" ||
      (context === "item" && entry.entityType === "booking")) &&
    entityHref(entry.entityType, entry.entityId, entry.afterJson, entry.entity?.kind);
  const Wrapper: React.ElementType = linkable ? Link : "div";
  const wrapperProps = linkable
    ? {
        href: linkable,
        className:
          "flex gap-3 px-3 sm:px-4 no-underline text-inherit hover:bg-muted/40 transition-colors",
      }
    : { className: "flex gap-3 px-3 sm:px-4" };

  return (
    <Wrapper {...wrapperProps}>
      {/* Event-type rail: tinted icon node + connecting hairline */}
      <div className="flex w-7 shrink-0 flex-col items-center self-stretch">
        <div
          className={cn(
            "mt-2 flex size-7 shrink-0 items-center justify-center rounded-full",
            NODE_CLASSES[colorKey],
          )}
        >
          {icon}
        </div>
        <div className="mt-1 w-px flex-1 bg-border/50" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 py-2.5">
        <div className="flex items-baseline gap-2 flex-wrap">
          {context !== "report" && (
            <span className="text-sm font-medium truncate">{actorName}</span>
          )}
          <span className="text-sm text-muted-foreground">
            {description}
          </span>
          {lateBy && (
            <span className="text-xs font-medium text-[var(--orange-text)]">
              {lateBy} late
            </span>
          )}
          {repeatCount && !chained && (
            <Badge
              variant="secondary"
              className="h-5 px-1.5 text-[10px] tabular-nums"
            >
              ×{repeatCount}
            </Badge>
          )}
          <span
            className="text-xs text-muted-foreground/60 ml-auto shrink-0 tabular-nums"
            title={formatDateTime(entry.createdAt)}
          >
            {formatTimestamp(entry)}
          </span>
          {!linkable && (
            <button
              type="button"
              aria-label={expanded ? "Hide entry details" : "Show entry details"}
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="shrink-0 self-center rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-muted-foreground"
            >
              <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
            </button>
          )}
        </div>

        {/* Chained same-field run: value path oldest → newest */}
        {chained && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{chained.label}</span>
            {chained.values.map((value, i) => (
              <Fragment key={`${i}-${value}`}>
                {i > 0 && <ArrowRight className="size-3 shrink-0 text-muted-foreground/50" />}
                <span
                  className={cn(
                    valuePillClass(i === chained.values.length - 1 ? "new" : "mid", chained.mono),
                    "tabular-nums",
                  )}
                  title={value}
                >
                  {value}
                </span>
              </Fragment>
            ))}
            {chained.delta && (
              <span className="text-muted-foreground/60">({chained.delta})</span>
            )}
          </div>
        )}

        {/* Field changes: old value red + struck, new value green */}
        {changes.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1">
            {changes.map((change) => (
              <div key={change.label} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">{change.label}</span>
                {change.from && change.from !== "empty" ? (
                  <>
                    <span className={valuePillClass("old", change.mono)} title={change.from}>
                      {change.from}
                    </span>
                    <ArrowRight className="size-3 shrink-0 text-muted-foreground/50" />
                    <span className={valuePillClass("new", change.mono)} title={change.to}>
                      {change.to}
                    </span>
                  </>
                ) : (
                  <span className={valuePillClass("new", change.mono)} title={change.to}>
                    {change.to}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Raw entry details — the API already sends this JSON to the client,
            so revealing it adds no exposure. */}
        {expanded && (
          <div className="mt-2 flex flex-col gap-2 rounded-md border border-border/40 bg-muted/40 p-2.5 text-xs">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <span className="text-muted-foreground">When</span>
              <span className="tabular-nums">{formatDateTime(entry.createdAt)}</span>
              <span className="text-muted-foreground">Actor</span>
              <span>
                {actorName}
                {actorRole ? ` · ${actorRole}` : ""}
              </span>
              <span className="text-muted-foreground">Area</span>
              <span>{AUDIT_CATEGORY_LABELS[auditCategory(entry.action, entry.entityType)]}</span>
              <span className="text-muted-foreground">Action</span>
              <span className="font-mono text-[11px]">{entry.action}</span>
              <span className="text-muted-foreground">Entity</span>
              <span className="break-all font-mono text-[11px]">
                {entry.entityType ?? "—"} · {entry.entityId ?? "—"}
              </span>
            </div>
            {entry.beforeJson && (
              <div>
                <span className="text-muted-foreground">Before</span>
                <pre className="mt-1 overflow-x-auto rounded bg-background/60 p-2 font-mono text-[11px]">
                  {JSON.stringify(entry.beforeJson, null, 2)}
                </pre>
              </div>
            )}
            {entry.afterJson && (
              <div>
                <span className="text-muted-foreground">After</span>
                <pre className="mt-1 overflow-x-auto rounded bg-background/60 p-2 font-mono text-[11px]">
                  {JSON.stringify(entry.afterJson, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </Wrapper>
  );
}

/* ── Main component ── */

export default function ActivityTimeline({
  entries,
  loading,
  hasMore,
  onLoadMore,
  context = "booking",
  entityName,
  emptyMessage = "No activity recorded yet.",
  dueAt,
}: ActivityTimelineProps) {
  const today = useMemo(() => new Date(), []);

  // Drop phantom rows first (so no date header renders for a day of hidden
  // writes), coalesce rapid identical writes, then group by date. Coalescing
  // before grouping means a run that straddles a date boundary (rare) folds
  // onto the newer side — the right side from a "what just happened" reading.
  const groups = useMemo(() => {
    const coalesced = coalesceEntries(entries.filter((e) => !isPhantomEntry(e)));
    const map = new Map<string, RenderEntry[]>();
    for (const entry of coalesced) {
      const group = getDateGroup(entry.createdAt, today);
      const arr = map.get(group);
      if (arr) arr.push(entry);
      else map.set(group, [entry]);
    }
    return Array.from(map.entries());
  }, [entries, today]);

  if (loading && entries.length === 0) {
    return <TimelineSkeleton />;
  }

  // Check the filtered groups, not raw entries — a page of nothing but
  // phantom rows should show the empty state, not a blank panel.
  if (groups.length === 0) {
    return (
      <Empty className="py-8 border-0">
        <EmptyDescription>{emptyMessage}</EmptyDescription>
      </Empty>
    );
  }

  return (
    <div>
      {groups.map(([dateLabel, groupEntries]) => (
        <div key={dateLabel}>
          {/* Sticky date header */}
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/30 px-3 sm:px-4 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {dateLabel}
            </span>
          </div>

          {/* Entries — the rail hairline provides row structure, no dividers */}
          <div>
            {groupEntries.map((entry) => (
              <TimelineEntry
                key={entry.id}
                entry={entry}
                context={context}
                entityName={entityName}
                dueAt={dueAt}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Load more */}
      {hasMore && onLoadMore && (
        <>
          <Separator className="opacity-30" />
          <div className="py-3 text-center">
          <Button className="h-10"
            variant="outline"
            disabled={loading}
            onClick={onLoadMore}
          >
            {loading ? "Loading\u2026" : "Load older entries"}
          </Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Re-export utilities for consumers ── */

export { EQUIPMENT_ACTIONS, HIDDEN_FIELDS as HIDDEN_AUDIT_FIELDS };
