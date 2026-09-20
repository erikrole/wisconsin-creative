"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { WifiOff, AlertTriangle, RefreshCw } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, classifyError, isAbortError, parseErrorMessage } from "@/lib/errors";
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

  const description = "Configure when and how overdue checkout notifications are sent. Notifications are deduped per booking, and each trigger fires at most once.";

  if (loading) {
    return (
      <SettingsPageShell href="/settings/escalation" description={description}>
          <Card className="mb-1">
            <CardHeader><CardTitle>Notification Triggers</CardTitle></CardHeader>
            <div className="px-4 pb-4 flex flex-col gap-3">
              {/* Table header skeleton */}
              <div className="flex gap-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
              </div>
              {/* Table row skeletons */}
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-9 rounded-full" />
                  <Skeleton className="h-5 w-9 rounded-full" />
                  <Skeleton className="h-5 w-9 rounded-full" />
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader><CardTitle>Fatigue Controls</CardTitle></CardHeader>
            <div className="p-4 flex flex-col gap-2">
              <div className="flex gap-3 items-center">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-9 w-20 rounded-md" />
              </div>
              <Skeleton className="h-4 w-80" />
            </div>
          </Card>
      </SettingsPageShell>
    );
  }

  if (error) {
    const Icon = error === "network" ? WifiOff : AlertTriangle;
    return (
      <SettingsPageShell href="/settings/escalation" description={description}>
          <Card>
            <div className="flex flex-col items-center justify-center gap-4 py-12 px-4 text-center">
              <Icon className="size-10 text-muted-foreground" />
              <div>
                <p className="text-sm font-semibold">
                  {error === "network" ? "Connection Failed" : "Something Went Wrong"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
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
          </Card>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell href="/settings/escalation" description={description}>
        {/* Rules table */}
        <Card className="mb-1">
          <CardHeader>
            <CardTitle>Notification Triggers</CardTitle>
            <p className="text-xs text-muted-foreground mt-1 m-0">
              Toggle requester and admin notifications. Gear ops is fixed by overdue policy, not a switch. Timings follow product spec D-009.
            </p>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trigger</TableHead>
                <TableHead>Timing</TableHead>
                <TableHead>Requester</TableHead>
                <TableHead>Gear ops</TableHead>
                <TableHead>Admins</TableHead>
                <TableHead>Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell>{rule.title}</TableCell>
                  <TableCell>
                    <span className="text-muted-foreground text-xs font-medium">
                      {formatHours(rule)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={rule.notifyRequester}
                      onCheckedChange={() => toggleRule(rule.id, "notifyRequester", rule.notifyRequester)}
                      disabled={anySaving}
                      aria-label={`Toggle requester notifications for ${rule.title}`}
                    />
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {rule.type === "checkout_overdue_4h" || rule.type === "checkout_overdue_24h" ? "Always" : "Never"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={rule.notifyAdmins}
                      onCheckedChange={() => toggleRule(rule.id, "notifyAdmins", rule.notifyAdmins)}
                      disabled={anySaving}
                      aria-label={`Toggle admin notifications for ${rule.title}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={() => toggleRule(rule.id, "enabled", rule.enabled)}
                      disabled={anySaving}
                      aria-label={`Toggle ${rule.title} escalation trigger`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        {/* Fatigue controls */}
        <Card className="mb-1">
          <CardHeader><CardTitle>Fatigue Controls</CardTitle></CardHeader>
          <div className="p-4 grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="requester-cap" className="text-sm font-semibold">
                Requester stages per due date
              </label>
              <Select
                value={String(config.maxRequesterNotificationsPerDueDate)}
                onValueChange={(v) => updateCap("maxRequesterNotificationsPerDueDate", Number(v))}
                disabled={anySaving}
              >
                <SelectTrigger id="requester-cap" className="mt-2 w-24" aria-label="Requester notification cap per due date">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[3, 4, 5, 10, 20].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-2 m-0">Counts stages sent to the borrower, not staff fanout rows.</p>
            </div>
            <div>
              <label htmlFor="operations-cap" className="text-sm font-semibold">
                Operations rows per due date
              </label>
              <Select
                value={String(config.maxOperationalNotificationsPerDueDate)}
                onValueChange={(v) => updateCap("maxOperationalNotificationsPerDueDate", Number(v))}
                disabled={anySaving}
              >
                <SelectTrigger id="operations-cap" className="mt-2 w-24" aria-label="Operations notification cap per due date">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 10, 20, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-2 m-0">Caps responder and admin inbox rows without silencing the requester.</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Overdue Responders</CardTitle>
            <p className="text-xs text-muted-foreground mt-1 m-0">
              These staff receive the 4-hour and 24-hour operational escalation for each checkout location. If none are selected, the active staff creator is used, then active admins.
            </p>
          </CardHeader>
          <div className="p-4 grid gap-5 lg:grid-cols-2">
            {locations.map((location) => (
              <section key={location.id} aria-labelledby={`responders-${location.id}`}>
                <h3 id={`responders-${location.id}`} className="text-sm font-semibold mb-2">{location.name}</h3>
                <div className="grid gap-2">
                  {responderCandidates.map((candidate) => {
                    const checked = location.responderUserIds.includes(candidate.id);
                    return (
                      <label key={candidate.id} className="flex items-start gap-2 rounded-md border p-2.5 text-sm">
                        <Checkbox
                          checked={checked}
                          disabled={anySaving}
                          onCheckedChange={(value) => toggleResponder(location, candidate.id, value === true)}
                          aria-label={`${checked ? "Remove" : "Add"} ${candidate.name} as ${location.name} overdue responder`}
                        />
                        <span className="min-w-0">
                          <span className="block font-medium">{candidate.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{candidate.role === "ADMIN" ? "Admin" : "Staff"} · {candidate.email}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </Card>
    </SettingsPageShell>
  );
}
