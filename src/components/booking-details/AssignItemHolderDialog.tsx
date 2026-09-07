"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/UserAvatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BOOKING_CHANGE_SYNC_EVENT } from "@/hooks/use-booking-change-sync";
import { BOOKING_SNAPSHOT_HEADER } from "@/lib/booking-concurrency";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { BOOKING_MUTATION_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch-with-timeout";
import type { BookingDetail, SerializedItem } from "./types";

type PickerUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
  active: boolean;
  hiddenFromRoster?: boolean;
};

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
  const [users, setUsers] = useState<PickerUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState(false);
  const [targetValue, setTargetValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setTargetValue("");

    const controller = new AbortController();
    setLoadingUsers(true);
    setUsersError(false);

    fetchWithTimeout("/api/users?limit=200&active=true&sort=name", {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (handleAuthRedirect(res)) return;
        if (!res.ok) {
          setUsersError(true);
          return;
        }
        const json = await parseJsonSafely<ApiEnvelope<PickerUser[]>>(res);
        setUsers((json?.data ?? []).filter((user) => user.active && !user.hiddenFromRoster));
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setUsersError(true);
      })
      .finally(() => setLoadingUsers(false));

    return () => controller.abort();
  }, [item?.assignedUserId, open]);

  useEffect(() => {
    if (!open) {
      setTargetValue("");
      setReason("");
      setUsersError(false);
      setSaving(false);
      busyRef.current = false;
    }
  }, [open]);

  const inheritedLabel = booking.custodyScope === "SHARED"
    ? "Shared checkout"
    : booking.requester.name;
  const currentValue = booking.custodyScope === "PERSON" ? booking.requester.id : "";
  const selectedUser = users.find((user) => user.id === targetValue);
  const options = useMemo<ComboboxOption[]>(() => users
    .filter((user) => user.id !== currentValue)
    .map((user) => ({
      value: user.id,
      label: user.name,
      keywords: [user.name, user.email, user.role],
    })), [currentValue, users]);

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
        onClick: () => window.location.assign(`/checkouts/${transfer.targetBookingId}`),
      },
    });
    window.dispatchEvent(new CustomEvent(BOOKING_CHANGE_SYNC_EVENT, {
      detail: { changedBookingIds: [booking.id, transfer.targetBookingId] },
    }));
    onUpdated(updated);
    onOpenChange(false);
  }

  const currentHolderName = inheritedLabel;
  const currentHolderAvatar = booking.custodyScope === "PERSON" ? booking.requester.avatarUrl : null;
  const nextHolderName = selectedUser?.name ?? "Select a person";
  const nextHolderAvatar = selectedUser?.avatarUrl;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (saving) return;
      onOpenChange(nextOpen);
    }}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
              <PackageCheck className="size-4 text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1">
              <DialogTitle>Transfer item ownership</DialogTitle>
              <DialogDescription>
                Move {item?.asset.assetTag ?? "this item"} to the receiving person’s matching checkout, or create one with the same event and return deadline. Original scan history is preserved.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3">
            <UserAvatar name={currentHolderName} avatarUrl={currentHolderAvatar} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{currentHolderName}</p>
              <p className="truncate text-xs text-muted-foreground">Current checkout</p>
            </div>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            <UserAvatar name={nextHolderName} avatarUrl={nextHolderAvatar} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{nextHolderName}</p>
              <p className="truncate text-xs text-muted-foreground">Receiving owner</p>
            </div>
          </div>

          {usersError && (
            <Alert variant="destructive">
              <AlertDescription>Users could not load. Retry before transferring the item.</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="booking-item-holder">Receiving owner</Label>
            <Combobox
              id="booking-item-holder"
              value={targetValue}
              onValueChange={setTargetValue}
              options={options}
              placeholder={loadingUsers ? "Loading users..." : "Select a person"}
              searchPlaceholder="Search users"
              emptyMessage={loadingUsers ? "Loading users..." : "No active user found."}
              disabled={saving || loadingUsers || usersError}
              renderOption={(option) => {
                const user = users.find((candidate) => candidate.id === option.value);
                return user ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="xs" />
                    <span className="min-w-0">
                      <span className="block truncate">{user.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                    </span>
                  </span>
                ) : option.label;
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="booking-item-holder-reason">Note</Label>
            <Textarea
              id="booking-item-holder-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="Optional handoff context"
              disabled={saving}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!item || !targetValue || targetValue === currentValue || saving || loadingUsers || usersError}
            loading={saving}
          >
            Transfer item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
