"use client";

import { useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WifiOff, AlertTriangle, RefreshCw } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, classifyError, isAbortError, parseErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsRow } from "../_components/SettingsGroup";
import { SettingsPageShell } from "../SettingsPageShell";

type EscalationRule = {
  id: string;
  hoursFromDue: number;
  type: string;
  title: string;
  notifyRequester: boolean;
  notifyAdmins: boolean;
  enabled: boolean;
  sortOrder: number;
};

type EscalationConfig = {
  maxRequesterNotificationsPerDueDate: number;
  maxOperationalNotificationsPerDueDate: number;
};

type ResponderCandidate = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "STAFF";
  locationId: string | null;
};

type EscalationLocation = {
  id: string;
  name: string;
  responderUserIds: string[];
};

type EscalationData = {
  rules: EscalationRule[];
  config: EscalationConfig;
  locations: EscalationLocation[];
  responderCandidates: ResponderCandidate[];
};

type EscalationRuleField = "enabled" | "notifyAdmins" | "notifyRequester";

function ruleSavingKey(ruleId: string, field: EscalationRuleField) {
  return `${ruleId}:${field}`;
}

function describeRuleChange(rule: EscalationRule | undefined, field: EscalationRuleField, next: boolean) {
  const title = rule?.title ?? "Escalation trigger";
  if (field === "enabled") {
    return `${title} trigger ${next ? "enabled" : "disabled"}.`;
  }
  if (field === "notifyAdmins") {
    return `${title} ${next ? "now notifies admins" : "no longer notifies admins"}.`;
  }
  return `${title} ${next ? "now notifies the requester" : "no longer notifies the requester"}.`;
}

