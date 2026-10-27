"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { AlertTriangle, Pencil, Plus, Power, PowerOff, WifiOff } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useFetch } from "@/hooks/use-fetch";
import { useLastAudit, type LastAuditMap } from "@/hooks/use-last-audit";
import { LastEditedHint } from "@/components/LastEditedHint";
import {
  classifyError,
  handleAuthRedirect,
  isAbortError,
  parseErrorMessage,
} from "@/lib/errors";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsRow } from "../_components/SettingsGroup";
import { SettingsPageShell } from "../SettingsPageShell";

type DepartmentCounts = {
  assets: number;
  bulkSkus: number;
};

type Department = {
  id: string;
  name: string;
  active: boolean;
  _count?: DepartmentCounts;
};

function usageLabel(counts?: DepartmentCounts) {
  if (!counts) return "No linked inventory";
  const total = counts.assets + counts.bulkSkus;
  if (total === 0) return "No linked inventory";
  const parts: string[] = [];
  if (counts.assets > 0) parts.push(`${counts.assets} item${counts.assets === 1 ? "" : "s"}`);
  if (counts.bulkSkus > 0) parts.push(`${counts.bulkSkus} item famil${counts.bulkSkus === 1 ? "y" : "ies"}`);
  return parts.join(" + ");
}

