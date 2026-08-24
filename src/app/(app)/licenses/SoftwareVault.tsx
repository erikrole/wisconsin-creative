"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  Check,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { formatRelativeTime } from "@/lib/format";
import type { SoftwareCredentialAudience, SoftwareCredentialSummary } from "./types";

const SUGGESTED_SOFTWARE = ["Envato Elements", "APM Music", "Motion Array"];
const DEFAULT_VISIBLE_TO: SoftwareCredentialAudience[] = ["STAFF", "STUDENT"];
const AUDIENCE_OPTIONS: Array<{
  value: SoftwareCredentialAudience;
  label: string;
  description: string;
}> = [
  { value: "STAFF", label: "Staff", description: "Staff and administrators can always manage the vault." },
  { value: "STUDENT", label: "Students", description: "Students can use this department login." },
  { value: "COLLABORATOR", label: "Collaborators", description: "Only collaborators with Shared software access can use it." },
];

function formatAudience(visibleTo: SoftwareCredentialAudience[]) {
  const labels = visibleTo.map((audience) => AUDIENCE_OPTIONS.find((option) => option.value === audience)?.label ?? audience);
  if (labels.length === 0) return "no audience";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function SecretAction({
  label,
  onClick,
  disabled = false,
  copied = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  copied?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={copied
        ? "size-10 shrink-0 bg-primary/10 text-primary transition-[background-color,color,transform] duration-200 hover:bg-primary/10 hover:text-primary"
        : "size-10 shrink-0 text-muted-foreground transition-[background-color,color,transform] duration-200 hover:text-foreground"}
      aria-label={copied ? `${label} — copied` : label}
      onClick={onClick}
      disabled={disabled}
    >
      {copied ? (
        <Check key="copied" className="size-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-50 motion-safe:duration-200" />
      ) : (
        <Copy key="copy" className="size-4" />
      )}
    </Button>
  );
}

function SoftwareCredentialDialog({
  open,
  editing,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  editing: SoftwareCredentialSummary | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visibleTo, setVisibleTo] = useState<SoftwareCredentialAudience[]>(DEFAULT_VISIBLE_TO);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setCategory(editing?.category ?? "");
    setWebsiteUrl(editing?.websiteUrl ?? "");
    setAccountEmail(editing?.accountEmail ?? "");
    setPassword("");
    setVisibleTo(editing?.visibleTo?.length ? [...editing.visibleTo] : [...DEFAULT_VISIBLE_TO]);
    setErrorMessage(null);
  }, [editing, open]);

  function toggleAudience(audience: SoftwareCredentialAudience, checked: boolean) {
    setVisibleTo((current) => {
      if (checked) return current.includes(audience) ? current : [...current, audience];
      if (current.length === 1) return current;
      return current.filter((value) => value !== audience);
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setErrorMessage(null);

    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        category: category.trim() || null,
        websiteUrl: websiteUrl.trim() || null,
        accountEmail: accountEmail.trim(),
        visibleTo,
      };
      if (password || !editing) body.password = password;

      const res = await fetch(editing ? `/api/software/${editing.id}` : "/api/software", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not save shared login"));

      toast.success(editing ? "Shared login updated" : "Shared login added");
      onOpenChange(false);
      onSaved();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save shared login");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] overflow-y-auto">
        <DialogHeader className="block space-y-1">
          <DialogTitle>{editing ? "Edit shared login" : "Add shared login"}</DialogTitle>
          <DialogDescription>
            Store one department login. Secrets are encrypted before they reach the database.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-6 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="software-name">Software name</Label>
                <Input
                  id="software-name"
                  name="softwareName"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Motion Array"
                  maxLength={120}
                  autoComplete="off"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="software-category">Category</Label>
                <Input
                  id="software-category"
                  name="softwareCategory"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  placeholder="Video, music, design"
                  maxLength={80}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="software-website">Website</Label>
                <Input
                  id="software-website"
                  name="softwareWebsite"
                  type="url"
                  value={websiteUrl}
                  onChange={(event) => setWebsiteUrl(event.target.value)}
                  placeholder="https://..."
                  maxLength={500}
                  autoComplete="url"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="software-email">Department login email</Label>
                <Input
                  id="software-email"
                  name="softwareEmail"
                  type="email"
                  value={accountEmail}
                  onChange={(event) => setAccountEmail(event.target.value)}
                  placeholder="creative@department.wisc.edu"
                  maxLength={320}
                  autoComplete="off"
                  required
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="software-password">
                  Password {editing && <span className="font-normal text-muted-foreground">(leave blank to keep it)</span>}
                </Label>
                <Input
                  id="software-password"
                  name="softwarePassword"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={editing ? "Leave unchanged" : "Enter the department password"}
                  maxLength={500}
                  autoComplete="new-password"
                  required={!editing}
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Passwords stay out of the shared list and audit log. Reveals are explicit and audited.
                </p>
              </div>
              <fieldset className="space-y-2 sm:col-span-2">
                <legend className="text-sm font-medium">Who is this shared with?</legend>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Choose at least one audience. Staff operators can always manage every shared login, even when Staff is not selected.
                </p>
                <div className="grid gap-2">
                  {AUDIENCE_OPTIONS.map((option) => {
                    const checked = visibleTo.includes(option.value);
                    return (
                      <label key={option.value} className="flex min-h-10 cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm">
                        <Checkbox
                          checked={checked}
                          disabled={checked && visibleTo.length === 1}
                          onCheckedChange={(nextChecked) => toggleAudience(option.value, nextChecked === true)}
                          aria-label={option.label}
                        />
                        <span>
                          <span className="block font-medium">{option.label}</span>
                          <span className="block text-xs text-muted-foreground">{option.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
            {errorMessage && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {errorMessage}
              </p>
            )}
          </div>
          <DialogFooter className="border-t pt-5">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} disabled={!name.trim() || !accountEmail.trim() || !visibleTo.length || (!editing && !password)}>
              {editing ? "Save changes" : "Add account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SoftwareVault({ isAdmin }: { isAdmin: boolean }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SoftwareCredentialSummary | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<SoftwareCredentialSummary | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string>>({});
  const [pendingSecretIds, setPendingSecretIds] = useState<Set<string>>(new Set());
  const [pendingMutationIds, setPendingMutationIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const revealTimers = useRef<Record<string, number>>({});
  const copyTimer = useRef<number | null>(null);
  const secretRequestIds = useRef(new Set<string>());
  const mutationIds = useRef(new Set<string>());

  const { data, loading, refreshing, error, lastRefreshed, reload } = useFetch<SoftwareCredentialSummary[]>({
    url: isAdmin ? "/api/software?includeArchived=1" : "/api/software",
    transform: (json) => (json.data as SoftwareCredentialSummary[]) ?? [],
  });

  useEffect(() => {
    const timers = revealTimers.current;
    return () => {
      Object.values(timers).forEach((timer) => window.clearTimeout(timer));
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const records = data ?? [];
  const activeRecords = records.filter((record) => !record.archivedAt);
  const archivedRecords = records.filter((record) => record.archivedAt);

  function openNewForm() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEditForm(record: SoftwareCredentialSummary) {
    clearRevealedPassword(record.id);
    setEditing(record);
    setFormOpen(true);
  }

  function setPendingId(
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
    pending: boolean,
  ) {
    setter((current) => {
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function runSecretRequest<T>(id: string, action: () => Promise<T>): Promise<T | undefined> {
    if (secretRequestIds.current.has(id)) return undefined;
    secretRequestIds.current.add(id);
    setPendingId(setPendingSecretIds, id, true);
    try {
      return await action();
    } finally {
      secretRequestIds.current.delete(id);
      setPendingId(setPendingSecretIds, id, false);
    }
  }

  async function runMutation<T>(id: string, action: () => Promise<T>): Promise<T | undefined> {
    if (mutationIds.current.has(id)) return undefined;
    mutationIds.current.add(id);
    setPendingId(setPendingMutationIds, id, true);
    try {
      return await action();
    } finally {
      mutationIds.current.delete(id);
      setPendingId(setPendingMutationIds, id, false);
    }
  }

  async function requestPassword(id: string): Promise<string> {
    const res = await fetch(`/api/software/${id}/secret`, { method: "POST" });
    if (handleAuthRedirect(res)) throw new Error("Session expired");
    if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not retrieve password"));
    const json = await parseJsonSafely<{ data?: { password?: unknown } }>(res);
    const password = json?.data?.password;
    if (typeof password !== "string" || !password) throw new Error("Password response was incomplete");
    return password;
  }

  function holdRevealedPassword(id: string, password: string) {
    setRevealedPasswords((current) => ({ ...current, [id]: password }));
    if (revealTimers.current[id]) window.clearTimeout(revealTimers.current[id]);
    revealTimers.current[id] = window.setTimeout(() => {
      setRevealedPasswords((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      delete revealTimers.current[id];
    }, 30_000);
  }

  function clearRevealedPassword(id: string) {
    if (revealTimers.current[id]) {
      window.clearTimeout(revealTimers.current[id]);
      delete revealTimers.current[id];
    }
    setRevealedPasswords((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function togglePassword(record: SoftwareCredentialSummary) {
    if (revealedPasswords[record.id]) {
      clearRevealedPassword(record.id);
      return;
    }

    try {
      const password = await runSecretRequest(record.id, () => requestPassword(record.id));
      if (password) holdRevealedPassword(record.id, password);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not retrieve password");
    }
  }

  async function copyEmail(record: SoftwareCredentialSummary) {
    try {
      await navigator.clipboard.writeText(record.accountEmail);
      showCopied(`${record.id}:email`);
      toast.success("Login email copied");
    } catch {
      toast.error("Could not copy the login email. Select it and copy manually.");
    }
  }

  async function copyPassword(record: SoftwareCredentialSummary) {
    try {
      const password = revealedPasswords[record.id]
        ?? await runSecretRequest(record.id, () => requestPassword(record.id));
      if (!password) return;
      await navigator.clipboard.writeText(password);
      showCopied(`${record.id}:password`);
      toast.success("Password copied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not copy the password");
    }
  }

  function showCopied(id: string) {
    setCopiedId(id);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => {
      setCopiedId(null);
      copyTimer.current = null;
    }, 1500);
  }

  async function archiveRecord() {
    if (!archiveTarget) return;
    const target = archiveTarget;
    try {
      const archived = await runMutation(target.id, async () => {
        const res = await fetch(`/api/software/${target.id}`, { method: "DELETE" });
        if (handleAuthRedirect(res)) return false;
        if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not archive shared login"));
        return true;
      });
      if (!archived) return;
      clearRevealedPassword(target.id);
      toast.success(`${target.name} archived`);
      setArchiveTarget(null);
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not archive shared login");
    }
  }

  async function restoreRecord(record: SoftwareCredentialSummary) {
    try {
      const restored = await runMutation(record.id, async () => {
        const res = await fetch(`/api/software/${record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived: false }),
        });
        if (handleAuthRedirect(res)) return false;
        if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not restore shared login"));
        return true;
      });
      if (!restored) return;
      toast.success(`${record.name} restored`);
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not restore shared login");
    }
  }

  function renderCard(record: SoftwareCredentialSummary) {
    const password = revealedPasswords[record.id];
    const isArchived = Boolean(record.archivedAt);
    const secretPending = pendingSecretIds.has(record.id);
    const mutationPending = pendingMutationIds.has(record.id);

    return (
      <Card key={record.id} className={isArchived ? "opacity-70" : undefined} aria-busy={secretPending || mutationPending || undefined}>
        <CardHeader className="gap-3 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={isArchived ? "gray" : "outline"} size="sm">
                  {isArchived ? "Archived" : record.category || "Department account"}
                </Badge>
                {!isArchived && <LockKeyhole className="size-3.5 text-muted-foreground" aria-label="Password protected" />}
              </div>
              <CardTitle className="truncate text-base">{record.name}</CardTitle>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {record.websiteUrl && !isArchived && (
                <Button asChild type="button" variant="ghost" size="icon" className="size-10 text-muted-foreground hover:text-foreground">
                  <a href={record.websiteUrl} target="_blank" rel="noreferrer" aria-label={`Open ${record.name} website`}>
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              )}
              {isAdmin && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-10 text-muted-foreground hover:text-foreground"
                  aria-label={`Edit ${record.name}`}
                  onClick={() => openEditForm(record)}
                  disabled={mutationPending}
                >
                  <Pencil className="size-4" />
                </Button>
              )}
            </div>
          </div>
          <CardDescription>
            <span className="block">{isArchived ? "Archived from the shared-login list." : "Department login · available to the authorized team"}</span>
            {!isArchived && (
              <>
                <span className="mt-1 block text-xs">Shared with {formatAudience(record.visibleTo)}. Staff operators can always manage it.</span>
                <span className="mt-1 block text-xs">Updated {formatRelativeTime(record.updatedAt, new Date())}</span>
              </>
            )}
          </CardDescription>
        </CardHeader>
        {!isArchived ? (
          <CardContent className="space-y-3 pt-2">
            <div className="rounded-md border bg-muted/20 px-3 py-2">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Login email</p>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">{record.accountEmail}</span>
                <SecretAction
                  label={`Copy ${record.name} login email`}
                  onClick={() => copyEmail(record)}
                  copied={copiedId === `${record.id}:email`}
                />
              </div>
            </div>
            <div className="rounded-md border bg-muted/20 px-3 py-2">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Password</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all font-mono text-sm text-foreground" aria-live="polite">
                  {password ?? "••••••••••••"}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-10 shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={password ? `Hide ${record.name} password` : `Show ${record.name} password`}
                  aria-pressed={Boolean(password)}
                  onClick={() => togglePassword(record)}
                  disabled={secretPending}
                >
                  {secretPending
                    ? <RefreshCw className="size-4 animate-spin" />
                    : password ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
                <SecretAction
                  label={`Copy ${record.name} password`}
                  onClick={() => copyPassword(record)}
                  copied={copiedId === `${record.id}:password`}
                  disabled={secretPending}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Reveal or copy only when you need it. Reveals are logged.</p>
            </div>
          </CardContent>
        ) : (
          <CardContent className="pt-2">
            <p className="text-sm text-muted-foreground">Restore this account to make its login available again.</p>
          </CardContent>
        )}
        {isAdmin && (
          <CardFooter className="justify-between gap-3 border-t pt-4">
            {isArchived ? (
              <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => restoreRecord(record)} loading={mutationPending}>
                Restore account
              </Button>
            ) : (
              <Button type="button" variant="ghost" size="sm" className="h-10 text-muted-foreground hover:text-destructive" onClick={() => setArchiveTarget(record)} disabled={mutationPending}>
                <Archive data-icon="inline-start" />
                Archive
              </Button>
            )}
            <span className="text-xs text-muted-foreground">Admin / staff control</span>
          </CardFooter>
        )}
      </Card>
    );
  }

  return (
    <section aria-labelledby="shared-logins-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="shared-logins-title" className="sr-only">Shared logins</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {!loading && !error ? `${activeRecords.length} active. ` : null}
            Copy a department email or password. Reveals are logged.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && archivedRecords.length > 0 && (
            <Button
              type="button"
              variant={showArchived ? "secondary" : "outline"}
              size="sm"
              className="h-10"
              onClick={() => setShowArchived((current) => !current)}
              aria-pressed={showArchived}
            >
              <Archive data-icon="inline-start" />
              {showArchived ? "Hide archived" : `Archived (${archivedRecords.length})`}
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="size-10" onClick={reload} disabled={loading || refreshing} aria-label="Refresh shared logins">
                <RefreshCw className={refreshing ? "animate-spin" : undefined} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {lastRefreshed ? `Updated ${formatRelativeTime(lastRefreshed.toISOString(), new Date())}` : "Refresh shared logins"}
            </TooltipContent>
          </Tooltip>
          {isAdmin && (
            <Button type="button" className="h-10" onClick={openNewForm}>
              <Plus data-icon="inline-start" />
              Add shared login
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-[var(--blue)]/25 bg-[var(--blue-bg)]/35 px-4 py-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--blue-text)]" />
        <p className="leading-relaxed text-muted-foreground">
          Account emails and passwords are encrypted. Password access is always deliberate, rate-limited, and logged.
        </p>
      </div>

      {loading && activeRecords.length === 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading shared logins">
          {Array.from({ length: 3 }, (_, index) => (
            <Card key={index}>
              <CardHeader><Skeleton className="h-4 w-28" /><Skeleton className="h-5 w-44" /></CardHeader>
              <CardContent className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></CardContent>
            </Card>
          ))}
        </div>
      ) : error && records.length === 0 ? (
        <EmptyState icon="wifi-off" title="Couldn't load shared logins" description="Check your connection and try again." actionLabel="Retry" onAction={reload} />
      ) : activeRecords.length === 0 ? (
        <Card className="border-dashed" elevation="flat">
          <CardContent className="py-8 text-center">
            <LockKeyhole className="mx-auto mb-3 size-6 text-muted-foreground" />
            <h3 className="font-medium">No active shared logins</h3>
            <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
              {archivedRecords.length > 0
                ? "Archived logins are kept out of the active list until a staff operator restores them."
                : `Add the department logins your crew reaches for most often. Suggested entries: ${SUGGESTED_SOFTWARE.join(", ")}.`}
            </p>
            {isAdmin && archivedRecords.length > 0 ? (
              <Button type="button" variant="outline" className="mt-4 h-10" onClick={() => setShowArchived(true)}>
                <Archive data-icon="inline-start" />
                Review archived
              </Button>
            ) : isAdmin ? (
              <Button type="button" className="mt-4 h-10" onClick={openNewForm}><Plus data-icon="inline-start" />Add first shared login</Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{activeRecords.map(renderCard)}</div>
      )}

      {isAdmin && showArchived && archivedRecords.length > 0 && (
        <div className="space-y-3 rounded-lg border bg-muted/10 p-4">
          <div>
            <h3 className="text-sm font-semibold">Archived shared logins</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Restore a login to return it to the active team list.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{archivedRecords.map(renderCard)}</div>
        </div>
      )}

      <SoftwareCredentialDialog
        open={formOpen}
        editing={editing}
        onOpenChange={setFormOpen}
        onSaved={reload}
      />

      <AlertDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open && archiveTarget && !pendingMutationIds.has(archiveTarget.id)) setArchiveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiveTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the login from the team list without deleting its encrypted record. Staff operators can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(archiveTarget && pendingMutationIds.has(archiveTarget.id))}>Keep login</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={Boolean(archiveTarget && pendingMutationIds.has(archiveTarget.id))}
              onClick={(event) => {
                event.preventDefault();
                void archiveRecord();
              }}
            >
              {archiveTarget && pendingMutationIds.has(archiveTarget.id) && <RefreshCw className="size-4 animate-spin" />}
              Archive login
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
