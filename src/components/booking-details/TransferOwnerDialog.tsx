"use client";

import { useEffect, useRef, useState } from "react";
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
import type { BookingDetail } from "./types";

type ApiEnvelope<T> = { data?: T; error?: string };

type Props = {
  open: boolean;
  booking: BookingDetail;
  onOpenChange: (open: boolean) => void;
  onTransferred: (booking: BookingDetail) => void;
};

export function TransferOwnerDialog({
  open,
  booking,
  onOpenChange,
  onTransferred,
}: Props) {
  const { users, loading, error: usersError } = useTransferRoster(open);
  const [targetUserId, setTargetUserId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setTargetUserId("");
      setReason("");
      setSaving(false);
      busyRef.current = false;
    }
  }, [open]);

  async function handleTransfer() {
    if (!targetUserId || targetUserId === booking.requester.id || busyRef.current) return;
    busyRef.current = true;
    setSaving(true);

    let updated: BookingDetail;
    try {
      const res = await fetchWithTimeout(`/api/bookings/${booking.id}/transfer-owner`, {
        method: "POST",
        timeoutMs: BOOKING_MUTATION_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          [BOOKING_SNAPSHOT_HEADER]: new Date(booking.updatedAt).toISOString(),
        },
        body: JSON.stringify({
          targetUserId,
          reason: reason.trim() || undefined,
        }),
      });

      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Could not transfer ownership. Refresh and try again.");
        toast.error(msg);
        return;
      }

      const json = await parseJsonSafely<ApiEnvelope<BookingDetail>>(res);
      if (!json?.data) {
        toast.error("Ownership changed, but the refreshed booking did not load.");
        return;
      }
      updated = json.data;
    } catch {
      toast.error("Could not reach the server. Ownership was not transferred.");
      return;
    } finally {
      busyRef.current = false;
      setSaving(false);
    }

    toast.success(`Transferred to ${updated.requester.name}`);
    window.dispatchEvent(new CustomEvent(BOOKING_CHANGE_SYNC_EVENT, {
      detail: { changedBookingIds: [booking.id] },
    }));
    onTransferred(updated);
    onOpenChange(false);
  }

  const isCheckout = booking.kind === "CHECKOUT";
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (saving) return;
      onOpenChange(nextOpen);
    }}>
      <DialogContent className={TRANSFER_DIALOG_CLASS}>
        <DialogHeader className={TRANSFER_HEADER_CLASS}>
          <DialogTitle>Transfer owner</DialogTitle>
          <DialogDescription>
            The new owner takes over this {isCheckout ? "checkout" : "booking"}. The original creator and history stay as they were.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <TransferPicker
            from={booking.requester}
            fromCaption="Current owner"
            users={users}
            loading={loading}
            error={usersError}
            excludeId={booking.requester.id}
            value={targetUserId}
            onChange={setTargetUserId}
            reason={reason}
            onReasonChange={setReason}
            disabled={saving}
            consequence={isCheckout
              ? "They get a notification with the due time, and it comes off the current owner's record."
              : "They get a notification, and it moves off the current owner's bookings."}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleTransfer}
            disabled={!targetUserId || targetUserId === booking.requester.id || saving || usersError}
            loading={saving}
          >
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
