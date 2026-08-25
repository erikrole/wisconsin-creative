"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, UserRoundPen } from "lucide-react";
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
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { BOOKING_MUTATION_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch-with-timeout";
import type { BookingDetail } from "./types";

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
};

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
  const [users, setUsers] = useState<PickerUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState(false);
  const [targetUserId, setTargetUserId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!open) return;

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
  }, [open]);

  useEffect(() => {
    if (!open) {
      setTargetUserId("");
      setReason("");
      setUsersError(false);
      setSaving(false);
      busyRef.current = false;
    }
  }, [open]);

  const selectedUser = users.find((user) => user.id === targetUserId);
  const options = useMemo<ComboboxOption[]>(
    () =>
      users.map((user) => ({
        value: user.id,
        label: user.name,
        keywords: [user.name, user.email, user.role],
        disabled: user.id === booking.requester.id,
      })),
    [booking.requester.id, users],
  );

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
          "If-Unmodified-Since": new Date(booking.updatedAt).toUTCString(),
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

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (saving) return;
      onOpenChange(nextOpen);
    }}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
              <UserRoundPen className="size-4 text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1">
              <DialogTitle>Transfer owner</DialogTitle>
              <DialogDescription>
                Changes the booking requester while keeping the original creator and activity history intact.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3">
            <UserAvatar
              name={booking.requester.name}
              avatarUrl={booking.requester.avatarUrl}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{booking.requester.name}</p>
              <p className="truncate text-xs text-muted-foreground">{booking.requester.email}</p>
            </div>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            {selectedUser ? (
              <>
                <UserAvatar
                  name={selectedUser.name}
                  avatarUrl={selectedUser.avatarUrl}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{selectedUser.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{selectedUser.email}</p>
                </div>
              </>
            ) : (
              <div className="min-w-0 flex-1 text-sm text-muted-foreground">Select new owner</div>
            )}
          </div>

          {usersError && (
            <Alert variant="destructive">
              <AlertDescription>Users could not load. Retry before transferring ownership.</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="booking-transfer-owner">New owner</Label>
            <Combobox
              id="booking-transfer-owner"
              value={targetUserId}
              onValueChange={setTargetUserId}
              options={options}
              placeholder={loadingUsers ? "Loading users..." : "Select a user"}
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
            <Label htmlFor="booking-transfer-reason">Note</Label>
            <Textarea
              id="booking-transfer-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="Optional"
              disabled={saving}
            />
          </div>
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
