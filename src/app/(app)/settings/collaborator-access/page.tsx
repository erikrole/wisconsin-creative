"use client";

import { useState } from "react";
import { AlertTriangle, Archive, History, Plus, RefreshCw, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/hooks/use-fetch";
import { parseErrorMessage } from "@/lib/errors";
import { SettingsPageShell } from "../SettingsPageShell";

type Capability =
  | "GEAR_CATALOG_VIEW"
  | "MY_GEAR_VIEW"
  | "RESERVATION_CREATE"
  | "RESERVATION_EDIT_OWN"
  | "RESERVATION_CANCEL_OWN"
  | "RESERVATION_EXTEND_OWN"
  | "PUBLISHED_SCHEDULE_VIEW"
  | "PEOPLE_DIRECTORY_VIEW"
  | "SOFTWARE_VAULT_VIEW"
  | "SCHEDULE_FOLLOW"
  | "KIOSK_ROSTER_ELIGIBLE";

type Policy = {
  id: string;
  status: "ACTIVE" | "SUSPENDED";
  version: number;
  capabilities: Capability[];
  affiliation: {
    id: string;
    key: string;
    displayName: string;
    badgeLabel: string;
  };
  counts: {
    activeUsers: number;
    pendingInvites: number;
    activeReservations: number;
    activeCheckouts: number;
  };
};

type Revision = {
  id: string;
  version: number;
  status: "ACTIVE" | "SUSPENDED";
  capabilities: Capability[];
  createdAt: string;
  actor: { id: string; name: string } | null;
};

const CAPABILITIES: Array<{ key: Capability; label: string; group: "Can see" | "Can do" | "Kiosk"; description: string }> = [
  { key: "GEAR_CATALOG_VIEW", label: "Gear catalog", group: "Can see", description: "Sanitized reservable gear." },
  { key: "MY_GEAR_VIEW", label: "My Gear", group: "Can see", description: "Only their reservations and checkouts." },
  { key: "PUBLISHED_SCHEDULE_VIEW", label: "Published Schedule", group: "Can see", description: "Published snapshots without internal notes." },
  { key: "PEOPLE_DIRECTORY_VIEW", label: "People directory", group: "Can see", description: "Active teammates with work-safe profile details." },
  { key: "SOFTWARE_VAULT_VIEW", label: "Shared software", group: "Can see", description: "Software logins explicitly shared with collaborators." },
  { key: "RESERVATION_CREATE", label: "Create reservations", group: "Can do", description: "Reserve gear for themselves." },
  { key: "RESERVATION_EDIT_OWN", label: "Edit own reservations", group: "Can do", description: "Edit eligible owned reservations." },
  { key: "RESERVATION_CANCEL_OWN", label: "Cancel own reservations", group: "Can do", description: "Cancel eligible owned reservations." },
  { key: "RESERVATION_EXTEND_OWN", label: "Request extensions", group: "Can do", description: "Request more time for eligible reservations." },
  { key: "SCHEDULE_FOLLOW", label: "Follow events", group: "Can do", description: "Follow published Schedule events." },
  { key: "KIOSK_ROSTER_ELIGIBLE", label: "Kiosk roster", group: "Kiosk", description: "Appear in every staffed kiosk picker." },
];

const DEPENDENCIES: Partial<Record<Capability, Capability[]>> = {
  RESERVATION_CREATE: ["GEAR_CATALOG_VIEW", "MY_GEAR_VIEW"],
  RESERVATION_EDIT_OWN: ["MY_GEAR_VIEW"],
  RESERVATION_CANCEL_OWN: ["MY_GEAR_VIEW"],
  RESERVATION_EXTEND_OWN: ["MY_GEAR_VIEW"],
  SCHEDULE_FOLLOW: ["PUBLISHED_SCHEDULE_VIEW"],
  KIOSK_ROSTER_ELIGIBLE: ["MY_GEAR_VIEW"],
};

function normalizeCapabilities(values: Capability[]) {
  const result = new Set(values);
  let changed = true;
  while (changed) {
    changed = false;
    for (const capability of [...result]) {
      for (const dependency of DEPENDENCIES[capability] ?? []) {
        if (!result.has(dependency)) {
          result.add(dependency);
          changed = true;
        }
      }
    }
  }
  return CAPABILITIES.map((entry) => entry.key).filter((key) => result.has(key));
}

export default function CollaboratorAccessPage() {
  const { data, loading, error, reload } = useFetch<Policy[]>({
    url: "/api/collaborator-affiliations",
    returnTo: "/settings/collaborator-access",
  });
  const policies = data ?? [];

  return (
    <SettingsPageShell
      title="Collaborator Access"
      description="Control what each external affiliation can see and do. Privacy and custody boundaries stay locked."
      mainClassName="flex flex-col gap-4"
    >
      <div className="flex justify-end"><CreateAffiliation onCreated={reload} /></div>
      <Alert>
        <AlertTriangle className="size-4" />
        <AlertTitle>Default deny</AlertTitle>
        <AlertDescription>New affiliations start suspended with no access. These controls never expose internal notes, private profiles, audit history, borrower identity, or custody mutations.</AlertDescription>
      </Alert>

      {loading ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : error ? (
        <Card><CardContent className="flex flex-col items-center gap-3 py-12"><p>Collaborator policies could not be loaded.</p><Button variant="outline" onClick={reload}><RefreshCw />Retry</Button></CardContent></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {policies.map((policy) => <PolicyCard key={`${policy.id}:${policy.version}`} policy={policy} onChanged={reload} />)}
        </div>
      )}
    </SettingsPageShell>
  );
}

function PolicyCard({ policy, onChanged }: { policy: Policy; onChanged: () => void }) {
  const confirm = useConfirm();
  const [name, setName] = useState(policy.affiliation.displayName);
  const [badge, setBadge] = useState(policy.affiliation.badgeLabel);
  const [status, setStatus] = useState(policy.status);
  const [capabilities, setCapabilities] = useState<Capability[]>(policy.capabilities);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<Revision[] | null>(null);

  function toggleCapability(key: Capability, checked: boolean) {
    if (checked) {
      setCapabilities(normalizeCapabilities([...capabilities, key]));
      return;
    }
    const next = capabilities.filter((capability) => capability !== key);
    setCapabilities(next.filter((capability) => !(DEPENDENCIES[capability] ?? []).includes(key)));
  }

  async function save() {
    setSaving(true);
    try {
      const previewResponse = await fetch(`/api/collaborator-affiliations/${policy.id}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, capabilities }),
      });
      if (!previewResponse.ok) throw new Error(await parseErrorMessage(previewResponse, "Could not preview policy"));
      const preview = (await previewResponse.json()).data as {
        requiresConfirmation: boolean;
        removed: Capability[];
        counts: Policy["counts"];
      };
      let acknowledgeRisk = false;
      if (preview.requiresConfirmation) {
        acknowledgeRisk = await confirm({
          title: status === "SUSPENDED" ? "Suspend affiliation access" : "Remove collaborator access",
          message: `${preview.counts.activeUsers} active users, ${preview.counts.activeReservations} active reservations, and ${preview.counts.activeCheckouts} active checkouts are affected. Staff keep control of existing records.`,
          confirmLabel: status === "SUSPENDED" ? "Suspend access" : "Save removals",
          variant: "danger",
        });
        if (!acknowledgeRisk) return;
      }
      const response = await fetch(`/api/collaborator-affiliations/${policy.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: policy.version,
          displayName: name,
          badgeLabel: badge,
          status,
          capabilities,
          acknowledgeRisk,
        }),
      });
      if (!response.ok) throw new Error(await parseErrorMessage(response, "Could not save policy"));
      toast.success(`${name} access updated`);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save policy");
    } finally {
      setSaving(false);
    }
  }

  async function loadHistory() {
    if (history) {
      setHistory(null);
      return;
    }
    const response = await fetch(`/api/collaborator-affiliations/${policy.id}/history`);
    if (!response.ok) {
      toast.error(await parseErrorMessage(response, "Could not load policy history"));
      return;
    }
    setHistory((await response.json()).data as Revision[]);
  }

  async function restore(revision: Revision) {
    const ok = await confirm({
      title: `Restore version ${revision.version}`,
      message: "This creates a new audited revision using the selected access and status. The current name and badge stay unchanged.",
      confirmLabel: "Restore policy",
      variant: "danger",
    });
    if (!ok) return;
    const response = await fetch(`/api/collaborator-affiliations/${policy.id}/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revisionId: revision.id, expectedVersion: policy.version, acknowledgeRisk: true }),
    });
    if (!response.ok) {
      toast.error(await parseErrorMessage(response, "Could not restore policy"));
      return;
    }
    toast.success(`Restored ${policy.affiliation.displayName} policy`);
    onChanged();
  }

  async function archive() {
    const ok = await confirm({
      title: "Archive affiliation",
      message: "Archiving requires a suspended affiliation with no active collaborators or pending invitations. History is retained.",
      confirmLabel: "Archive affiliation",
      variant: "danger",
    });
    if (!ok) return;
    const response = await fetch(`/api/collaborator-affiliations/${policy.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: policy.version }),
    });
    if (!response.ok) {
      toast.error(await parseErrorMessage(response, "Could not archive affiliation"));
      return;
    }
    toast.success("Affiliation archived");
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div><CardTitle className="flex items-center gap-2"><Badge variant="outline">{policy.affiliation.badgeLabel}</Badge>{policy.affiliation.displayName}</CardTitle><CardDescription className="mt-1">{policy.affiliation.key} · policy v{policy.version}</CardDescription></div>
          <Badge variant={status === "ACTIVE" ? "green" : "gray"}>{status === "ACTIVE" ? "Active" : "Suspended"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor={`${policy.id}-name`}>Name</Label><Input id={`${policy.id}-name`} value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor={`${policy.id}-badge`}>Badge</Label><Input id={`${policy.id}-badge`} value={badge} maxLength={12} onChange={(event) => setBadge(event.target.value)} /></div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div><p className="font-medium">Affiliation access</p><p className="text-sm text-muted-foreground">Suspension blocks login, invitations, registration, kiosk roster, and every capability.</p></div>
          <Button variant={status === "ACTIVE" ? "outline" : "default"} onClick={() => setStatus(status === "ACTIVE" ? "SUSPENDED" : "ACTIVE")}>{status === "ACTIVE" ? "Suspend" : "Activate"}</Button>
        </div>
        {(["Can see", "Can do", "Kiosk"] as const).map((group) => (
          <div key={group} className="grid gap-2">
            <p className="text-sm font-semibold">{group}</p>
            {CAPABILITIES.filter((entry) => entry.group === group).map((entry) => (
              <label key={entry.key} className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                <Checkbox checked={capabilities.includes(entry.key)} onCheckedChange={(checked) => toggleCapability(entry.key, checked === true)} />
                <span><span className="block text-sm font-medium">{entry.label}</span><span className="block text-xs text-muted-foreground">{entry.description}</span></span>
              </label>
            ))}
          </div>
        ))}
        <Separator />
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Count label="Active users" value={policy.counts.activeUsers} />
          <Count label="Pending invites" value={policy.counts.pendingInvites} />
          <Count label="Reservations" value={policy.counts.activeReservations} />
          <Count label="Checkouts" value={policy.counts.activeCheckouts} />
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex gap-2"><Button variant="outline" onClick={loadHistory}><History />History</Button><Button variant="outline" onClick={archive} disabled={status !== "SUSPENDED"}><Archive />Archive</Button></div>
          <Button onClick={save} disabled={saving}><Save />{saving ? "Saving…" : "Save policy"}</Button>
        </div>
        {history && (
          <div className="grid gap-2 rounded-md border p-3">
            <p className="font-semibold">Policy history</p>
            {history.map((revision) => (
              <div key={revision.id} className="flex items-center justify-between gap-3 border-t pt-2 first:border-0 first:pt-0">
                <div><p className="text-sm font-medium">Version {revision.version} · {revision.status}</p><p className="text-xs text-muted-foreground">{revision.capabilities.length} capabilities · {revision.actor?.name ?? "Migration"} · {new Date(revision.createdAt).toLocaleString()}</p></div>
                <Button className="h-10" variant="ghost" disabled={revision.version === policy.version} onClick={() => restore(revision)}><RotateCcw />Restore</Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md bg-muted/50 p-2"><p className="text-lg font-semibold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>;
}

function CreateAffiliation({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [badge, setBadge] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    setSaving(true);
    const response = await fetch("/api/collaborator-affiliations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: name, badgeLabel: badge }),
    });
    if (!response.ok) {
      toast.error(await parseErrorMessage(response, "Could not create affiliation"));
      setSaving(false);
      return;
    }
    toast.success(`${name.trim()} created suspended with no access`);
    setName("");
    setBadge("");
    setOpen(false);
    setSaving(false);
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus />Add affiliation</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add collaborator affiliation</DialogTitle><DialogDescription>The affiliation starts suspended with no capabilities. Its stable key is generated from the name and cannot be changed.</DialogDescription></DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5"><Label htmlFor="affiliation-name">Name</Label><Input id="affiliation-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Learfield" /></div>
          <div className="grid gap-1.5"><Label htmlFor="affiliation-badge">Badge</Label><Input id="affiliation-badge" value={badge} maxLength={12} onChange={(event) => setBadge(event.target.value)} placeholder="Learfield" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={create} disabled={saving || !name.trim() || badge.trim().length < 2}>{saving ? "Creating…" : "Create affiliation"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
