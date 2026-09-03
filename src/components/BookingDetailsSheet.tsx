"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BOOKING_MUTATION_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { BOOKING_SNAPSHOT_HEADER } from "@/lib/booking-concurrency";
import { useConfirm } from "@/components/ConfirmDialog";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import EmptyState from "@/components/EmptyState";
import { OperationalLoadingState } from "@/components/OperationalLoadingState";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetDescription,
  SheetTitle,
  SheetBody,
  SheetFooter,
} from "@/components/ui/sheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { getBookingCancelCopy } from "@/hooks/booking-action-copy";
import { BOOKING_CHANGE_SYNC_EVENT } from "@/hooks/use-booking-change-sync";
import { statusBadgeVariant, statusLabel } from "./booking-details/helpers";
import { BookingItems } from "./booking-details";
import BookingSheetOverview from "./booking-details/BookingSheetOverview";
import { InlineTitle } from "@/components/InlineTitle";
import { EditBookingEventsDialog } from "./booking-details/EditBookingEventsDialog";
import { TransferOwnerDialog } from "./booking-details/TransferOwnerDialog";
import dynamic from "next/dynamic";
import type { PickerBulkSku } from "@/components/EquipmentPicker";
const EquipmentPicker = dynamic(() => import("@/components/EquipmentPicker"), { ssr: false });
import { UserAvatar } from "@/components/UserAvatar";
import { isDueToday } from "@/lib/format";
import Link from "next/link";
import {
  CalendarRangeIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PackageOpenIcon,
  TriangleAlert,
  UserRoundCogIcon,
  XCircleIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  BookingDetail,
  BulkSkuOption,
  ConflictData,
  TabKey,
} from "./booking-details/types";

/* ───── Props ───── */

type Props = {
  bookingId: string | null;
  initialTab?: TabKey | null;
  onClose: () => void;
  onUpdated?: () => void;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: string;
  nextCursor?: string | null;
  hasMore?: boolean;
};

type FormOptionsResponse = {
  data?: {
    bulkSkus?: BulkSkuOption[];
  };
};

type EditableBookingField = "title" | "startsAt" | "endsAt" | "notes";

/* ───── Section heading ───── */

function SectionHead({
  label,
  count,
  right,
}: {
  label: string;
  count?: number;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 px-6 pt-4 pb-1">
      <span className="flex flex-1 min-w-0 items-center gap-2">
        <span className="text-base font-semibold tracking-tight">{label}</span>
        {typeof count === "number" && count > 0 && (
          <Badge variant="secondary" size="sm" className="tabular-nums">
            {count}
          </Badge>
        )}
      </span>
      {right}
    </div>
  );
}

/* ───── Component ───── */

