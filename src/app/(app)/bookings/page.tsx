"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BookingListPage, { type BookingListConfig, type BookingItem, type ContextMenuExtra } from "@/components/BookingListPage";
import { useConfirm } from "@/components/ConfirmDialog";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LayoutGridIcon, ListIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import StatusIndicator from "@/components/ui/status-indicator";
import { handleAuthRedirect, isAbortError, parseErrorMessage } from "@/lib/errors";
import { useBookingChangeSync } from "@/hooks/use-booking-change-sync";
import { FadeUp } from "@/components/ui/motion";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import type { TabKey as BookingSheetSection } from "@/components/booking-details/types";
import { useCurrentUser } from "@/hooks/use-current-user";

/** Shared fetch wrapper with 401 redirect */
async function fetchAction(url: string, method = "POST"): Promise<Response> {
  const res = await fetch(url, { method });
  if (handleAuthRedirect(res, "/bookings")) {
    throw new DOMException("Auth redirect", "AbortError");
  }
  return res;
}

function parseBookingSheetSection(value: string | null): BookingSheetSection | null {
  return value === "details" || value === "equipment" || value === "history" ? value : null;
}

const ACTIVE_STATUS_OPTIONS = [
  { value: "OPEN", label: "Open" },
  { value: "DRAFT", label: "Draft" },
  { value: "BOOKED", label: "Reserved" },
  { value: "PENDING_PICKUP", label: "Pending pickup" },
];

