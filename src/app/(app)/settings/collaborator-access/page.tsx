"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, History, Plus, RotateCcw } from "lucide-react";
import { toast } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/hooks/use-fetch";
import { parseErrorMessage } from "@/lib/errors";
import { SettingsPageShell } from "../SettingsPageShell";
import { SettingsGroup, SettingsRow } from "../_components/SettingsGroup";
import { SettingsSaveBar } from "../_components/SettingsSaveBar";
import EmptyState from "@/components/EmptyState";

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
      href="/settings/collaborator-access"
      description="Control what each external affiliation can see and do. Privacy and custody boundaries stay locked."
      actions={<CreateAffiliation onCreated={reload} />}
      mainClassName="flex flex-col gap-4"
    >
      <p className="m-0 rounded-xl border border-border bg-card px-4 py-3.5 text-[13px] leading-snug text-muted-foreground shadow-xs">
        <span className="font-bold text-foreground">Default deny.</span>{" "}
        New affiliations start suspended with no access. These controls never expose internal notes, private profiles,
        audit history, borrower identity, or custody changes.
      </p>

      {loading ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : error ? (
        <EmptyState
          inline
          icon="users"
          title="Could not load collaborator access"
          description="Retry before changing affiliation policies."
          actionLabel="Retry"
          onAction={reload}
        />
      ) : policies.length === 0 ? (
        <EmptyState
          inline
          icon="users"
          title="No collaborator affiliations"
          description="Create an affiliation to decide what outside partners can see and do."
        />
      ) : (
        <div className="flex flex-col gap-12">
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
  const savingRef = useRef(false);
  const dirty =
    name !== policy.affiliation.displayName
    || badge !== policy.affiliation.badgeLabel
    || status !== policy.status
    || capabilities.length !== policy.capabilities.length
    || capabilities.some((capability) => !policy.capabilities.includes(capability));

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
    setName(policy.affiliation.displayName);
    setBadge(policy.affiliation.badgeLabel);
    setStatus(policy.status);
    setCapabilities(policy.capabilities);
  }

  function toggleCapability(key: Capability, checked: boolean) {
    if (saving) return;
    if (checked) {
      setCapabilities(normalizeCapabilities([...capabilities, key]));
      return;
    }
    const next = capabilities.filter((capability) => capability !== key);
    setCapabilities(next.filter((capability) => !(DEPENDENCIES[capability] ?? []).includes(key)));
  }

  async function save() {
    if (!dirty || savingRef.current) return;
    savingRef.current = true;
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
      savingRef.current = false;
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

  const id = policy.id;
  return (
    <section className="flex flex-col gap-4" aria-label={`${policy.affiliation.displayName} policy`}>
      <div className="flex items-start justify-between gap-3 px-1">
        <div className="min-w-0">
          <h3 className="m-0 flex items-center gap-2 text-lg">
            {policy.affiliation.displayName}
            <Badge variant="outline">{policy.affiliation.badgeLabel}</Badge>
          </h3>
          <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">{policy.affiliation.key} · policy v{policy.version}</p>
        </div>
        <Badge variant={status === "ACTIVE" ? "green" : "gray"}>{status === "ACTIVE" ? "Active" : "Suspended"}</Badge>
      </div>

      <SettingsGroup>
        <SettingsRow label="Name" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            name={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={saving}
            className="h-10"
          />
        </SettingsRow>
        <SettingsRow label="Badge" htmlFor={`${id}-badge`} description="Short label shown next to their names.">
          <Input
            id={`${id}-badge`}
            name={`${id}-badge`}
            value={badge}
            maxLength={12}
            onChange={(event) => setBadge(event.target.value)}
            disabled={saving}
            className="h-10"
          />
        </SettingsRow>
        <SettingsRow
          label="Affiliation access"
          description="Suspending blocks login, invitations, registration, the kiosk roster, and every capability."
        >
          <Button
            type="button"
            className="h-10"
            variant={status === "ACTIVE" ? "outline" : "default"}
            disabled={saving}
            onClick={() => setStatus(status === "ACTIVE" ? "SUSPENDED" : "ACTIVE")}
          >
            {status === "ACTIVE" ? "Suspend" : "Activate"}
          </Button>
        </SettingsRow>
      </SettingsGroup>

      {(["Can see", "Can do", "Kiosk"] as const).map((group) => (
        <SettingsGroup key={group} title={group}>
          {CAPABILITIES.filter((entry) => entry.group === group).map((entry) => (
            <label
              key={entry.key}
              className={`flex items-center justify-between gap-6 px-4 py-3.5 ${saving ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/40"}`}
            >
              <span className="min-w-0">
                <span className="block text-sm font-bold">{entry.label}</span>
                <span className="block text-[13px] text-muted-foreground">{entry.description}</span>
              </span>
              <Checkbox
                checked={capabilities.includes(entry.key)}
                disabled={saving}
                onCheckedChange={(checked) => toggleCapability(entry.key, checked === true)}
              />
            </label>
          ))}
        </SettingsGroup>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="m-0 text-[13px] text-muted-foreground">
          {policy.counts.activeUsers} active {policy.counts.activeUsers === 1 ? "user" : "users"} · {policy.counts.pendingInvites} pending {policy.counts.pendingInvites === 1 ? "invite" : "invites"} · {policy.counts.activeReservations} {policy.counts.activeReservations === 1 ? "reservation" : "reservations"} · {policy.counts.activeCheckouts} {policy.counts.activeCheckouts === 1 ? "checkout" : "checkouts"}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="h-10" onClick={loadHistory} disabled={saving}>
            <History />
            {history ? "Hide history" : "History"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            onClick={archive}
            disabled={saving || status !== "SUSPENDED"}
          >
            <Archive />
            Archive
          </Button>
        </div>
      </div>

      {history && (
        <SettingsGroup title="Policy history">
          {history.map((revision) => (
            <div key={revision.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="m-0 text-sm font-bold">Version {revision.version} · {revision.status === "ACTIVE" ? "Active" : "Suspended"}</p>
                <p className="m-0 text-[13px] text-muted-foreground">
                  {revision.capabilities.length} capabilities · {revision.actor?.name ?? "Migration"} · {new Date(revision.createdAt).toLocaleString()}
                </p>
              </div>
              <Button
                className="h-10"
                variant="ghost"
                disabled={saving || revision.version === policy.version}
                onClick={() => restore(revision)}
              >
                <RotateCcw />
                Restore
              </Button>
            </div>
          ))}
        </SettingsGroup>
      )}

      <SettingsSaveBar
        dirty={dirty}
        saving={saving}
        onReset={resetChanges}
        onSave={() => void save()}
        saveLabel="Save policy"
        savedLabel="Saved"
      />
    </section>
  );
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