export default function DepartmentsSettingsPage() {
  const confirm = useConfirm();
  const { data: fetched, loading, error, reload } = useFetch<Department[]>({
    url: "/api/departments?includeInactive=1",
    returnTo: "/settings/departments",
    transform: (json) => (json.data as Department[]) ?? [],
  });

  const [localItems, setLocalItems] = useState<Department[] | null>(null);
  const [prevFetched, setPrevFetched] = useState(fetched);
  if (fetched !== prevFetched) {
    setPrevFetched(fetched);
    setLocalItems(null);
  }
  const items = localItems ?? fetched ?? [];
  const lastEdited = useLastAudit("department", items.map((department) => department.id));

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function patchLocal(id: string, patch: Partial<Department>) {
    setLocalItems((prev) => (prev ?? items).map((item) => (
      item.id === id ? { ...item, ...patch } : item
    )));
  }

  async function addDepartment(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    setAddError("");
    if (!name) {
      setAddError("Department name is required.");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (handleAuthRedirect(res, "/settings/departments")) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to add department");
        setAddError(msg);
        toast.error(msg);
        return;
      }
      toast.success(`Added "${name}"`);
      setNewName("");
      setShowAdd(false);
      reload();
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      const msg = kind === "network" ? "You're offline. Check your connection." : "Failed to add department";
      setAddError(msg);
      toast.error(msg);
    } finally {
      setAdding(false);
    }
  }

  async function patchDepartment(id: string, patch: Partial<Department>, optimistic = true) {
    if (optimistic) patchLocal(id, patch);
    try {
      const res = await fetch(`/api/departments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (handleAuthRedirect(res, "/settings/departments")) return false;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to save department");
        toast.error(msg);
        if (optimistic) reload();
        return false;
      }
      return true;
    } catch (err) {
      if (isAbortError(err)) return false;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You're offline. Check your connection." : "Failed to save department");
      if (optimistic) reload();
      return false;
    }
  }

  function startRename(department: Department) {
    setRenamingId(department.id);
    setRenameValue(department.name);
  }

  async function commitRename(department: Department) {
    const name = renameValue.trim();
    if (!name || name === department.name) {
      setRenamingId(null);
      setRenameValue("");
      return;
    }
    setBusy(`rename-${department.id}`);
    const success = await patchDepartment(department.id, { name });
    if (success) toast.success(`Renamed to "${name}"`);
    setRenamingId(null);
    setRenameValue("");
    setBusy(null);
  }

  async function toggleActive(department: Department) {
    if (department.active) {
      const ok = await confirm({
        title: `Deactivate "${department.name}"?`,
        message: `${usageLabel(department._count)} will keep its existing department. New item and item-family forms will stop offering this department until it is reactivated.`,
        confirmLabel: "Deactivate",
        variant: "danger",
      });
      if (!ok) return;
    }

    setBusy(`active-${department.id}`);
    const success = await patchDepartment(department.id, { active: !department.active });
    if (success) {
      toast.success(`${department.name} ${department.active ? "deactivated" : "reactivated"}`);
    }
    setBusy(null);
  }

  const description = "Who owns each piece of gear. Item forms, filters, and utilization reports group by department.";
  const addButton = !showAdd ? (
    <Button className="h-10" onClick={() => setShowAdd(true)}>
      <Plus className="size-4 mr-1.5" />
      Add department
    </Button>
  ) : null;

  if (loading) {
    return (
      <SettingsPageShell href="/settings/departments" description={description} mainClassName="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </SettingsPageShell>
    );
  }

  if (error) {
    const Icon = error === "network" ? WifiOff : AlertTriangle;
    return (
      <SettingsPageShell href="/settings/departments" description={description}>
        <SettingsGroup>
          <div className="flex flex-col items-center gap-4 px-4 py-12 text-center">
            <Icon className="size-8 text-muted-foreground" />
            <p className="m-0 text-sm text-muted-foreground">
              {error === "network" ? "Could not connect to the server." : "Failed to load departments."}
            </p>
            <Button variant="outline" onClick={reload}>Retry</Button>
          </div>
        </SettingsGroup>
      </SettingsPageShell>
    );
  }

  const active = items.filter((department) => department.active);
  const inactive = items.filter((department) => !department.active);
  const listProps = {
    lastEdited,
    busy,
    renamingId,
    renameValue,
    onRenameValueChange: setRenameValue,
    onStartRename: startRename,
    onCommitRename: commitRename,
    onCancelRename: () => setRenamingId(null),
    onToggleActive: toggleActive,
  };

  return (
    <SettingsPageShell href="/settings/departments" description={description} actions={addButton} mainClassName="flex flex-col gap-7">
      {showAdd && (
        <form onSubmit={addDepartment}>
          <SettingsGroup title="New department">
            <SettingsRow
              label="Name"
              htmlFor="department-name"
              description={addError || undefined}
              invalid={Boolean(addError)}
            >
              <Input
                id="department-name"
                value={newName}
                onChange={(e) => { setNewName(e.target.value); setAddError(""); }}
                placeholder="e.g. Video"
                required
                autoFocus
                disabled={adding}
              />
            </SettingsRow>
            <div className="flex justify-end gap-2 bg-muted/40 px-4 py-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setShowAdd(false); setNewName(""); setAddError(""); }}
                disabled={adding}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={adding || !newName.trim()}>
                {adding ? <><Spinner data-icon="inline-start" />Adding...</> : "Add department"}
              </Button>
            </div>
          </SettingsGroup>
        </form>
      )}

      <DepartmentList
        title={inactive.length > 0 ? "Active" : undefined}
        departments={active}
        {...listProps}
      />

      {inactive.length > 0 && (
        <DepartmentList title="Deactivated" departments={inactive} muted {...listProps} />
      )}
    </SettingsPageShell>
  );
}

function DepartmentList({
  title,
  departments,
  lastEdited,
  busy,
  renamingId,
  renameValue,
  muted = false,
  onRenameValueChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onToggleActive,
}: {
  title?: string;
  departments: Department[];
  lastEdited: LastAuditMap;
  busy: string | null;
  renamingId: string | null;
  renameValue: string;
  muted?: boolean;
  onRenameValueChange: (value: string) => void;
  onStartRename: (department: Department) => void;
  onCommitRename: (department: Department) => void;
  onCancelRename: () => void;
  onToggleActive: (department: Department) => void;
}) {
  return (
    <SettingsGroup title={title}>
      {departments.length === 0 ? (
        <EmptyState
          inline
          icon="folder"
          title="No departments yet"
          description="Add one to make item ownership and reports easier to scan."
        />
      ) : (
        departments.map((department) => (
          <div key={department.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className={cn("min-w-0 flex-1", muted && "opacity-70")}>
              {renamingId === department.id ? (
                <Input
                  aria-label={`Rename ${department.name}`}
                  value={renameValue}
                  onChange={(e) => onRenameValueChange(e.target.value)}
                  onBlur={() => onCommitRename(department)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onCommitRename(department);
                    if (e.key === "Escape") {
                      onRenameValueChange(department.name);
                      onCancelRename();
                    }
                  }}
                  disabled={busy === `rename-${department.id}`}
                  autoFocus
                  className="h-9 max-w-[280px]"
                />
              ) : (
                <button
                  type="button"
                  className="text-left text-sm font-bold text-foreground hover:text-[var(--wi-red)] transition-colors"
                  onClick={() => onStartRename(department)}
                  title="Click to rename"
                >
                  {department.name}
                </button>
              )}
              <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">
                {usageLabel(department._count)}
                {lastEdited[department.id] ? <> · <LastEditedHint info={lastEdited[department.id]} className="text-[13px]" /></> : null}
              </p>
            </div>
            <OperationalRowActions
              label={`Actions for ${department.name}`}
              icon={busy === `active-${department.id}` ? <Spinner /> : undefined}
            >
              <DropdownMenuItem onSelect={() => onStartRename(department)}>
                <Pencil className="size-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onToggleActive(department)}
                disabled={busy === `active-${department.id}`}
                variant={department.active ? "destructive" : "default"}
              >
                {department.active ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                {department.active ? "Deactivate" : "Reactivate"}
              </DropdownMenuItem>
            </OperationalRowActions>
          </div>
        ))
      )}
    </SettingsGroup>
  );
}