const PAST_STATUS_OPTIONS = [
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

export default function BookingsPage() {
  const confirm = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSignature = searchParams.toString();
  const requestedTab = (["all", "checkouts", "reservations"] as const).includes(searchParams.get("tab") as never)
    ? (searchParams.get("tab") as "all" | "checkouts" | "reservations")
    : "checkouts";
  const requestedScope = searchParams.get("past") === "true" ? "past" : "active";
  const requestedView = searchParams.get("view") === "table" || searchParams.get("view") === "cards"
    ? searchParams.get("view") as "table" | "cards"
    : null;
  const [activeTab, setActiveTab] = useState<"all" | "checkouts" | "reservations">(requestedTab);
  const [scope, setScope] = useState<"active" | "past">(requestedScope);
  const [viewMode, setViewModeRaw] = useState<"cards" | "table">("cards");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const actionBusyRef = useRef(false);
  const { data: currentUser } = useCurrentUser();
  const bookingSync = useBookingChangeSync(Boolean(currentUser) && !currentUser?.preview?.readOnly);

  // Consume highlight once from URL so only the correct tab receives it (avoids all-tabs-mount race)
  const [pendingHighlight, setPendingHighlight] = useState<{ id: string; tab: "all" | "checkouts" | "reservations"; sheetTab: BookingSheetSection | null } | null>(() => {
    const id = searchParams.get("highlight") || searchParams.get("id");
    return id ? { id, tab: requestedTab, sheetTab: parseBookingSheetSection(searchParams.get("sheetTab")) } : null;
  });

  useEffect(() => {
    setActiveTab(requestedTab);
  }, [requestedTab]);

  useEffect(() => {
    setScope(requestedScope);
  }, [requestedScope]);

  useEffect(() => {
    if (requestedView) {
      setViewModeRaw(requestedView);
      setPreferencesLoaded(true);
      return;
    }
    try {
      setViewModeRaw(localStorage.getItem("bookings-view-mode") === "table" ? "table" : "cards");
    } catch {
      setViewModeRaw("cards");
    }
    setPreferencesLoaded(true);
  }, [requestedView]);

  useEffect(() => {
    const id = searchParams.get("highlight") || searchParams.get("id");
    if (!id) return;
    setPendingHighlight({ id, tab: requestedTab, sheetTab: parseBookingSheetSection(searchParams.get("sheetTab")) });
    const next = new URLSearchParams(urlSignature);
    next.delete("highlight");
    next.delete("id");
    next.delete("sheetTab");
    const qs = next.toString();
    router.replace(qs ? `/bookings?${qs}` : "/bookings", { scroll: false });
  }, [requestedTab, router, searchParams, urlSignature]);

  function setViewMode(mode: "cards" | "table") {
    setViewModeRaw(mode);
    try { localStorage.setItem("bookings-view-mode", mode); } catch { /* ignore */ }
    const next = new URLSearchParams(searchParams.toString());
    next.set("view", mode);
    const qs = next.toString();
    router.replace(qs ? `/bookings?${qs}` : "/bookings", { scroll: false });
  }

  const handleTabChange = useCallback((value: string) => {
    const nextTab = value as "all" | "checkouts" | "reservations";
    setActiveTab(nextTab);
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", nextTab);
    next.delete("highlight");
    next.delete("id");
    next.delete("sheetTab");
    next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `/bookings?${qs}` : "/bookings", { scroll: false });
  }, [router, searchParams]);

  const handleScopeChange = useCallback((value: string) => {
    if (value !== "active" && value !== "past") return;
    setScope(value);
    const next = new URLSearchParams(searchParams.toString());
    if (value === "past") next.set("past", "true");
    else next.delete("past");
    next.delete("status");
    next.delete("filter");
    next.delete("highlight");
    next.delete("id");
    next.delete("sheetTab");
    next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `/bookings?${qs}` : "/bookings", { scroll: false });
  }, [router, searchParams]);

  const isPastScope = scope === "past";
  const canCreateReservation = currentUser != null && !currentUser.preview?.readOnly && (
    currentUser.role !== "COLLABORATOR" || currentUser.capabilities?.includes("RESERVATION_CREATE") === true
  );

  const checkoutContextMenuExtras = useMemo<ContextMenuExtra[]>(() => [
    {
      action: "cancel",
      label: "Cancel checkout",
      kind: "CHECKOUT",
      danger: true,
      handler: async (bookingId, items, reload, setItems) => {
        const c = items.find((i: BookingItem) => i.id === bookingId);
        if (!c) return;
        const ok = await confirm({
          title: "Cancel checkout",
          message: `This will return all equipment to available inventory and unblock other bookings.`,
          confirmLabel: "Cancel checkout",
          variant: "danger",
        });
        if (!ok) return;
        if (actionBusyRef.current) return;
        actionBusyRef.current = true;

        const prevItems = [...items];
        setItems?.((list) =>
          list.map((i) => (i.id === bookingId ? { ...i, status: "CANCELLED" } : i)),
        );

        try {
          const res = await fetchAction(`/api/bookings/${bookingId}/cancel`);
          if (!res.ok) {
            setItems?.(() => prevItems);
            const msg = await parseErrorMessage(res, "Cancel failed");
            toast.error(msg);
          } else {
            toast.success("Checkout cancelled");
            setItems?.((list) => list.filter((i) => i.id !== bookingId));
            void reload();
          }
        } catch (err) {
          if (isAbortError(err)) return;
          setItems?.(() => prevItems);
          toast.error("Failed to cancel checkout. Please try again.");
        } finally {
          actionBusyRef.current = false;
        }
      },
    },
  ], [confirm]);

  const reservationContextMenuExtras = useMemo<ContextMenuExtra[]>(() => [
    {
      action: "duplicate",
      label: "Reuse gear for another event",
      kind: "RESERVATION",
      handler: async (bookingId) => {
        if (actionBusyRef.current) return;
        actionBusyRef.current = true;
        try {
          router.push(`/reservations/new?reuseFrom=${encodeURIComponent(bookingId)}`);
        } finally {
          actionBusyRef.current = false;
        }
      },
    },
    {
      action: "cancel",
      label: "Cancel reservation",
      kind: "RESERVATION",
      danger: true,
      handler: async (bookingId, items, reload, setItems) => {
        const r = items.find((i: BookingItem) => i.id === bookingId);
        if (!r) return;
        const ok = await confirm({
          title: "Cancel reservation",
          message: `Cancel "${r.title}"? All held equipment will be released back to inventory.`,
          confirmLabel: "Cancel reservation",
          variant: "danger",
        });
        if (!ok) return;
        if (actionBusyRef.current) return;
        actionBusyRef.current = true;

        const prevItems = [...items];
        setItems?.((list) =>
          list.map((i) => (i.id === bookingId ? { ...i, status: "CANCELLED" } : i)),
        );

        try {
          const res = await fetchAction(`/api/reservations/${bookingId}/cancel`);
          if (!res.ok) {
            setItems?.(() => prevItems);
            const msg = await parseErrorMessage(res, "Cancel failed");
            toast.error(msg);
          } else {
            toast.success("Reservation cancelled");
            setItems?.((list) => list.filter((i) => i.id !== bookingId));
            void reload();
          }
        } catch (err) {
          if (isAbortError(err)) return;
          setItems?.(() => prevItems);
          toast.error("Failed to cancel reservation. Please try again.");
        } finally {
          actionBusyRef.current = false;
        }
      },
    },
  ], [confirm, router]);

  const checkoutConfig: BookingListConfig = useMemo(() => ({
    kind: "CHECKOUT",
    apiBase: "/api/checkouts",
    label: "checkout",
    labelPlural: "Checkouts",
    actionLabel: "",
    actionLabelProgress: "",
    requesterLabel: "Checked out to",
    startLabel: "Pickup",
    endLabel: "Return by",
    statusOptions: isPastScope
      ? PAST_STATUS_OPTIONS
      : [
          { value: "OPEN", label: "Checked Out" },
          { value: "PENDING_PICKUP", label: "Pending pickup" },
        ],
    defaultTieToEvent: true,
    hasSportFilter: true,
    overdueStatus: "OPEN",
    defaultStatusFilter: "",
    defaultStatusFilters: isPastScope ? [] : ["OPEN", "PENDING_PICKUP"],
    pastOnly: isPastScope,
    scopeLabel: isPastScope ? "Past" : "Active",
    showEventBadge: true,
    contextMenuExtras: checkoutContextMenuExtras,
  }), [checkoutContextMenuExtras, isPastScope]);

  const allConfig: BookingListConfig = useMemo(() => ({
    kind: "ALL",
    apiBase: "/api/bookings",
    label: "booking",
    labelPlural: "All Bookings",
    actionLabel: "",
    actionLabelProgress: "",
    requesterLabel: "Requested by",
    startLabel: "Start",
    endLabel: "End",
    statusOptions: isPastScope ? PAST_STATUS_OPTIONS : ACTIVE_STATUS_OPTIONS,
    defaultTieToEvent: false,
    hasSportFilter: true,
    activeOnly: !isPastScope,
    pastOnly: isPastScope,
    scopeLabel: isPastScope ? "Past" : "Active",
    overdueStatus: "",
    defaultStatusFilter: "",
    showEventBadge: true,
    contextMenuExtras: [...checkoutContextMenuExtras, ...reservationContextMenuExtras],
  }), [checkoutContextMenuExtras, reservationContextMenuExtras, isPastScope]);

  const reservationConfig: BookingListConfig = useMemo(() => ({
    kind: "RESERVATION",
    apiBase: "/api/reservations",
    label: "reservation",
    labelPlural: "Reservations",
    actionLabel: "Reserve for later",
    actionLabelProgress: "Reserving\u2026",
    requesterLabel: "Reserved for",
    startLabel: "Start",
    endLabel: "End",
    statusOptions: isPastScope
      ? PAST_STATUS_OPTIONS
      : [
          { value: "DRAFT", label: "Draft" },
          { value: "BOOKED", label: "Reserved" },
        ],
    defaultTieToEvent: true,
    hasSportFilter: true,
    overdueStatus: "BOOKED",
    defaultStatusFilter: isPastScope ? "" : "BOOKED",
    pastOnly: isPastScope,
    scopeLabel: isPastScope ? "Past" : undefined,
    showEventBadge: true,
    contextMenuExtras: reservationContextMenuExtras,
  }), [reservationContextMenuExtras, isPastScope]);

  return (
    <FadeUp>
      <PageHeader title="Bookings">
        {canCreateReservation && (
          <Button className="h-10" asChild>
            <Link href="/reservations/new">New reservation</Link>
          </Button>
        )}
      </PageHeader>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
          <TabsList className="min-w-0 flex-1 overflow-x-auto scrollbar-hide" aria-label="Booking type">
            <TabsTrigger
              value="all"
              className="relative shrink-0 gap-1.5 border-b-transparent data-[state=active]:border-b-transparent after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--wi-red)] after:opacity-0 after:transition-opacity data-[state=active]:after:opacity-100"
            >
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 500 }}>All</span>
            </TabsTrigger>
            <TabsTrigger
              value="checkouts"
              className="relative shrink-0 gap-1.5 border-b-transparent data-[state=active]:border-b-transparent after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--wi-red)] after:opacity-0 after:transition-opacity data-[state=active]:after:opacity-100"
            >
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 500 }}>Checkouts</span>
            </TabsTrigger>
            <TabsTrigger
              value="reservations"
              className="relative shrink-0 gap-1.5 border-b-transparent data-[state=active]:border-b-transparent after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--wi-red)] after:opacity-0 after:transition-opacity data-[state=active]:after:opacity-100"
            >
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 500 }}>Reservations</span>
            </TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap items-center gap-2">
            <StatusIndicator
              state={bookingSync.state}
              label={bookingSync.label}
              size="sm"
              title={bookingSync.description}
            />
            <ToggleGroup
              type="single"
              value={scope}
              onValueChange={handleScopeChange}
              className="shrink-0 rounded-md border border-border/60 bg-background p-0.5"
              aria-label="Booking time scope"
            >
              <ToggleGroupItem value="active" className="h-10 px-3 text-xs" aria-label="Show active bookings">
                Active
              </ToggleGroupItem>
              <ToggleGroupItem value="past" className="h-10 px-3 text-xs" aria-label="Show past bookings">
                Past
              </ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(value) => {
                if (value === "cards" || value === "table") setViewMode(value);
              }}
              className={`shrink-0 ${preferencesLoaded ? "" : "opacity-80"}`}
              aria-label="Booking view"
            >
              <ToggleGroupItem value="cards" className="size-10 p-0" aria-label="Card view">
                <LayoutGridIcon className="size-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="table" className="size-10 p-0" aria-label="List view">
                <ListIcon className="size-4" />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        <TabsContent value="all">
          <BookingListPage key={`all-${scope}`} config={allConfig} viewMode={viewMode} hideHeader enableBookingChangeSync={false} initialHighlight={pendingHighlight?.tab === "all" ? pendingHighlight.id : null} initialSheetTab={pendingHighlight?.tab === "all" ? pendingHighlight.sheetTab : null} />
        </TabsContent>

        <TabsContent value="checkouts">
          <BookingListPage key={`checkouts-${scope}`} config={checkoutConfig} viewMode={viewMode} hideHeader enableBookingChangeSync={false} initialHighlight={pendingHighlight?.tab === "checkouts" ? pendingHighlight.id : null} initialSheetTab={pendingHighlight?.tab === "checkouts" ? pendingHighlight.sheetTab : null} />
        </TabsContent>

        <TabsContent value="reservations">
          <BookingListPage key={`reservations-${scope}`} config={reservationConfig} viewMode={viewMode} hideHeader enableBookingChangeSync={false} initialHighlight={pendingHighlight?.tab === "reservations" ? pendingHighlight.id : null} initialSheetTab={pendingHighlight?.tab === "reservations" ? pendingHighlight.sheetTab : null} />
        </TabsContent>
      </Tabs>
    </FadeUp>
  );
}
