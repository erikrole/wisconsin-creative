"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { toast } from "sonner";
import { BOOKING_MUTATION_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { getBookingCancelCopy } from "@/hooks/booking-action-copy";
import { BOOKING_SNAPSHOT_HEADER } from "@/lib/booking-concurrency";
import type { BookingDetail } from "@/components/booking-details/types";

type ActionResult = { ok: boolean; error?: string };
type BookingMutationResponse = { data?: BookingDetail };

async function callAction(
  url: string,
  method: "POST" | "PATCH" = "POST",
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<ActionResult> {
  try {
    const res = await fetchWithTimeout(url, {
      method,
      timeoutMs: BOOKING_MUTATION_TIMEOUT_MS,
      ...(body || extraHeaders
        ? {
            headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...extraHeaders },
            ...(body ? { body: JSON.stringify(body) } : {}),
          }
        : {}),
    });
    if (handleAuthRedirect(res)) {
      return { ok: false, error: "Session expired" };
    }
    if (res.status === 409) {
      const msg = await parseErrorMessage(res, "This booking was modified by someone else. Please refresh and try again.");
      return { ok: false, error: msg };
    }
    if (!res.ok) {
      const msg = await parseErrorMessage(res, "Action failed");
      return { ok: false, error: msg };
    }
    const json = await parseJsonSafely<object>(res);
    return { ok: true, ...(json ?? {}) };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, error: "Request timed out \u2014 please try again." };
    }
    return { ok: false, error: "Network error \u2014 please try again." };
  }
}

export function useBookingActions(
  bookingId: string,
  kind: "CHECKOUT" | "RESERVATION",
  onSuccess: () => void,
  updatedAt?: string | null,
) {
  const router = useRouter();
  const confirm = useConfirm();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const busyRef = useRef(false);

  /** Synchronous ref guard — prevents double-submit across all actions */
  function guardStart(key: string): boolean {
    if (busyRef.current) return false;
    busyRef.current = true;
    setActionLoading(key);
    return true;
  }
  function guardEnd() {
    busyRef.current = false;
    setActionLoading(null);
  }

  const cancel = useCallback(async () => {
    const copy = getBookingCancelCopy(kind);
    const ok = await confirm({
      title: copy.title,
      message: copy.message,
      confirmLabel: copy.confirmLabel,
      variant: "danger",
    });
    if (!ok) return;
    if (!guardStart("cancel")) return;
    try {
      const result = await callAction(`/api/bookings/${bookingId}/cancel`);
      if (result.ok) {
        toast.success(copy.success);
        onSuccess();
      } else {
        toast.error(result.error!);
      }
    } finally {
      guardEnd();
    }
  }, [bookingId, kind, confirm, onSuccess]);

  const extend = useCallback(
    async (endsAt: string) => {
      if (!guardStart("extend")) return false;
      try {
        const extraHeaders = updatedAt
          ? { [BOOKING_SNAPSHOT_HEADER]: new Date(updatedAt).toISOString() }
          : undefined;
        const result = await callAction(
          `/api/bookings/${bookingId}/extend`,
          "POST",
          { endsAt: new Date(endsAt).toISOString() },
          extraHeaders,
        );
        if (result.ok) {
          const d = new Date(endsAt);
          const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          toast.success(`Extended to ${formatted}`);
          onSuccess();
        } else {
          toast.error(result.error!);
        }
        return result.ok;
      } finally {
        guardEnd();
      }
    },
    [bookingId, onSuccess, updatedAt],
  );

  const duplicate = useCallback(async () => {
    if (!guardStart("duplicate")) return;
    try {
      router.push(`/reservations/new?reuseFrom=${encodeURIComponent(bookingId)}`);
    } finally {
      guardEnd();
    }
  }, [bookingId, router]);

  const nudge = useCallback(async () => {
    if (!guardStart("nudge")) return;
    try {
      const result = await callAction(`/api/bookings/${bookingId}/nudge`);
      if (result.ok) {
        toast.success("Nudge notification sent");
      } else {
        toast.error(result.error!);
      }
    } finally {
      guardEnd();
    }
  }, [bookingId]);

  const forceComplete = useCallback(
    async (reason: string) => {
      if (!guardStart("force-complete")) return false;
      try {
        const result = await callAction(`/api/bookings/${bookingId}/force-complete`, "POST", { reason });
        if (result.ok) {
          toast.success("Checkout closed");
          onSuccess();
        } else {
          toast.error(result.error!);
        }
        return result.ok;
      } finally {
        guardEnd();
      }
    },
    [bookingId, onSuccess],
  );

  const forceCheckout = useCallback(
    async (reason: string) => {
      if (!guardStart("force-checkout")) return false;
      try {
        const result = await callAction(
          `/api/reservations/${bookingId}/force-checkout`,
          "POST",
          { reason },
        );
        if (result.ok) {
          toast.success("Reservation force-checked out");
          onSuccess();
        } else {
          toast.error(result.error!);
        }
        return result.ok;
      } finally {
        guardEnd();
      }
    },
    [bookingId, onSuccess],
  );

  const saveField = useCallback(
    async (field: string, value: unknown): Promise<BookingDetail> => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (updatedAt) headers[BOOKING_SNAPSHOT_HEADER] = new Date(updatedAt).toISOString();
      const res = await fetchWithTimeout(`/api/bookings/${bookingId}`, {
        method: "PATCH",
        timeoutMs: BOOKING_MUTATION_TIMEOUT_MS,
        headers,
        body: JSON.stringify({ [field]: value }),
      });
      if (handleAuthRedirect(res)) {
        throw new DOMException("Auth redirect", "AbortError");
      }
      if (!res.ok) {
        const message = await parseErrorMessage(
          res,
          res.status === 409
            ? "This booking was modified by someone else. Please refresh."
            : "Save failed",
        );
        throw new Error(message);
      }
      const json = await parseJsonSafely<BookingMutationResponse>(res);
      if (!json?.data) {
        throw new Error("Booking saved, but the refreshed booking was unavailable. Reload and try again.");
      }
      return json.data;
    },
    [bookingId, updatedAt],
  );

  return {
    actionLoading,
    cancel,
    extend,
    duplicate,
    nudge,
    forceComplete,
    forceCheckout,
    saveField,
  };
}
