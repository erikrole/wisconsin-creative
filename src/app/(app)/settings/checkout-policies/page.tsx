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
import type { CheckoutPolicies } from "@/lib/services/checkout-policies";

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

function isDirty(a: FormState, b: FormState): boolean {
  return a.defaultLoanDays !== b.defaultLoanDays
    || a.gracePeriodHours !== b.gracePeriodHours
    || a.maxItemsPerUser !== b.maxItemsPerUser;
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
      <SettingsPageShell title="Checkout Policies" description="Default loan duration, overdue grace period, and per-user item cap.">
        <Skeleton className="h-64 w-full rounded-lg" />
      </SettingsPageShell>
    );
  }

  if (!form) {
    return (
      <SettingsPageShell title="Checkout Policies" description="Default loan duration, overdue grace period, and per-user item cap.">
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
    <SettingsPageShell title="Checkout Policies" description="Default loan duration, overdue grace period, and per-user item cap.">
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
            <CardTitle className="text-base">Loan rules</CardTitle>
            <CardDescription>Loan defaults and checkout limits apply to new checkouts. The grace period also affects when existing checkouts are considered overdue.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Default loan duration */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-loan-days">Default loan duration (days)</Label>
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
                className="h-10 max-w-48"
                disabled={saving}
              />
              <p id="defaultLoanDays-help" aria-live="polite" className={errors.defaultLoanDays ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {errors.defaultLoanDays ?? "Used to prefill the due date when creating a checkout with no explicit end date."}
              </p>
            </div>

            {/* Grace period */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-grace">Overdue grace period (hours)</Label>
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
                className="h-10 max-w-48"
                disabled={saving}
              />
              <p id="gracePeriodHours-help" aria-live="polite" className={errors.gracePeriodHours ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {errors.gracePeriodHours ?? "A checkout only appears in the Overdue list and triggers escalation notifications after the due date plus this buffer. Set to 0 for immediate overdue."}
              </p>
            </div>

            {/* Max items */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-max-items">Max active checkouts per user</Label>
              <Input
                id="cp-max-items"
                name="maxItemsPerUser"
                type="number"
                min={1}
                max={100}
                value={form.maxItemsPerUser}
                onChange={(e) => setField("maxItemsPerUser", e.target.value)}
                placeholder="No limit"
                aria-invalid={!!errors.maxItemsPerUser}
                aria-describedby="maxItemsPerUser-help"
                className="h-10 max-w-48"
                disabled={saving}
              />
              <p id="maxItemsPerUser-help" aria-live="polite" className={errors.maxItemsPerUser ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {errors.maxItemsPerUser ?? "Counts both Open and legacy Pending Pickup checkouts. Leave blank for no limit."}
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
