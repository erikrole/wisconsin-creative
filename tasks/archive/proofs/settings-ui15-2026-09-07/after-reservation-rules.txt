"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
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

  const [saveError, setSaveError] = useState<string | null>(null);
  const formElement = useRef<HTMLFormElement>(null);
  const lastData = useRef<typeof data>(undefined);
  const dirty = form && base ? isDirty(form, base) : false;

  useEffect(() => {
    if (!data || data === lastData.current) return;
    lastData.current = data;
    // Background reads may update a clean form, but must never replace a draft.
    if (dirty || saving) return;
    const next = toForm(data);
    setForm(next);
    setBase(next);
  }, [data, dirty, saving]);

  useEffect(() => {
    if (!dirty && !saving) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty, saving]);

  function resetChanges() {
    setForm(base);
    setErrors({});
    setSaveError(null);
  }

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
    const firstInvalid = Object.keys(e)[0];
    if (firstInvalid) {
      const input = formElement.current?.elements.namedItem(firstInvalid);
      if (input instanceof HTMLInputElement) input.focus();
    }
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!form || !dirty || !validate()) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
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
        setSaveError(msg);
        toast.error(msg);
        return;
      }
      toast.success("Reservation rules saved.");
      setBase(form);
    } catch (err) {
      if (isAbortError(err)) return;
      setSaveError("Could not reach the server. Check your connection and try saving again.");
      toast.error("Could not reach the server. Check your connection.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (loading && !form) {
    return (
      <SettingsPageShell title="Reservation Rules" description="Advance booking window, no-show expiry, and concurrent reservation cap.">
        <Skeleton className="h-64 w-full rounded-lg" />
      </SettingsPageShell>
    );
  }

  if (!form) {
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
      {error && (
        <Alert className="mb-4">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Could not refresh settings. Your values are still shown.</span>
            <Button type="button" variant="outline" className="h-10" onClick={reload}>Retry refresh</Button>
          </AlertDescription>
        </Alert>
      )}
      <form ref={formElement} noValidate onSubmit={(event) => { event.preventDefault(); void handleSave(); }}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Booking constraints</CardTitle>
            <CardDescription>Booking limits apply to new reservations. No-show expiry also controls when uncollected reservations are cancelled.</CardDescription>
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
                aria-describedby="advanceWindowDays-help"
                className="h-10 max-w-48"
                disabled={saving}
              />
              <p id="advanceWindowDays-help" aria-live="polite" className={errors.advanceWindowDays ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {errors.advanceWindowDays ?? "Reservations cannot start more than this many days in the future. Leave blank for no limit."}
              </p>
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
                aria-describedby="noShowExpiryHours-help"
                className="h-10 max-w-48"
                disabled={saving}
              />
              <p id="noShowExpiryHours-help" aria-live="polite" className={errors.noShowExpiryHours ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {errors.noShowExpiryHours ?? "A reservation becomes Pending Pickup at its scheduled start. If pickup does not happen within this window, the reservation is automatically cancelled and its gear is released."}
              </p>
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
                aria-describedby="maxConcurrentReservations-help"
                className="h-10 max-w-48"
                disabled={saving}
              />
              <p id="maxConcurrentReservations-help" aria-live="polite" className={errors.maxConcurrentReservations ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {errors.maxConcurrentReservations ?? "Counts Booked reservations. Leave blank for no limit."}
              </p>
            </div>

            {saveError && <Alert variant="destructive"><AlertDescription>{saveError}</AlertDescription></Alert>}
            <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
              <p role="status" className="mr-auto text-sm text-muted-foreground">
                {saving ? "Saving changes…" : dirty ? "Unsaved changes" : "All changes saved"}
              </p>
              <Button type="button" variant="outline" className="h-10" onClick={resetChanges} disabled={!dirty || saving}>Reset changes</Button>
              <Button type="submit" className="h-10" disabled={!dirty || saving} aria-busy={saving}>
                {saving && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                {dirty ? "Save changes" : "Saved"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </SettingsPageShell>
  );
}
