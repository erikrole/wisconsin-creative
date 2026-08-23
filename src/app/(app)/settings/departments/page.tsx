"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Plus, Power, PowerOff, WifiOff } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFetch } from "@/hooks/use-fetch";
import { useLastAudit, type LastAuditMap } from "@/hooks/use-last-audit";
import { LastEditedHint } from "@/components/LastEditedHint";
import {
  classifyError,
  handleAuthRedirect,
  isAbortError,
  parseErrorMessage,
} from "@/lib/errors";
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

  const description = "Manage the inventory ownership groups used by item forms, filters, item families, and utilization reports.";

  if (loading) {
    return (
      <SettingsPageShell title="Departments" description={description} mainClassName="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
      </SettingsPageShell>
    );
  }

  if (error) {
    const Icon = error === "network" ? WifiOff : AlertTriangle;
    return (
      <SettingsPageShell title="Departments" description={description}>
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
                <Icon className="size-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {error === "network" ? "Could not connect to the server." : "Failed to load departments."}
                </p>
                <Button variant="outline" onClick={reload}>Retry</Button>
              </CardContent>
            </Card>
      </SettingsPageShell>
    );
  }

  const active = items.filter((department) => department.active);
  const inactive = items.filter((department) => !department.active);

  return (
    <SettingsPageShell title="Departments" description={description} mainClassName="flex flex-col gap-4">
          <div className="flex justify-end">
            {!showAdd && (
              <Button className="h-10" onClick={() => setShowAdd(true)}>
                <Plus className="size-4 mr-1.5" />
                Add department
              </Button>
            )}
          </div>

          {showAdd && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">New department</CardTitle>
              </CardHeader>
              <CardContent>
                {addError && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertDescription>{addError}</AlertDescription>
                  </Alert>
                )}
                <form onSubmit={addDepartment} className="flex items-end gap-3 max-sm:flex-col max-sm:items-stretch">
                  <div className="flex-1 flex flex-col gap-1.5">
                    <Label htmlFor="department-name">Name</Label>
                    <Input
                      id="department-name"
                      value={newName}
                      onChange={(e) => { setNewName(e.target.value); setAddError(""); }}
                      placeholder="e.g. Video"
                      required
                      autoFocus
                      disabled={adding}
                    />
                  </div>
                  <Button className="h-10" type="submit" disabled={adding || !newName.trim()}>
                    {adding ? <><Spinner data-icon="inline-start" />Adding...</> : "Add department"}
                  </Button>
                  <Button className="h-10"
                    type="button"
                    variant="outline"
                    onClick={() => { setShowAdd(false); setNewName(""); setAddError(""); }}
                    disabled={adding}
                  >
                    Cancel
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          <DepartmentTable
            title={`Active departments (${active.length})`}
            departments={active}
            lastEdited={lastEdited}
            busy={busy}
            renamingId={renamingId}
            renameValue={renameValue}
            onRenameValueChange={setRenameValue}
            onStartRename={startRename}
            onCommitRename={commitRename}
            onCancelRename={() => setRenamingId(null)}
            onToggleActive={toggleActive}
          />

          {inactive.length > 0 && (
            <DepartmentTable
              title={`Deactivated (${inactive.length})`}
              departments={inactive}
              lastEdited={lastEdited}
              busy={busy}
              renamingId={renamingId}
              renameValue={renameValue}
              muted
              onRenameValueChange={setRenameValue}
              onStartRename={startRename}
              onCommitRename={commitRename}
              onCancelRename={() => setRenamingId(null)}
              onToggleActive={toggleActive}
            />
          )}
    </SettingsPageShell>
  );
}

function DepartmentTable({
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
  title: string;
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
    <Card className={muted ? "opacity-75" : ""}>
      <CardHeader className="pb-0">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      {departments.length === 0 ? (
        <CardContent className="py-0">
          <EmptyState
            inline
            icon="folder"
            title="No departments yet"
            description="Add one to make item ownership and reports easier to scan."
          />
        </CardContent>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Used by</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {departments.map((department) => (
              <TableRow key={department.id}>
                <TableCell>
                  {renamingId === department.id ? (
                    <Input
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
                      className="h-8 max-w-[280px]"
                    />
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        className="text-left font-medium hover:text-[var(--wi-red)] transition-colors"
                        onClick={() => onStartRename(department)}
                        title="Click to rename"
                      >
                        {department.name}
                      </button>
                      <LastEditedHint info={lastEdited[department.id]} />
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {usageLabel(department._count)}
                </TableCell>
                <TableCell className="text-right">
                  <OperationalRowActions
                    label={`Actions for ${department.name}`}
                    icon={busy === `active-${department.id}` ? <Spinner /> : undefined}
                  >
                    <DropdownMenuItem
                      onSelect={() => onToggleActive(department)}
                      disabled={busy === `active-${department.id}`}
                      variant={department.active ? "destructive" : "default"}
                    >
                      {department.active ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                      {department.active ? "Deactivate" : "Reactivate"}
                    </DropdownMenuItem>
                  </OperationalRowActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