export default function BookingDetailsSheet({
  bookingId,
  initialTab,
  onClose,
  onUpdated,
}: Props) {
  const confirm = useConfirm();

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [equipSearch, setEquipSearch] = useState("");
  const [transferOwnerOpen, setTransferOwnerOpen] = useState(false);
  const [editEventsOpen, setEditEventsOpen] = useState(false);

  // Equipment editing state
  const [equipEditMode, setEquipEditMode] = useState(false);
  const [editSerializedIds, setEditSerializedIds] = useState<string[]>([]);
  const [editBulkItems, setEditBulkItems] = useState<
    { bulkSkuId: string; quantity: number }[]
  >([]);
  const [bulkSkus, setBulkSkus] = useState<BulkSkuOption[]>([]);
  const [equipSaving, setEquipSaving] = useState(false);
  const [conflictError, setConflictError] = useState<ConflictData | null>(null);
  const [optionsError, setOptionsError] = useState(false);

  const [fetchError, setFetchError] = useState(false);

  const [cancelling, setCancelling] = useState(false);
  const equipSaveBusyRef = useRef(false);
  const cancelBusyRef = useRef(false);
  const sheetBodyRef = useRef<HTMLDivElement | null>(null);
  const detailsSectionRef = useRef<HTMLDivElement | null>(null);
  const equipmentSectionRef = useRef<HTMLDivElement | null>(null);

  /* ───── Data fetching ───── */

  const abortRef = useRef<AbortController | null>(null);

  const fetchBooking = useCallback(async (opts?: { silent?: boolean }) => {
    if (!bookingId) return;
    if (!opts?.silent) setLoading(true);
    setFetchError(false);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetchWithTimeout(`/api/bookings/${bookingId}`, {
        signal: controller.signal,
      });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        const json = await parseJsonSafely<ApiEnvelope<BookingDetail>>(res);
        if (json?.data) {
          setBooking(json.data);
        }
      } else {
        if (!opts?.silent) setFetchError(true);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (!opts?.silent) setFetchError(true);
    }
    setLoading(false);
  }, [bookingId]);

  useEffect(() => {
    if (bookingId) {
      fetchBooking();
      setEquipEditMode(false);
      setConflictError(null);
    }
    return () => { abortRef.current?.abort(); };
  }, [bookingId, fetchBooking]);

  useEffect(() => {
    if (!bookingId) return;

    const refreshChangedBooking = (event: Event) => {
      const changedBookingIds = (event as CustomEvent<{ changedBookingIds?: unknown }>).detail?.changedBookingIds;
      if (!Array.isArray(changedBookingIds) || !changedBookingIds.includes(bookingId)) return;
      void fetchBooking({ silent: true });
    };

    window.addEventListener(BOOKING_CHANGE_SYNC_EVENT, refreshChangedBooking);
    return () => window.removeEventListener(BOOKING_CHANGE_SYNC_EVENT, refreshChangedBooking);
  }, [bookingId, fetchBooking]);

  // Scroll to the equipment section when opened with that intent.
  useEffect(() => {
    if (!bookingId || loading || !booking || equipEditMode) return;
    if (initialTab !== "equipment") return;
    const section = equipmentSectionRef.current;
    if (!section) return;
    const frame = window.requestAnimationFrame(() => {
      const body = sheetBodyRef.current;
      if (!body) return;
      body.scrollTo({ top: section.offsetTop - body.offsetTop, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [bookingId, booking, loading, equipEditMode, initialTab]);

  const loadFormOptions = useCallback(async () => {
    try {
      setOptionsError(false);
      const res = await fetchWithTimeout("/api/form-options");
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        const json = await parseJsonSafely<FormOptionsResponse>(res);
        setBulkSkus(json?.data?.bulkSkus ?? []);
      } else {
        setOptionsError(true);
      }
    } catch {
      setOptionsError(true);
      toast.error("Could not load equipment options. Retry before saving equipment changes.");
    }
  }, []);

  /* ───── Derived state ───── */

  const checkinProgress = useMemo(() => {
    if (!booking || booking.kind !== "CHECKOUT" || booking.status !== "OPEN") return null;
    const items = booking.serializedItems ?? [];
    const total = items.length;
    if (total === 0) return null;
    const returned = items.filter((i) => i.allocationStatus === "returned").length;
    return { returned, total, percent: Math.round((returned / total) * 100) };
  }, [booking]);

  /* ───── Permission flags ───── */

  const actions = booking?.allowedActions ?? [];
  const canEdit = booking && actions.includes("edit");
  const canCancel = booking && actions.includes("cancel");
  const canTransferOwner = booking && actions.includes("transfer-owner");
  const canEditEvents = booking && actions.includes("edit");
  const canEditEquipment = canEdit && booking?.kind === "RESERVATION";

  /* ───── Filtered equipment ───── */

  const filteredSerializedItems = (booking?.serializedItems ?? []).filter((item) => {
    if (!equipSearch) return true;
    const q = equipSearch.toLowerCase();
    return (
      item.asset.assetTag.toLowerCase().includes(q) ||
      item.asset.brand.toLowerCase().includes(q) ||
      item.asset.model.toLowerCase().includes(q) ||
      item.asset.serialNumber?.toLowerCase().includes(q)
    );
  });

  const filteredBulkItems = (booking?.bulkItems ?? []).filter((item) => {
    if (!equipSearch) return true;
    return item.bulkSku.name.toLowerCase().includes(equipSearch.toLowerCase());
  });

  const totalEquipItems =
    (booking?.serializedItems?.length ?? 0) + (booking?.bulkItems?.length ?? 0);

  /* ───── Handlers ───── */

  function enterEquipEditMode() {
    if (!booking) return;
    setEditSerializedIds((booking.serializedItems ?? []).map((i) => i.asset.id));
    setEditBulkItems(
      (booking.bulkItems ?? []).map((i) => ({
        bulkSkuId: i.bulkSku.id,
        quantity: i.plannedQuantity,
      }))
    );
    setEquipEditMode(true);
    setConflictError(null);
    loadFormOptions();
  }

  async function handleEquipSave() {
    if (!booking || equipSaveBusyRef.current) return;
    equipSaveBusyRef.current = true;
    setEquipSaving(true);
    setConflictError(null);

    let committed = false;
    let updated: BookingDetail | null = null;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (booking.updatedAt) headers[BOOKING_SNAPSHOT_HEADER] = new Date(booking.updatedAt).toISOString();
      const res = await fetchWithTimeout(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        timeoutMs: BOOKING_MUTATION_TIMEOUT_MS,
        headers,
        body: JSON.stringify({
          serializedAssetIds: editSerializedIds,
          bulkItems: editBulkItems,
        }),
      });

      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        const json = await parseJsonSafely<ApiEnvelope<BookingDetail>>(res);
        committed = true;
        updated = json?.data ?? null;
      } else {
        const json = await parseJsonSafely<ApiEnvelope<ConflictData>>(res);
        if (res.status === 409 && json?.data) setConflictError(json.data);
        toast.error(json?.error || "Could not save equipment changes. Review conflicts and try again.");
      }
    } catch {
      toast.error("Could not reach the server. Equipment changes were not saved.");
    } finally {
      equipSaveBusyRef.current = false;
      setEquipSaving(false);
    }

    if (!committed) return;
    if (updated) setBooking(updated);
    toast.success("Equipment updated");
    setEquipEditMode(false);
    if (!updated) await fetchBooking({ silent: true });
    onUpdated?.();
  }

  async function handleSaveField(field: EditableBookingField, value: string) {
    if (!booking) return;
    let updated: BookingDetail | null = null;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (booking.updatedAt) headers[BOOKING_SNAPSHOT_HEADER] = new Date(booking.updatedAt).toISOString();
      const res = await fetchWithTimeout(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        timeoutMs: BOOKING_MUTATION_TIMEOUT_MS,
        headers,
        body: JSON.stringify({ [field]: value }),
      });

      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        const json = await parseJsonSafely<ApiEnvelope<BookingDetail>>(res);
        updated = json?.data ?? null;
      } else {
        const json = await parseJsonSafely<ApiEnvelope<ConflictData>>(res);
        if (res.status === 409 && json?.data) setConflictError(json.data);
        throw new Error(json?.error || "Could not save this change. Review conflicts and try again.");
      }
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : "Could not reach the server. Booking changes were not saved.";
      toast.error(message);
      throw error;
    }

    if (updated) setBooking(updated);
    toast.success(field === "title" ? "Title updated" : field === "notes" ? "Notes updated" : "Schedule updated");
    if (!updated) await fetchBooking({ silent: true });
    onUpdated?.();
  }

  async function handleCancel() {
    if (!booking || cancelBusyRef.current) return;
    const typeLabel = booking.kind === "RESERVATION" ? "reservation" : "checkout";
    const copy = getBookingCancelCopy(booking.kind, booking.title);
    const ok = await confirm({
      title: copy.title,
      message: copy.message,
      confirmLabel: copy.confirmLabel,
      variant: "danger",
    });
    if (!ok) return;

    cancelBusyRef.current = true;
    setCancelling(true);
    let committed = false;
    try {
      const res = await fetchWithTimeout(`/api/bookings/${booking.id}/cancel`, {
        method: "POST",
        timeoutMs: BOOKING_MUTATION_TIMEOUT_MS,
      });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        committed = true;
      } else {
        const msg = await parseErrorMessage(res, `Could not cancel the ${typeLabel}. Refresh and try again.`);
        toast.error(msg);
      }
    } catch {
      toast.error(`Could not reach the server. The ${typeLabel} was not cancelled.`);
    } finally {
      cancelBusyRef.current = false;
      setCancelling(false);
    }

    if (!committed) return;
    toast.success(copy.success);
    await fetchBooking({ silent: true });
    onUpdated?.();
  }

  /* ───── Render ───── */

  const detailHref = booking
    ? booking.kind === "CHECKOUT"
      ? `/checkouts/${booking.id}`
      : `/reservations/${booking.id}`
    : "#";

  return (
    <Sheet open={!!bookingId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="flex flex-col sm:max-w-xl">

        {/* Header */}
        <SheetHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {booking && (
                booking.custodyScope === "SHARED" ? (
                  <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <PackageOpenIcon className="size-5" aria-hidden="true" />
                  </span>
                ) : (
                  <UserAvatar
                    name={booking.requester?.name ?? "Unknown"}
                    avatarUrl={booking.requester?.avatarUrl}
                    size="md"
                    className="mt-0.5 shrink-0"
                  />
                )
              )}
              <div className="min-w-0 flex-1">
                <SheetTitle className="min-w-0 text-lg">
                  {booking ? (
                    <InlineTitle
                      value={booking.title}
                      canEdit={Boolean(canEdit)}
                      onSave={(value) => handleSaveField("title", value)}
                      saveMode="explicit"
                      className="text-lg font-semibold tracking-tight"
                      placeholder="Booking title"
                    />
                  ) : "Loading booking"}
                </SheetTitle>
                <SheetDescription className="sr-only">
                  Booking summary with timing, custody, equipment, and a link to the full booking page.
                </SheetDescription>
                {booking && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground/80">
                      {booking.custodyScope === "SHARED" ? "Shared checkout" : booking.requester?.name ?? "Unknown requester"}
                    </span>
                    <span aria-hidden="true">·</span>
                    {booking.refNumber && <span className="font-mono">{booking.refNumber}</span>}
                    {booking.refNumber && <span aria-hidden="true">·</span>}
                    <span>{booking.bookingType}</span>
                  </p>
                )}
              </div>
            </div>
            {booking && (
              <Badge
                variant={(
                  booking.isOverdue
                    ? "red"
                    : booking.kind === "CHECKOUT" && booking.isActive && isDueToday(booking.endsAt, new Date())
                      ? "orange"
                      : statusBadgeVariant(booking.status, booking.kind)
                ) as BadgeProps["variant"]}
                className="shrink-0 mt-0.5"
              >
                {booking.isOverdue ? "Overdue" : statusLabel(booking.status, booking.kind)}
              </Badge>
            )}
          </div>
        </SheetHeader>

        {/* Body — single scrollable column */}
        <SheetBody ref={sheetBodyRef} className="relative flex flex-col bg-muted/25 px-0 py-0">
          {loading ? (
            <OperationalLoadingState
              variant="sheet"
              title="Loading booking details"
              description="Keeping this sheet stable while the latest booking state loads."
              rows={5}
            />
          ) : fetchError ? (
            <EmptyState
              inline
              icon="wifi-off"
              title="Booking details could not load"
              description="Retry before taking action on this record."
              actionLabel="Retry booking"
              onAction={() => fetchBooking()}
            />
          ) : !booking ? (
            <EmptyState
              inline
              icon="clipboard"
              title="Booking not found"
              description="The booking may have been cancelled, archived, or moved since this sheet opened."
            />
          ) : equipEditMode ? (

            /* ── Equipment edit mode ── */
            <div className="px-6 py-4 flex flex-col gap-3 flex-1">
              {optionsError && (
                <Alert variant="destructive">
                  <AlertDescription className="flex items-center justify-between">
                    <span>Equipment options could not load. Retry before saving equipment changes.</span>
                    <Button className="h-10" variant="outline" onClick={loadFormOptions}>Retry</Button>
                  </AlertDescription>
                </Alert>
              )}
              {conflictError?.conflicts && conflictError.conflicts.length > 0 && (
                <Alert variant="destructive">
                  <AlertDescription>
                    <strong className="block mb-1">Scheduling conflict</strong>
                    {conflictError.conflicts.map((c, i) => (
                      <div key={i} className="text-xs">
                        {c.conflictingBookingTitle ? `"${c.conflictingBookingTitle}"` : "Another booking"}
                      </div>
                    ))}
                  </AlertDescription>
                </Alert>
              )}
              <EquipmentPicker
                bulkSkus={bulkSkus as unknown as PickerBulkSku[]}
                selectedAssetIds={editSerializedIds}
                setSelectedAssetIds={setEditSerializedIds}
                selectedBulkItems={editBulkItems.map((bi) => ({ bulkSkuId: bi.bulkSkuId, quantity: bi.quantity }))}
                setSelectedBulkItems={(updater) => {
                  if (typeof updater === "function") {
                    setEditBulkItems((prev) => {
                      const result = updater(prev.map((bi) => ({ bulkSkuId: bi.bulkSkuId, quantity: bi.quantity })));
                      return result;
                    });
                  } else {
                    setEditBulkItems(updater);
                  }
                }}
                startsAt={booking.startsAt}
                endsAt={booking.endsAt}
                locationId={booking.location.id}
                excludeBookingId={booking.id}
                bookingKind={booking.kind === "CHECKOUT" ? "CHECKOUT" : "RESERVATION"}
              />
              <div className="flex gap-2">
                <Button loading={equipSaving} onClick={handleEquipSave}>
                  Save equipment
                </Button>
                <Button variant="outline" onClick={() => { setEquipEditMode(false); setConflictError(null); }}>
                  Cancel
                </Button>
              </div>
            </div>

          ) : (

            /* ── Summary view ── */
            <>
              {/* ─ Details section ─ */}
              <div ref={detailsSectionRef} data-booking-sheet-section="details" className="border-b border-border/40 p-4 sm:p-5">
                <div className="flex flex-col gap-4">
                  {conflictError?.conflicts && conflictError.conflicts.length > 0 && (
                    <Alert variant="destructive">
                      <TriangleAlert className="size-4" />
                      <AlertDescription>
                        <strong className="block mb-1">Scheduling conflict</strong>
                        {conflictError.conflicts.map((c, i) => (
                          <div key={i} className="text-xs">
                            {c.conflictingBookingTitle ? `"${c.conflictingBookingTitle}"` : "Another booking"}
                          </div>
                        ))}
                      </AlertDescription>
                    </Alert>
                  )}
                  {checkinProgress && checkinProgress.returned > 0 && (
                    <div className="flex items-center gap-3 px-1">
                      <Progress value={checkinProgress.percent} className="flex-1 h-2" />
                      <span className="text-xs text-muted-foreground whitespace-nowrap font-medium">
                        {checkinProgress.returned}/{checkinProgress.total} returned
                      </span>
                    </div>
                  )}
                  <BookingSheetOverview
                    booking={booking}
                    canEdit={Boolean(canEdit)}
                    onSaveField={handleSaveField}
                  />
                </div>
              </div>

              {/* ─ Equipment section ─ */}
              <div ref={equipmentSectionRef} data-booking-sheet-section="equipment" className="bg-background/70">
                <SectionHead
                  label="Equipment"
                  count={totalEquipItems}
                  right={
                    canEditEquipment ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 px-3 text-xs"
                        onClick={enterEquipEditMode}
                      >
                        Edit equipment
                      </Button>
                    ) : undefined
                  }
                />

                <div className="px-5 pb-5 pt-2 sm:px-6">
                  <BookingItems
                    booking={booking}
                    equipSearch={equipSearch}
                    onEquipSearchChange={setEquipSearch}
                    filteredSerializedItems={filteredSerializedItems}
                    filteredBulkItems={filteredBulkItems}
                    canEditEquipment={false}
                    canCheckin={false}
                    checkinLoading={false}
                    onEnterEquipEditMode={enterEquipEditMode}
                  />
                </div>
              </div>
            </>
          )}
        </SheetBody>

        {/* Footer */}
        {booking && !equipEditMode && (
          <SheetFooter className="bg-background/95 backdrop-blur-sm">
            <div className="flex w-full items-center gap-2">
              <div className="flex-1" />
              <Button variant="outline" className="h-10" asChild>
                <Link href={detailHref}>
                  Open full booking <ExternalLinkIcon data-icon="inline-end" />
                </Link>
              </Button>
              {(canTransferOwner || canEditEvents || canCancel) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="size-10" aria-label="More booking actions">
                      <MoreHorizontalIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    {canTransferOwner && (
                      <DropdownMenuItem onSelect={() => setTransferOwnerOpen(true)}>
                        <UserRoundCogIcon />
                        Transfer owner
                      </DropdownMenuItem>
                    )}
                    {canEditEvents && (
                      <DropdownMenuItem onSelect={() => setEditEventsOpen(true)}>
                        <CalendarRangeIcon />
                        Edit events
                      </DropdownMenuItem>
                    )}
                    {canCancel && (canTransferOwner || canEditEvents) && <DropdownMenuSeparator />}
                    {canCancel && (
                      <DropdownMenuItem variant="destructive" onSelect={handleCancel} disabled={cancelling}>
                        {cancelling ? <Spinner /> : <XCircleIcon />}
                        Cancel booking
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </SheetFooter>
        )}
      </SheetContent>
      {booking && (
        <TransferOwnerDialog
          open={transferOwnerOpen}
          booking={booking}
          onOpenChange={setTransferOwnerOpen}
          onTransferred={(updated) => {
            setBooking(updated);
            onUpdated?.();
          }}
        />
      )}
      {booking && (
        <EditBookingEventsDialog
          open={editEventsOpen}
          booking={booking}
          onOpenChange={setEditEventsOpen}
          onUpdated={(updated) => {
            setBooking(updated);
            onUpdated?.();
          }}
        />
      )}
    </Sheet>
  );
}
