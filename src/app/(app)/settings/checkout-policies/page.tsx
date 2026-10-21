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
import { ExtendPresetsSection } from "./ExtendPresets";
import { SettingsGroup, SettingsRow } from "../_components/SettingsGroup";
import { SettingsPageShell } from "../SettingsPageShell";
import { SettingsSaveBar } from "../_components/SettingsSaveBar";
import type { CheckoutPolicies } from "@/lib/services/checkout-policies";
import { isDirty } from "@/lib/utils";

type FormState = {
  defaultLoanDays: string;
  gracePeriodHours: string;
  maxItemsPerUser: string;
};

function toForm(p: CheckoutPolicies): FormState {
  return {
    defaultLoanDays: String(p.defaultLoanDays),
    gracePeriodHours: String(p.gracePeriodHours),
    maxItemsPerUser: p.maxItemsPerUser === null ? "" : String(p.maxItemsPerUser),
  };
}

export default function CheckoutPoliciesPage() {
  const { data, loading, error, reload } = useFetch<CheckoutPolicies>({
    url: "/api/settings/checkout-policies",
    returnTo: "/settings/checkout-policies",
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
    const loanDays = Number(form.defaultLoanDays);
    if (!Number.isInteger(loanDays) || loanDays < 1 || loanDays > 365) {
      e.defaultLoanDays = "Must be a whole number between 1 and 365.";
    }
    const grace = Number(form.gracePeriodHours);
    if (form.gracePeriodHours.trim() === "" || isNaN(grace) || grace < 0 || grace > 168) {
      e.gracePeriodHours = "Must be between 0 and 168 hours.";
    }
    if (form.maxItemsPerUser !== "") {
      const max = Number(form.maxItemsPerUser);
      if (!Number.isInteger(max) || max < 1 || max > 100) {
        e.maxItemsPerUser = "Must be a whole number between 1 and 100, or leave blank for no limit.";
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
      const payload: CheckoutPolicies = {
        defaultLoanDays: Number(form.defaultLoanDays),
        gracePeriodHours: Number(form.gracePeriodHours),
        maxItemsPerUser: form.maxItemsPerUser === "" ? null : Number(form.maxItemsPerUser),
      };
      const res = await fetch("/api/settings/checkout-policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) { handleAuthRedirect(res, "/settings/checkout-policies"); return; }
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to save checkout policies.");
        setSaveError(msg);
        toast.error(msg);
        return;
      }
      toast.success("Checkout policies saved.");
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
      <SettingsPageShell href="/settings/checkout-policies">
        <Skeleton className="h-64 w-full rounded-lg" />
      </SettingsPageShell>
    );
  }

  if (!form) {
    return (
      <SettingsPageShell href="/settings/checkout-policies">
        <EmptyState
          inline
          icon={error === "network" ? "wifi-off" : "box"}
          title={error === "network" ? "You are offline" : "Could not load checkout policies"}
          description={error === "network" ? "Check your connection and retry." : "Retry before changing checkout rules."}
          actionLabel="Retry"
          onAction={reload}
        />
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell href="/settings/checkout-policies" mainClassName="flex flex-col gap-7">
      {error && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Could not refresh settings. Your values are still shown.</span>
            <Button type="button" variant="outline" className="h-10" onClick={reload}>Retry refresh</Button>
          </AlertDescription>
        </Alert>
      )}
      <form ref={formElement} noValidate onSubmit={(event) => { event.preventDefault(); void handleSave(); }}>
        <div className="flex flex-col gap-4">
        <SettingsGroup
          title="Loan rules"
          description="Defaults and limits apply to new checkouts. The grace period also decides when existing checkouts count as overdue."
        >
          <SettingsRow
            label="Default loan length (days)"
            htmlFor="cp-loan-days"
            descriptionId="defaultLoanDays-help"
            invalid={!!errors.defaultLoanDays}
            description={errors.defaultLoanDays ?? "Prefills the due date when a checkout has no end date."}
          >
            <Input
              id="cp-loan-days"
              name="defaultLoanDays"
              type="number"
              min={1}
              max={365}
              value={form.defaultLoanDays}
              onChange={(e) => setField("defaultLoanDays", e.target.value)}
              aria-invalid={!!errors.defaultLoanDays}
              aria-describedby="defaultLoanDays-help"
              className="h-10"
              disabled={saving}
            />
          </SettingsRow>
          <SettingsRow
            label="Overdue grace period (hours)"
            htmlFor="cp-grace"
            descriptionId="gracePeriodHours-help"
            invalid={!!errors.gracePeriodHours}
            description={errors.gracePeriodHours ?? "Overdue lists and escalations start after the due date plus this buffer. 0 means immediately."}
          >
            <Input
              id="cp-grace"
              name="gracePeriodHours"
              type="number"
              min={0}
              max={168}
              step={0.5}
              value={form.gracePeriodHours}
              onChange={(e) => setField("gracePeriodHours", e.target.value)}
              aria-invalid={!!errors.gracePeriodHours}
              aria-describedby="gracePeriodHours-help"
              className="h-10"
              disabled={saving}
            />
          </SettingsRow>
          <SettingsRow
            label="Max active checkouts per person"
            htmlFor="cp-max-items"
            descriptionId="maxItemsPerUser-help"
            invalid={!!errors.maxItemsPerUser}
            description={errors.maxItemsPerUser ?? "Counts Open and legacy Pending Pickup checkouts. Leave blank for no limit."}
          >
            <Input
              id="cp-max-items"
              name="maxItemsPerUser"
              type="number"
              min={1}
              max={100}
              placeholder="No limit"
              value={form.maxItemsPerUser}
              onChange={(e) => setField("maxItemsPerUser", e.target.value)}
              aria-invalid={!!errors.maxItemsPerUser}
              aria-describedby="maxItemsPerUser-help"
              className="h-10"
              disabled={saving}
            />
          </SettingsRow>
        </SettingsGroup>
        {saveError && <Alert variant="destructive"><AlertDescription>{saveError}</AlertDescription></Alert>}
        <SettingsSaveBar dirty={dirty} saving={saving} onReset={resetChanges} />
        </div>
      </form>
      <ExtendPresetsSection />
    </SettingsPageShell>
  );
}
