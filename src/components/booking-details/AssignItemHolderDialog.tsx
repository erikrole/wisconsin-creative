"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BOOKING_CHANGE_SYNC_EVENT } from "@/hooks/use-booking-change-sync";
import { BOOKING_SNAPSHOT_HEADER } from "@/lib/booking-snapshot-header";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { BOOKING_MUTATION_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { TRANSFER_DIALOG_CLASS, TRANSFER_HEADER_CLASS, TransferPicker, useTransferRoster } from "./TransferPicker";
import type { BookingDetail, SerializedItem } from "./types";

type ApiEnvelope<T> = {
  data?: T;
  error?: string;
  transfer?: { targetBookingId: string; targetRefNumber: string | null; targetUserName: string };
};

type Props = {
  open: boolean;
  booking: BookingDetail;
  item: SerializedItem | null;
  onOpenChange: (open: boolean) => void;
  onUpdated: (booking: BookingDetail) => void;
};

export function AssignItemHolderDialog({
  open,
  booking,
  item,
  onOpenChange,
  onUpdated,
}: Props) {
  const router = useRouter();
  const { users, loading, error: usersError } = useTransferRoster(open);
  const [targetValue, setTargetValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setTargetValue("");
      setReason("");
      setSaving(false);
      busyRef.current = false;
    }
  }, [open]);

  const currentValue = booking.custodyScope === "PERSON" ? booking.requester.id : "";

  async function handleSave() {
    if (!item || !targetValue || targetValue === currentValue || busyRef.current) return;
    busyRef.current = true;
    setSaving(true);

    let updated: BookingDetail;
    let transfer: NonNullable<ApiEnvelope<BookingDetail>["transfer"]>;
    try {
      const res = await fetchWithTimeout(
        `/api/bookings/${booking.id}/serialized-items/${item.id}/holder`,
        {
          method: "POST",
          timeoutMs: BOOKING_MUTATION_TIMEOUT_MS,
          headers: {
            "Content-Type": "application/json",
            [BOOKING_SNAPSHOT_HEADER]: new Date(booking.updatedAt).toISOString(),
          },
          body: JSON.stringify({
            targetUserId: targetValue,
            reason: reason.trim() || undefined,
          }),
        },
      );

      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const message = await parseErrorMessage(res, "Could not transfer this item. Refresh and try again.");
        toast.error(message);
        return;
      }

      const json = await parseJsonSafely<ApiEnvelope<BookingDetail>>(res);
      if (!json?.data || !json.transfer) {
        toast.error("The transfer response was incomplete. Refresh to check where the item is now.");
        return;
      }
      updated = json.data;
      transfer = json.transfer;
    } catch {
      toast.error("Could not confirm the transfer. Refresh to check where the item is now before trying again.");
      return;
    } finally {
      busyRef.current = false;
      setSaving(false);
    }

    toast.success(`${item.asset.assetTag} moved to ${transfer.targetUserName}'s checkout`, {
      action: {
        label: transfer.targetRefNumber ?? "View checkout",
        onClick: () => router.push(`/checkouts/${transfer.targetBookingId}`),
      },
    });
    window.dispatchEvent(new CustomEvent(BOOKING_CHANGE_SYNC_EVENT, {
      detail: { changedBookingIds: [booking.id, transfer.targetBookingId] },
    }));
    onUpdated(updated);
    onOpenChange(false);
  }

  const holder = booking.custodyScope === "PERSON"
    ? { name: booking.requester.name, avatarUrl: booking.requester.avatarUrl }
    : { name: "Shared checkout", avatarUrl: null };
  const tag = item?.asset.assetTag ?? "this item";

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (saving) return;
      onOpenChange(nextOpen);
    }}>
      <DialogContent className={TRANSFER_DIALOG_CLASS}>
        <DialogHeader className={TRANSFER_HEADER_CLASS}>
          <DialogTitle>Transfer {tag}</DialogTitle>
          <DialogDescription>
            It moves to the receiving person&apos;s matching checkout, or a new one with the same event and due time. Scan history stays on the original.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <TransferPicker
            from={holder}
            fromCaption="Has it now"
            users={users}
            loading={loading}
            error={usersError}
            excludeId={currentValue}
            value={targetValue}
            onChange={setTargetValue}
            reason={reason}
            onReasonChange={setReason}
            disabled={saving}
            consequence="They get a notification with the due time. The current holder is told it's off their record."
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!item || !targetValue || targetValue === currentValue || saving || loading || usersError}
            loading={saving}
          >
            Transfer item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
