"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/EmptyState";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, isAbortError, parseErrorMessage } from "@/lib/errors";
import { SettingsGroup, SettingsRow } from "../_components/SettingsGroup";
import { SettingsPageShell } from "../SettingsPageShell";
import { SettingsSaveBar } from "../_components/SettingsSaveBar";
import type { ReservationRules } from "@/lib/services/reservation-rules";
import { isDirty } from "@/lib/utils";

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
  const [lastData, setLastData] = useState<typeof data>(null);
  const dirty = form && base ? isDirty(form, base) : false;

  if (data && data !== lastData) {
    setLastData(data);
    // Background reads may update a clean form, but must never replace a draft.
    if (!dirty && !saving) {
      const next = toForm(data);
      setForm(next);
      setBase(next);
    }
  }

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
      <SettingsPageShell href="/settings/reservation-rules">
        <Skeleton className="h-64 w-full rounded-lg" />
      </SettingsPageShell>
    );
  }

  if (!form) {
    return (
      <SettingsPageShell href="/settings/reservation-rules">
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
    <SettingsPageShell href="/settings/reservation-rules">
      {error && (
        <Alert className="mb-4">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Could not refresh settings. Your values are still shown.</span>
            <Button type="button" variant="outline" className="h-10" onClick={reload}>Retry refresh</Button>
          </AlertDescription>
        </Alert>
      )}
      <form ref={formElement} noValidate onSubmit={(event) => { event.preventDefault(); void handleSave(); }}>
        <div className="flex flex-col gap-4">
        <SettingsGroup
          title="Booking constraints"
          description="Limits apply to new reservations. No-show expiry also decides when uncollected reservations are cancelled."
        >
          <SettingsRow
            label="Advance booking window (days)"
            htmlFor="rr-advance"
            descriptionId="advanceWindowDays-help"
            invalid={!!errors.advanceWindowDays}
            description={errors.advanceWindowDays ?? "How far ahead a reservation can start. Leave blank for no limit."}
          >
            <Input
              id="rr-advance"
              name="advanceWindowDays"
              type="number"
              min={1}
              max={730}
              placeholder="No limit"
              value={form.advanceWindowDays}
              onChange={(e) => setField("advanceWindowDays", e.target.value)}
              aria-invalid={!!errors.advanceWindowDays}
              aria-describedby="advanceWindowDays-help"
              className="h-10"
              disabled={saving}
            />
          </SettingsRow>
          <SettingsRow
            label="No-show expiry (hours)"
            htmlFor="rr-expiry"
            descriptionId="noShowExpiryHours-help"
            invalid={!!errors.noShowExpiryHours}
            description={errors.noShowExpiryHours ?? "Reservations become Pending Pickup at their start. If nobody picks up within this window, they are cancelled and the gear is released."}
          >
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
              className="h-10"
              disabled={saving}
            />
          </SettingsRow>
          <SettingsRow
            label="Max active reservations per person"
            htmlFor="rr-max-concurrent"
            descriptionId="maxConcurrentReservations-help"
            invalid={!!errors.maxConcurrentReservations}
            description={errors.maxConcurrentReservations ?? "Counts Booked reservations. Leave blank for no limit."}
          >
            <Input
              id="rr-max-concurrent"
              name="maxConcurrentReservations"
              type="number"
              min={1}
              max={50}
              placeholder="No limit"
              value={form.maxConcurrentReservations}
              onChange={(e) => setField("maxConcurrentReservations", e.target.value)}
              aria-invalid={!!errors.maxConcurrentReservations}
              aria-describedby="maxConcurrentReservations-help"
              className="h-10"
              disabled={saving}
            />
          </SettingsRow>
        </SettingsGroup>
        {saveError && <Alert variant="destructive"><AlertDescription>{saveError}</AlertDescription></Alert>}
        <SettingsSaveBar dirty={dirty} saving={saving} onReset={resetChanges} />
        </div>
      </form>
    </SettingsPageShell>
  );
}
