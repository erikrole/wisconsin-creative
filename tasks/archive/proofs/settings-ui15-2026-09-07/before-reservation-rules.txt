"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/EmptyState";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, isAbortError, parseErrorMessage } from "@/lib/errors";
import { SettingsPageShell } from "../SettingsPageShell";
import type { ReservationRules } from "@/lib/services/reservation-rules";

type FormState = {
  advanceWindowDays: string;
  noShowExpiryHours: string;
  maxConcurrentReservations: string;
};

function toForm(r: ReservationRules): FormState {
  return {
    advanceWindowDays: r.advanceWindowDays === null ? "" : String(r.advanceWindowDays),
    noShowExpiryHours: String(r.noShowExpiryHours),
    maxConcurrentReservations: r.maxConcurrentReservations === null ? "" : String(r.maxConcurrentReservations),
  };
}

function isDirty(a: FormState, b: FormState): boolean {
  return a.advanceWindowDays !== b.advanceWindowDays
    || a.noShowExpiryHours !== b.noShowExpiryHours
    || a.maxConcurrentReservations !== b.maxConcurrentReservations;
}

export default function ReservationRulesPage() {
  const { data, loading, error, reload } = useFetch<ReservationRules>({
    url: "/api/settings/reservation-rules",
    returnTo: "/settings/reservation-rules",
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [base, setBase] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [errors, setErrors] = useState<Partial<FormState>>({});

  useEffect(() => {
    if (data && !base) {
      const f = toForm(data);
      setForm(f);
      setBase(f);
    }
  }, [data, base]);

  function setField(key: keyof FormState, value: string) {
    setForm((prev) => prev ? { ...prev, [key]: value } : prev);
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate(): boolean {
    if (!form) return false;
    const e: Partial<FormState> = {};
    if (form.advanceWindowDays !== "") {
      const days = Number(form.advanceWindowDays);
      if (!Number.isInteger(days) || days < 1 || days > 730) {
        e.advanceWindowDays = "Must be a whole number between 1 and 730, or leave blank for no limit.";
      }
    }
    const expiry = Number(form.noShowExpiryHours);
    if (isNaN(expiry) || expiry < 1 || expiry > 336) {
      e.noShowExpiryHours = "Must be between 1 and 336 hours (14 days).";
    }
    if (form.maxConcurrentReservations !== "") {
      const max = Number(form.maxConcurrentReservations);
      if (!Number.isInteger(max) || max < 1 || max > 50) {
        e.maxConcurrentReservations = "Must be a whole number between 1 and 50, or leave blank for no limit.";
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!form || !validate()) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const payload: ReservationRules = {
        advanceWindowDays: form.advanceWindowDays === "" ? null : Number(form.advanceWindowDays),
        noShowExpiryHours: Number(form.noShowExpiryHours),
        maxConcurrentReservations: form.maxConcurrentReservations === "" ? null : Number(form.maxConcurrentReservations),
      };
      const res = await fetch("/api/settings/reservation-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) { handleAuthRedirect(res, "/settings/reservation-rules"); return; }
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to save reservation rules.");
        toast.error(msg);
        return;
      }
      toast.success("Reservation rules saved.");
      setBase(form);
    } catch (err) {
      if (isAbortError(err)) return;
      toast.error("Could not reach the server. Check your connection.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const dirty = form && base ? isDirty(form, base) : false;

  if (loading) {
    return (
      <SettingsPageShell title="Reservation Rules" description="Advance booking window, no-show expiry, and concurrent reservation cap.">
        <Skeleton className="h-64 w-full rounded-lg" />
      </SettingsPageShell>
    );
  }

  if (error || !form) {
    return (
      <SettingsPageShell title="Reservation Rules" description="Advance booking window, no-show expiry, and concurrent reservation cap.">
        <EmptyState
          inline
          icon={error === "network" ? "wifi-off" : "calendar"}
          title={error === "network" ? "You are offline" : "Could not load reservation rules"}
          description={error === "network" ? "Check your connection and retry." : "Retry before changing reservation constraints."}
          actionLabel="Retry"
          onAction={reload}
        />
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title="Reservation Rules" description="Advance booking window, no-show expiry, and concurrent reservation cap.">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Booking constraints</CardTitle>
          <CardDescription>These apply to all new reservations. Existing reservations are not affected.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Advance window */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rr-advance">Advance booking window (days)</Label>
            <Input
              id="rr-advance"
              name="advanceWindowDays"
              type="number"
              min={1}
              max={730}
              value={form.advanceWindowDays}
              onChange={(e) => setField("advanceWindowDays", e.target.value)}
              placeholder="No limit"
              aria-invalid={!!errors.advanceWindowDays}
              className="max-w-48"
              disabled={saving}
            />
            {errors.advanceWindowDays
              ? <p className="text-xs text-destructive">{errors.advanceWindowDays}</p>
              : <p className="text-xs text-muted-foreground">Reservations cannot start more than this many days in the future. Leave blank for no limit.</p>
            }
          </div>

          {/* No-show expiry */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rr-expiry">No-show expiry (hours)</Label>
            <Input
              id="rr-expiry"
              name="noShowExpiryHours"
              type="number"
              min={1}
              max={336}
              value={form.noShowExpiryHours}
              onChange={(e) => setField("noShowExpiryHours", e.target.value)}
              aria-invalid={!!errors.noShowExpiryHours}
              className="max-w-48"
              disabled={saving}
            />
            {errors.noShowExpiryHours
              ? <p className="text-xs text-destructive">{errors.noShowExpiryHours}</p>
              : <p className="text-xs text-muted-foreground">A reservation becomes Pending Pickup at its scheduled start. If pickup does not happen within this window, the reservation is automatically cancelled and its gear is released.</p>
            }
          </div>

          {/* Max concurrent */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rr-max-concurrent">Max active reservations per user</Label>
            <Input
              id="rr-max-concurrent"
              name="maxConcurrentReservations"
              type="number"
              min={1}
              max={50}
              value={form.maxConcurrentReservations}
              onChange={(e) => setField("maxConcurrentReservations", e.target.value)}
              placeholder="No limit"
              aria-invalid={!!errors.maxConcurrentReservations}
              className="max-w-48"
              disabled={saving}
            />
            {errors.maxConcurrentReservations
              ? <p className="text-xs text-destructive">{errors.maxConcurrentReservations}</p>
              : <p className="text-xs text-muted-foreground">Counts Booked reservations. Leave blank for no limit.</p>
            }
          </div>

          <div className="flex justify-end pt-1">
            <Button onClick={handleSave} disabled={!dirty || saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </SettingsPageShell>
  );
}