export default function EscalationSettingsPage() {
  const defaultConfig: EscalationConfig = {
    maxRequesterNotificationsPerDueDate: 5,
    maxOperationalNotificationsPerDueDate: 20,
  };
  const { data: escalationData, loading, error, reload } = useFetch<EscalationData>({
    url: "/api/settings/escalation",
    returnTo: "/settings/escalation",
    transform: (json) => (json.data as EscalationData) ?? {
      rules: [],
      config: defaultConfig,
      locations: [],
      responderCandidates: [],
    },
  });
  // Local state for optimistic mutation updates
  const [localRules, setLocalRules] = useState<EscalationRule[] | null>(null);
  const [localConfig, setLocalConfig] = useState<EscalationConfig | null>(null);
  const [localLocations, setLocalLocations] = useState<EscalationLocation[] | null>(null);
  const rules = localRules ?? escalationData?.rules ?? [];
  const config = localConfig ?? escalationData?.config ?? defaultConfig;
  const locations = localLocations ?? escalationData?.locations ?? [];
  const responderCandidates = escalationData?.responderCandidates ?? [];
  // Sync local state when fetch data changes
  const [prevData, setPrevData] = useState(escalationData);
  if (escalationData !== prevData) {
    setPrevData(escalationData);
    setLocalRules(null);
    setLocalConfig(null);
    setLocalLocations(null);
  }
  const [saving, setSaving] = useState<string | null>(null);
  const savingRef = useRef(false);
  const anySaving = saving !== null;

  async function toggleRule(ruleId: string, field: EscalationRuleField, current: boolean) {
    if (savingRef.current) {
      toast.info("Finish the current escalation save before changing another trigger.");
      return;
    }
    const next = !current;
    const targetRule = rules.find((rule) => rule.id === ruleId);
    savingRef.current = true;
    setSaving(ruleSavingKey(ruleId, field));
    try {
      const res = await fetch("/api/settings/escalation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId, [field]: next }),
      });
      if (handleAuthRedirect(res, "/settings/escalation")) return;
      if (res.ok) {
        setLocalRules((prev) => (prev ?? rules).map((r) => r.id === ruleId ? { ...r, [field]: next } : r));
        toast.success(describeRuleChange(targetRule, field, next));
      } else {
        const msg = await parseErrorMessage(res, "Update failed");
        toast.error(msg);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You\u2019re offline. Check your connection." : "Update failed");
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  }

  async function updateCap(field: keyof EscalationConfig, newCap: number) {
    if (savingRef.current) {
      toast.info("Finish the current escalation save before changing the notification cap.");
      return;
    }
    savingRef.current = true;
    setSaving("cap");
    try {
      const res = await fetch("/api/settings/escalation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: newCap }),
      });
      if (handleAuthRedirect(res, "/settings/escalation")) return;
      if (res.ok) {
        setLocalConfig({ ...config, [field]: newCap });
        toast.success(field === "maxRequesterNotificationsPerDueDate"
          ? `Requester cap set to ${newCap} per due date.`
          : `Operations cap set to ${newCap} per due date.`);
      } else {
        const msg = await parseErrorMessage(res, "Update failed");
        toast.error(msg);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You\u2019re offline. Check your connection." : "Update failed");
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  }

  async function toggleResponder(location: EscalationLocation, userId: string, checked: boolean) {
    if (savingRef.current) {
      toast.info("Finish the current escalation save before changing responders.");
      return;
    }
    const nextIds = checked
      ? [...new Set([...location.responderUserIds, userId])]
      : location.responderUserIds.filter((id) => id !== userId);
    savingRef.current = true;
    setSaving(`responders:${location.id}`);
    try {
      const res = await fetch("/api/settings/escalation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: location.id, responderUserIds: nextIds }),
      });
      if (handleAuthRedirect(res, "/settings/escalation")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Responder update failed"));
        return;
      }
      setLocalLocations((current) => (current ?? locations).map((entry) =>
        entry.id === location.id ? { ...entry, responderUserIds: nextIds } : entry
      ));
      toast.success(`${location.name} overdue responders updated.`);
    } catch (err) {
      if (isAbortError(err)) return;
      toast.error(classifyError(err) === "network" ? "You’re offline. Check your connection." : "Responder update failed");
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  }

  function formatHours(rule: EscalationRule): string {
    if (rule.type === "checkout_overdue_grace") return "When grace ends";
    const h = rule.hoursFromDue;
    if (h < 0) return `${Math.abs(h)}h before due`;
    if (h === 0) return "At due time";
    return `${h}h after due`;
  }

  const description = "When overdue reminders go out and who gets them. Each reminder sends at most once per booking.";

  if (loading) {
    return (
      <SettingsPageShell href="/settings/escalation" description={description} mainClassName="flex flex-col gap-7">
        <SettingsGroup title="Reminders">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
          ))}
        </SettingsGroup>
        <SettingsGroup title="Limits">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-9 w-24 rounded-md" />
            </div>
          ))}
        </SettingsGroup>
      </SettingsPageShell>
    );
  }

  if (error) {
    const Icon = error === "network" ? WifiOff : AlertTriangle;
    return (
      <SettingsPageShell href="/settings/escalation" description={description}>
        <SettingsGroup>
          <div className="flex flex-col items-center justify-center gap-4 py-12 px-4 text-center">
            <Icon className="size-8 text-muted-foreground" />
            <div>
              <p className="m-0 text-sm font-bold">
                {error === "network" ? "Connection failed" : "Something went wrong"}
              </p>
              <p className="m-0 mt-1 text-sm text-muted-foreground">
                {error === "network"
                  ? "Could not connect to the server. Check your internet connection and try again."
                  : "Something went wrong. Please try again."}
              </p>
            </div>
            <Button variant="outline" onClick={reload}>
              <RefreshCw className="size-4" />
              Retry
            </Button>
          </div>
        </SettingsGroup>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell href="/settings/escalation" description={description} mainClassName="flex flex-col gap-7">
      <SettingsGroup
        title="Reminders"
        description="Turn each reminder on or off, then pick who it reaches. The gear room team always gets the 4-hour and 24-hour overdue alerts."
      >
        {rules.map((rule) => {
          const gearOps = rule.type === "checkout_overdue_4h" || rule.type === "checkout_overdue_24h";
          return (
            <div key={rule.id} className="flex flex-col gap-2.5 px-4 py-3.5">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="m-0 text-sm font-bold text-foreground">{rule.title}</p>
                  <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">{formatHours(rule)}</p>
                </div>
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={() => toggleRule(rule.id, "enabled", rule.enabled)}
                  disabled={anySaving}
                  aria-label={`Toggle ${rule.title} escalation trigger`}
                />
              </div>
              <div
                className={cn(
                  "flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]",
                  !rule.enabled && "opacity-50",
                )}
              >
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={rule.notifyRequester}
                    onCheckedChange={() => toggleRule(rule.id, "notifyRequester", rule.notifyRequester)}
                    disabled={anySaving || !rule.enabled}
                    aria-label={`Toggle requester notifications for ${rule.title}`}
                  />
                  Borrower
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={rule.notifyAdmins}
                    onCheckedChange={() => toggleRule(rule.id, "notifyAdmins", rule.notifyAdmins)}
                    disabled={anySaving || !rule.enabled}
                    aria-label={`Toggle admin notifications for ${rule.title}`}
                  />
                  Admins
                </label>
                {gearOps ? <span className="text-muted-foreground">Gear room team always</span> : null}
              </div>
            </div>
          );
        })}
      </SettingsGroup>

      <SettingsGroup
        title="Limits"
        description="Caps how many overdue notifications one due date can create, so nobody gets buried."
      >
        <SettingsRow
          label="Borrower reminders per due date"
          htmlFor="requester-cap"
          description="Counts reminders sent to the borrower, not staff alerts."
        >
          <Select
            value={String(config.maxRequesterNotificationsPerDueDate)}
            onValueChange={(v) => updateCap("maxRequesterNotificationsPerDueDate", Number(v))}
            disabled={anySaving}
          >
            <SelectTrigger id="requester-cap" className="w-full" aria-label="Requester notification cap per due date">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[3, 4, 5, 10, 20].map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          label="Staff alerts per due date"
          htmlFor="operations-cap"
          description="Caps responder and admin inbox rows. The borrower still gets theirs."
        >
          <Select
            value={String(config.maxOperationalNotificationsPerDueDate)}
            onValueChange={(v) => updateCap("maxOperationalNotificationsPerDueDate", Number(v))}
            disabled={anySaving}
          >
            <SelectTrigger id="operations-cap" className="w-full" aria-label="Operations notification cap per due date">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[5, 10, 20, 50, 100].map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsGroup>

      <section className="flex flex-col gap-4">
        <div className="px-1">
          <h3 className="m-0 text-sm">Who follows up</h3>
          <p className="m-0 mt-0.5 text-sm text-muted-foreground text-pretty">
            These staff get the 4-hour and 24-hour overdue alerts for gear checked out from each location. With nobody picked, the staff member who made the checkout gets it, then admins.
          </p>
        </div>
        {locations.map((location) => (
          <SettingsGroup key={location.id} title={location.name} className="gap-2">
            {responderCandidates.map((candidate) => {
              const checked = location.responderUserIds.includes(candidate.id);
              return (
                <label key={candidate.id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40">
                  <Checkbox
                    checked={checked}
                    disabled={anySaving}
                    onCheckedChange={(value) => toggleResponder(location, candidate.id, value === true)}
                    aria-label={`${checked ? "Remove" : "Add"} ${candidate.name} as ${location.name} overdue responder`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{candidate.name}</span>
                    <span className="block truncate text-[13px] text-muted-foreground">{candidate.role === "ADMIN" ? "Admin" : "Staff"} · {candidate.email}</span>
                  </span>
                </label>
              );
            })}
          </SettingsGroup>
        ))}
      </section>
    </SettingsPageShell>
  );
}
