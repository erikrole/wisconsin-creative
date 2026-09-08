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
    const loanDays = Number(form.defaultLoanDays);
    if (!Number.isInteger(loanDays) || loanDays < 1 || loanDays > 365) {
      e.defaultLoanDays = "Must be a whole number between 1 and 365.";
    }
    const grace = Number(form.gracePeriodHours);
    if (isNaN(grace) || grace < 0 || grace > 168) {
      e.gracePeriodHours = "Must be between 0 and 168 hours.";
    }
    if (form.maxItemsPerUser !== "") {
      const max = Number(form.maxItemsPerUser);
      if (!Number.isInteger(max) || max < 1 || max > 100) {
        e.maxItemsPerUser = "Must be a whole number between 1 and 100, or leave blank for no limit.";
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
        toast.error(msg);
        return;
      }
      toast.success("Checkout policies saved.");
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
      <SettingsPageShell title="Checkout Policies" description="Default loan duration, overdue grace period, and per-user item cap.">
        <Skeleton className="h-64 w-full rounded-lg" />
      </SettingsPageShell>
    );
  }

  if (error || !form) {
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
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Loan rules</CardTitle>
          <CardDescription>These apply to all new checkouts. Existing checkouts are not affected.</CardDescription>
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
              className="max-w-48"
              disabled={saving}
            />
            {errors.defaultLoanDays
              ? <p className="text-xs text-destructive">{errors.defaultLoanDays}</p>
              : <p className="text-xs text-muted-foreground">Used to prefill the due date when creating a checkout with no explicit end date.</p>
            }
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
              className="max-w-48"
              disabled={saving}
            />
            {errors.gracePeriodHours
              ? <p className="text-xs text-destructive">{errors.gracePeriodHours}</p>
              : <p className="text-xs text-muted-foreground">A checkout only appears in the Overdue list and triggers escalation notifications after the due date plus this buffer. Set to 0 for immediate overdue.</p>
            }
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
              className="max-w-48"
              disabled={saving}
            />
            {errors.maxItemsPerUser
              ? <p className="text-xs text-destructive">{errors.maxItemsPerUser}</p>
              : <p className="text-xs text-muted-foreground">Counts both Open and legacy Pending Pickup checkouts. Leave blank for no limit.</p>
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
