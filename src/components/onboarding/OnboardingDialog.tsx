"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, FileUp, ShieldCheck, UserPlus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { classifyError, handleAuthRedirect, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";

type Role = "ADMIN" | "STAFF" | "STUDENT" | "COLLABORATOR";
type InviteRole = "STAFF" | "STUDENT" | "COLLABORATOR";
type InviteMode = "bulk" | "single";
type InvitePreviewStatus = "ready" | "duplicate" | "invalid-email" | "invalid-role" | "role-blocked";
type ServerPreviewStatus = "ready" | "duplicate" | "existing_user" | "pending_invite" | "claimed_invite";

type InviteResponse = {
  skipped?: boolean | number;
  created?: number;
  failed?: number;
  failedRows?: FailedInviteRow[];
};

type FailedInviteRow = {
  email: string;
  role: InviteRole;
  reason: string;
};

type CompletionResult = {
  created: number;
  skipped: number;
  requested: number;
  failed: number;
  failedRows: FailedInviteRow[];
};

type InvitePreviewRow = {
  line: number;
  email: string;
  role: InviteRole;
  status: InvitePreviewStatus;
  reason: string;
};

type ServerPreviewRow = {
  email: string;
  requestedRole: InviteRole;
  status: ServerPreviewStatus;
  existingRole?: Role;
};

type ServerPreviewResponse = {
  rows: ServerPreviewRow[];
  summary: Record<ServerPreviewStatus, number>;
};

type ActiveCollaboratorPolicy = {
  id: string;
  status: "ACTIVE" | "SUSPENDED";
  capabilities: string[];
  affiliation: {
    displayName: string;
    badgeLabel: string;
  };
};

type OnboardingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserRole: Role | null;
  onInvitesChanged?: () => void;
};

function emailLooksValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if ((char === "," || char === "\t") && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }

  cells.push(cell.trim());
  return cells;
}

function normalizeInviteRole(rawRole: string, fallback: InviteRole): InviteRole | null {
  const normalized = rawRole.trim().toUpperCase();
  if (!normalized) return fallback;
  if (["STAFF", "EMPLOYEE", "COACH"].includes(normalized)) return "STAFF";
  if (["STUDENT", "STU", "ATHLETE"].includes(normalized)) return "STUDENT";
  if (["COLLABORATOR", "BTN", "BIG TEN NETWORK"].includes(normalized)) return "COLLABORATOR";
  return null;
}

function rowTokensForLine(line: string): Array<{ email: string; rawRole: string }> {
  const csvCells = splitCsvLine(line);
  const first = csvCells[0]?.trim() ?? "";
  const second = csvCells[1]?.trim() ?? "";
  const secondLooksLikeRole = !!second && !second.includes("@");

  if (csvCells.length > 1 && secondLooksLikeRole) {
    return [{ email: first, rawRole: second }];
  }

  return line
    .split(/[\s,;]+/)
    .map((email) => ({ email: email.trim(), rawRole: "" }))
    .filter((entry) => entry.email.length > 0);
}

function previewInviteRows(raw: string, fallbackRole: InviteRole, allowedRoles: InviteRole[]): InvitePreviewRow[] {
  const rows: InvitePreviewRow[] = [];
  const seen = new Set<string>();

  raw.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const tokens = rowTokensForLine(trimmed);
    const firstEmail = tokens[0]?.email.trim().toLowerCase() ?? "";
    if (index === 0 && ["email", "email address", "campus email"].includes(firstEmail)) return;

    for (const token of tokens) {
      const email = token.email.trim().toLowerCase();
      const role = normalizeInviteRole(token.rawRole, fallbackRole);

      if (!emailLooksValid(email)) {
        rows.push({
          line: index + 1,
          email: token.email.trim(),
          role: role ?? fallbackRole,
          status: "invalid-email",
          reason: "Email is not valid",
        });
        continue;
      }

      if (!role) {
        rows.push({
          line: index + 1,
          email,
          role: fallbackRole,
          status: "invalid-role",
          reason: "Role must be Staff, Student, or Collaborator",
        });
        continue;
      }

      if (!allowedRoles.includes(role)) {
        rows.push({
          line: index + 1,
          email,
          role,
          status: "role-blocked",
          reason: "Your role cannot invite this account role",
        });
        continue;
      }

      if (seen.has(email)) {
        rows.push({
          line: index + 1,
          email,
          role,
          status: "duplicate",
          reason: "Duplicate in this paste",
        });
        continue;
      }

      seen.add(email);
      rows.push({
        line: index + 1,
        email,
        role,
        status: "ready",
        reason: "Ready",
      });
    }
  });

  return rows;
}

function inviteRoleOptionsFor(currentUserRole: Role | null): Array<{ value: InviteRole; label: string }> {
  const options: Array<{ value: InviteRole; label: string }> = [{ value: "STUDENT", label: "Student" }];
  if (currentUserRole === "ADMIN") {
    options.unshift(
      { value: "STAFF", label: "Staff" },
      { value: "COLLABORATOR", label: "Collaborator" },
    );
  }
  return options;
}

function inviteProfileFields(role: InviteRole, collaboratorPolicyId: string) {
  return role === "COLLABORATOR"
    ? { collaboratorPolicyId }
    : {};
}

function serverPreviewLabel(status: ServerPreviewStatus): string {
  switch (status) {
    case "existing_user":
      return "Existing user";
    case "pending_invite":
      return "Pending invite";
    case "claimed_invite":
      return "Claimed invite";
    case "duplicate":
      return "Duplicate";
    case "ready":
      return "Ready";
  }
}

function OnboardingMetricCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <Card elevation="flat" className="bg-muted/20">
      <CardHeader className="p-3 pb-1">
        <CardDescription className="text-xs font-medium">{label}</CardDescription>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function OnboardingStatusCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <Card elevation="flat" className="bg-background">
      <CardHeader className="p-2 pb-0">
        <CardDescription className="text-xs font-medium">{label}</CardDescription>
      </CardHeader>
      <CardContent className="p-2 pt-0">
        <div className="text-lg font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function OnboardingDialog({
  open,
  onOpenChange,
  currentUserRole,
  onInvitesChanged,
}: OnboardingDialogProps) {
  const [inviteMode, setInviteMode] = useState<InviteMode>("bulk");
  const [inviteRole, setInviteRole] = useState<InviteRole>("STUDENT");
  const [singleEmail, setSingleEmail] = useState("");
  const [bulkEmails, setBulkEmails] = useState("");
  const [bulkFileName, setBulkFileName] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviting, setInviting] = useState(false);
  const [serverPreview, setServerPreview] = useState<(ServerPreviewResponse & { signature: string }) | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [completion, setCompletion] = useState<CompletionResult | null>(null);
  const [collaboratorPolicies, setCollaboratorPolicies] = useState<ActiveCollaboratorPolicy[]>([]);
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [policiesLoading, setPoliciesLoading] = useState(false);

  const inviteRoleOptions = useMemo(() => inviteRoleOptionsFor(currentUserRole), [currentUserRole]);
  const allowedInviteRoles = useMemo(() => inviteRoleOptions.map((option) => option.value), [inviteRoleOptions]);
  const previewRows = useMemo(
    () => previewInviteRows(bulkEmails, inviteRole, allowedInviteRoles),
    [allowedInviteRoles, bulkEmails, inviteRole],
  );
  const readyPreviewRows = useMemo(
    () => previewRows.filter((row) => row.status === "ready"),
    [previewRows],
  );
  // Identifies the exact ready set a server preview was computed for, so a
  // stale preview can never gate a commit for different rows.
  const readySignature = useMemo(
    () => `${selectedPolicyId}\n${readyPreviewRows.map((row) => `${row.email}:${row.role}`).join("\n")}`,
    [readyPreviewRows, selectedPolicyId],
  );
  const needsCollaboratorPolicy = inviteMode === "single"
    ? inviteRole === "COLLABORATOR"
    : readyPreviewRows.some((row) => row.role === "COLLABORATOR");
  const selectedPolicy = collaboratorPolicies.find((policy) => policy.id === selectedPolicyId) ?? null;
  const previewCounts = useMemo(() => {
    const counts: Record<InvitePreviewStatus, number> = {
      ready: 0,
      duplicate: 0,
      "invalid-email": 0,
      "invalid-role": 0,
      "role-blocked": 0,
    };
    for (const row of previewRows) {
      counts[row.status] += 1;
    }
    return counts;
  }, [previewRows]);
  const blockingPreviewCount = previewRows.length - previewCounts.ready;
  const overBulkLimit = readyPreviewRows.length > 50;
  const rawServerPreviewRows = serverPreview?.rows;
  const serverPreviewRows = useMemo(() => rawServerPreviewRows ?? [], [rawServerPreviewRows]);
  const serverPreviewSummary = serverPreview?.summary ?? {
    ready: 0,
    duplicate: 0,
    existing_user: 0,
    pending_invite: 0,
    claimed_invite: 0,
  };
  const serverBlockingRows = useMemo(
    () => serverPreviewRows.filter((row) => row.status !== "ready"),
    [serverPreviewRows],
  );
  const serverReadyEmails = useMemo(
    () => new Set(serverPreviewRows.filter((row) => row.status === "ready").map((row) => row.email)),
    [serverPreviewRows],
  );
  const finalReadyPreviewRows = useMemo(
    () => readyPreviewRows.filter((row) => serverReadyEmails.has(row.email)),
    [readyPreviewRows, serverReadyEmails],
  );
  const serverPreviewComplete = serverPreview !== null && serverPreview.signature === readySignature;
  const submitLabel = inviteMode === "bulk" && finalReadyPreviewRows.length > 0
    ? `Add ${finalReadyPreviewRows.length} invitation${finalReadyPreviewRows.length === 1 ? "" : "s"}`
    : "Add invitation";

  useEffect(() => {
    if (!open) return;
    const inviteOptions = inviteRoleOptionsFor(currentUserRole);
    setInviteRole(inviteOptions.some((option) => option.value === "STUDENT") ? "STUDENT" : inviteOptions[0]?.value ?? "STUDENT");
    setInviteMode("bulk");
    setSingleEmail("");
    setBulkEmails("");
    setBulkFileName("");
    setInviteError("");
    setServerPreview(null);
    setPreviewing(false);
    setPreviewError("");
    setCompletion(null);
  }, [currentUserRole, open]);

  useEffect(() => {
    if (!open || currentUserRole !== "ADMIN") return;
    const controller = new AbortController();
    setPoliciesLoading(true);
    void fetch("/api/collaborator-affiliations", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await parseErrorMessage(response, "Failed to load affiliations"));
        const result = await parseJsonSafely<{ data: ActiveCollaboratorPolicy[] }>(response);
        const active = (result?.data ?? []).filter((policy) => policy.status === "ACTIVE");
        setCollaboratorPolicies(active);
        setSelectedPolicyId((current) => active.some((policy) => policy.id === current) ? current : active[0]?.id ?? "");
      })
      .catch((error) => {
        if (!isAbortError(error)) setInviteError(error instanceof Error ? error.message : "Failed to load affiliations");
      })
      .finally(() => {
        if (!controller.signal.aborted) setPoliciesLoading(false);
      });
    return () => controller.abort();
  }, [currentUserRole, open]);

  useEffect(() => {
    if (
      !open ||
      inviteMode !== "bulk" ||
      readyPreviewRows.length === 0 ||
      blockingPreviewCount > 0 ||
      overBulkLimit
      || (needsCollaboratorPolicy && !selectedPolicyId)
    ) {
      setServerPreview(null);
      setPreviewing(false);
      setPreviewError("");
      return;
    }

    if (serverPreview) {
      if (serverPreview.signature === readySignature) return;
      // The rows changed since this preview was fetched; drop it before refetching.
      setServerPreview(null);
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewing(true);
      setPreviewError("");
      try {
        const response = await fetch("/api/allowed-emails/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emails: readyPreviewRows.map((row) => ({
              email: row.email,
              role: row.role,
              ...inviteProfileFields(row.role, selectedPolicyId),
            })),
          }),
          signal: controller.signal,
        });

        if (handleAuthRedirect(response, "/settings/allowed-emails")) return;

        if (!response.ok) {
          const message = await parseErrorMessage(response, "Failed to preview account status");
          setPreviewError(message);
          setServerPreview(null);
          return;
        }

        const result = await parseJsonSafely<ServerPreviewResponse>(response);
        if (!result) {
          setPreviewError("Account status preview could not be read. Try again before saving.");
          setServerPreview(null);
          return;
        }

        setServerPreview({ ...result, signature: readySignature });
      } catch (error) {
        if (isAbortError(error)) return;
        const kind = classifyError(error);
        setPreviewError(kind === "network" ? "You're offline. Check your connection." : "Failed to preview account status");
        setServerPreview(null);
      } finally {
        if (!controller.signal.aborted) {
          setPreviewing(false);
        }
      }
    }, 400);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [blockingPreviewCount, inviteMode, needsCollaboratorPolicy, open, overBulkLimit, readyPreviewRows, readySignature, selectedPolicyId, serverPreview]);

  function resetForAnother() {
    setCompletion(null);
    setInviteError("");
    setPreviewError("");
    setServerPreview(null);
    setSingleEmail("");
    setBulkEmails("");
    setBulkFileName("");
  }

  function retryFailed() {
    if (!completion || completion.failedRows.length === 0) return;
    setCompletion(null);
    setInviteMode("bulk");
    setSingleEmail("");
    setBulkEmails(completion.failedRows.map((row) => `${row.email}, ${row.role.toLowerCase()}`).join("\n"));
    setBulkFileName("");
    setInviteError("");
    setPreviewError("");
    setServerPreview(null);
  }

  function failedRowsForAttempt(rows: Array<{ email: string; role: InviteRole }>, reason: string): FailedInviteRow[] {
    return rows.map((row) => ({ ...row, reason }));
  }

  function showFailedAttempt(rows: Array<{ email: string; role: InviteRole }>, reason: string) {
    const failedRows = failedRowsForAttempt(rows, reason);
    setInviteError("");
    setCompletion({
      requested: failedRows.length,
      created: 0,
      skipped: 0,
      failed: failedRows.length,
      failedRows,
    });
  }

  async function handleBulkFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2_000_000) {
      setInviteError("CSV files must be smaller than 2 MB.");
      return;
    }
    try {
      const text = await file.text();
      setBulkEmails(text);
      setBulkFileName(file.name);
      setInviteError("");
    } catch {
      setInviteError("That CSV could not be read. Try saving it as UTF-8 and upload it again.");
    }
  }

  async function handleInviteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteError("");

    const emails = inviteMode === "single" ? [singleEmail.trim().toLowerCase()].filter(Boolean) : finalReadyPreviewRows.map((row) => row.email);
    const attemptedRows = inviteMode === "single"
      ? emails.map((email) => ({ email, role: inviteRole }))
      : finalReadyPreviewRows.map((row) => ({ email: row.email, role: row.role }));
    if (emails.length === 0) {
      const message = inviteMode === "single" ? "Email address is required." : "Paste at least one email.";
      setInviteError(message);
      toast.error(message);
      return;
    }
    if (needsCollaboratorPolicy && !selectedPolicyId) {
      const message = "Select an active collaborator affiliation before saving.";
      setInviteError(message);
      toast.error(message);
      return;
    }
    if (inviteMode === "bulk" && blockingPreviewCount > 0) {
      const message = "Fix preview issues before saving invitations.";
      setInviteError(message);
      toast.error(message);
      return;
    }
    if (inviteMode === "bulk" && (overBulkLimit || previewing || previewError || !serverPreviewComplete || serverBlockingRows.length > 0)) {
      const message = "Review account status before saving invitations.";
      setInviteError(message);
      toast.error(message);
      return;
    }
    if (emails.length > 50) {
      const message = `Too many addresses. Max 50 per batch, got ${emails.length}.`;
      setInviteError(message);
      toast.error(message);
      return;
    }

    const malformed = emails.filter((email) => !emailLooksValid(email));
    if (malformed.length > 0) {
      const message = `Looks invalid: ${malformed.slice(0, 3).join(", ")}${malformed.length > 3 ? "..." : ""}`;
      setInviteError(message);
      toast.error(message);
      return;
    }

    setInviting(true);
    try {
      const body = inviteMode === "single"
        ? { email: emails[0], role: inviteRole, ...inviteProfileFields(inviteRole, selectedPolicyId) }
        : {
            emails: finalReadyPreviewRows.map((row) => ({
              email: row.email,
              role: row.role,
              ...inviteProfileFields(row.role, selectedPolicyId),
            })),
          };
      const response = await fetch("/api/allowed-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (handleAuthRedirect(response, "/settings/allowed-emails")) return;

      if (!response.ok) {
        const message = await parseErrorMessage(response, "Failed to save invitations");
        showFailedAttempt(attemptedRows, message);
        toast.error(message);
        return;
      }

      const result = await parseJsonSafely<InviteResponse>(response);
      if (!result) {
        const message = "The server did not confirm these invitations. Retry the failed rows.";
        showFailedAttempt(attemptedRows, message);
        toast.error(message);
        return;
      }
      const failed = result.failed ?? result.failedRows?.length ?? 0;
      const failedRows = result.failedRows?.length
        ? result.failedRows
        : failed > 0
          ? failedRowsForAttempt(attemptedRows, "The server did not confirm this invitation")
          : [];
      if (inviteMode === "single") {
        if (result?.skipped === true) {
          toast.message("No new invitation was created. This address is already allowlisted or registered.");
        } else {
          toast.success("Invitation added");
        }
      } else {
        const created = result?.created ?? 0;
        const skipped = typeof result?.skipped === "number" ? result.skipped : 0;
        if (created > 0 && skipped === 0) {
          toast.success(`Added ${created} invitation${created === 1 ? "" : "s"}`);
        } else if (created > 0) {
          toast.success(`Added ${created}; skipped ${skipped} already allowlisted or registered`);
        } else {
          toast.message("All addresses were already allowlisted or registered.");
        }
      }

      if ((result.created ?? (result.skipped === true ? 0 : 1)) > 0) onInvitesChanged?.();
      setSingleEmail("");
      setBulkEmails("");
      setBulkFileName("");
      setInviteError("");
      setCompletion({
        created: result?.created ?? (result?.skipped === true ? 0 : 1),
        skipped: typeof result?.skipped === "number" ? result.skipped : result?.skipped === true ? 1 : 0,
        requested: emails.length,
        failed,
        failedRows,
      });
    } catch (error) {
      if (isAbortError(error)) return;
      const kind = classifyError(error);
      const message = kind === "network" ? "You're offline. Check your connection." : "Failed to save invitations";
      showFailedAttempt(attemptedRows, message);
      toast.error(message);
    } finally {
      setInviting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!inviting) onOpenChange(next); }}>
      <DialogContent className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl">
        <DialogHeader className="pr-10">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UserPlus aria-hidden="true" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <DialogTitle className="text-wrap-balance">Add users</DialogTitle>
              <DialogDescription className="text-wrap-pretty">
                  Grant app access to one person or paste a roster.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {completion ? (
          <>
            <DialogBody className="min-h-0 overflow-y-auto flex flex-col gap-4 py-5">
              <Alert className={completion.failed > 0 ? "border-[var(--orange)]/50 bg-[var(--orange-bg)]" : "border-[var(--green)]/40 bg-[var(--green-bg)]"}>
                {completion.failed > 0 ? <AlertCircle className="size-4 text-[var(--orange-text)]" /> : <CheckCircle2 className="size-4 text-[var(--green-text)]" />}
                <AlertTitle>{completion.failed > 0 ? "Some invitations need attention" : "Invitations saved"}</AlertTitle>
                <AlertDescription className="text-muted-foreground">
                  {completion.failed > 0
                    ? "These rows were not confirmed by the server. Retry them below; existing rows are safe to retry because the server skips duplicates."
                    : "Send users to the app login page. They enter their invited email and are routed to password setup automatically. No shared first-login password is created."}
                </AlertDescription>
              </Alert>

              <div className={`grid grid-cols-2 gap-2 ${completion.failed > 0 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
                <OnboardingMetricCard label="Requested" value={completion.requested} />
                <OnboardingMetricCard label="Added" value={completion.created} />
                <OnboardingMetricCard label="Skipped" value={completion.skipped} />
                {completion.failed > 0 && <OnboardingMetricCard label="Failed" value={completion.failed} />}
              </div>

              {completion.failed > 0 && (
                <div className="grid gap-2 rounded-lg border border-[var(--orange)]/40 bg-[var(--orange-bg)]/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">Failed rows</p>
                    <Badge variant="orange" size="sm">Retry available</Badge>
                  </div>
                  <div className="grid max-h-40 gap-1 overflow-y-auto text-xs">
                    {completion.failedRows.slice(0, 8).map((row) => (
                      <div key={`${row.email}-${row.role}`} className="flex items-start justify-between gap-3 rounded-sm bg-background px-2 py-1.5">
                        <span className="min-w-0 truncate">{row.email}</span>
                        <span className="shrink-0 text-muted-foreground">{row.reason}</span>
                      </div>
                    ))}
                  </div>
                  {completion.failedRows.length > 8 && <p className="text-xs text-muted-foreground">Showing 8 of {completion.failedRows.length} failed rows.</p>}
                </div>
              )}
            </DialogBody>

            <DialogFooter className="border-t border-border/40 px-6 py-4">
              {completion.failed > 0 && (
                <Button type="button" className="h-10" onClick={retryFailed}>
                  Retry failed invitations
                </Button>
              )}
              <Button type="button" variant="outline" className="h-10" onClick={resetForAnother}>
                Add another
              </Button>
              <Button asChild variant="outline" className="h-10" onClick={() => onOpenChange(false)}>
                <Link href="/users/onboarding-status">View status</Link>
              </Button>
              <Button type="button" className="h-10" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleInviteSubmit} className="contents">
            <DialogBody className="min-h-0 overflow-y-auto flex flex-col gap-4 py-5">
              <Alert>
                <ShieldCheck aria-hidden="true" />
                <AlertTitle>Invite-only access</AlertTitle>
                <AlertDescription>
                  Users set their own password the first time they sign in. Existing registered or already-invited addresses are skipped without exposing private account details.
                </AlertDescription>
              </Alert>

              <Tabs value={inviteMode} onValueChange={(value) => { setInviteMode(value as InviteMode); setInviteError(""); }} className="grid gap-4">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="bulk">Paste a roster</TabsTrigger>
                  <TabsTrigger value="single">Add one person</TabsTrigger>
                </TabsList>

                <TabsContent value="bulk" className="m-0">
                  <div className="grid gap-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                      <Label htmlFor="onboard-bulk-emails">Paste a roster or upload a CSV</Label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button className="h-10" type="button" variant="outline" asChild disabled={inviting}>
                          <label htmlFor="onboard-bulk-file">
                            <FileUp data-icon="inline-start" />
                            Upload CSV
                          </label>
                        </Button>
                        <input id="onboard-bulk-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={handleBulkFileChange} disabled={inviting} />
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="onboard-bulk-role" className="text-xs font-normal text-muted-foreground whitespace-nowrap">Role for all</Label>
                        <Select name="bulkInvitationRole" value={inviteRole} onValueChange={(value) => setInviteRole(value as InviteRole)} disabled={inviting}>
                          <SelectTrigger id="onboard-bulk-role" className="h-9 w-[130px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {inviteRoleOptions.map((option) => (
                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Textarea
                      id="onboard-bulk-emails"
                      name="bulkInvitationRows"
                      value={bulkEmails}
                      onChange={(event) => { setBulkEmails(event.target.value); setInviteError(""); }}
                      placeholder={"email, role\nalice@school.edu, student\ncoach@school.edu, staff\ntrey@example.com, collaborator"}
                      rows={7}
                      disabled={inviting}
                      className="w-full font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      {bulkFileName ? `Loaded ${bulkFileName}. ` : "Paste plain emails or CSV rows with `email, role`. "}Admins may use `collaborator`; those rows use the affiliation selected below. Blank roles use the selected default. Max 50 ready rows per batch.
                    </p>
                  </div>
                  {previewRows.length > 0 && (
                    <div className="mt-3 grid gap-3 rounded-lg bg-muted/20 p-3 shadow-[0_1px_0_rgba(15,23,42,0.05)]">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <OnboardingStatusCard label="Ready" value={previewCounts.ready} />
                        <OnboardingStatusCard label="Duplicates" value={previewCounts.duplicate} />
                        <OnboardingStatusCard label="Invalid" value={previewCounts["invalid-email"] + previewCounts["invalid-role"]} />
                        <OnboardingStatusCard label="Blocked" value={previewCounts["role-blocked"]} />
                      </div>

                      {blockingPreviewCount > 0 ? (
                        <div className="grid gap-2">
                          <p className="text-xs font-medium text-destructive">Fix these rows before saving.</p>
                          <div className="grid max-h-36 gap-1 overflow-auto text-xs">
                            {previewRows.filter((row) => row.status !== "ready").slice(0, 6).map((row) => (
                              <div key={`${row.line}-${row.email}-${row.status}`} className="flex items-center justify-between gap-2 rounded-sm bg-background px-2 py-1.5">
                                <span className="min-w-0 truncate">Line {row.line}: {row.email || "blank email"}</span>
                                <Badge variant="orange" size="sm">{row.reason}</Badge>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {readyPreviewRows.length} invitation{readyPreviewRows.length === 1 ? "" : "s"} ready. Existing registered or already-invited addresses may still be skipped by the server.
                        </p>
                      )}
                    </div>
                  )}

                  {overBulkLimit && (
                    <Alert variant="destructive" className="mt-3">
                      <AlertCircle className="size-4" />
                      <AlertDescription>Reduce the batch to 50 ready invitations before saving.</AlertDescription>
                    </Alert>
                  )}

                  {blockingPreviewCount === 0 && readyPreviewRows.length > 0 && !overBulkLimit && (
                    <div className="mt-3 grid gap-3 rounded-lg bg-background p-3 shadow-[0_1px_0_rgba(15,23,42,0.05)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">Account status</div>
                          <p className="text-xs text-muted-foreground">Authenticated preview checks existing users and invitations before commit.</p>
                        </div>
                        {previewing && <Spinner />}
                      </div>

                      {previewError ? (
                        <Alert variant="destructive">
                          <AlertCircle className="size-4" />
                          <AlertDescription>{previewError}</AlertDescription>
                        </Alert>
                      ) : serverPreviewComplete ? (
                        <>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <OnboardingStatusCard label="Ready to save" value={serverPreviewSummary.ready} />
                            <OnboardingStatusCard label="Existing users" value={serverPreviewSummary.existing_user} />
                            <OnboardingStatusCard label="Pending invites" value={serverPreviewSummary.pending_invite} />
                            <OnboardingStatusCard label="Claimed invites" value={serverPreviewSummary.claimed_invite} />
                          </div>

                          {serverBlockingRows.length > 0 ? (
                            <div className="grid gap-2">
                              <p className="text-xs font-medium text-destructive">Remove or correct these rows before saving.</p>
                              <div className="grid max-h-36 gap-1 overflow-auto text-xs">
                                {serverBlockingRows.slice(0, 6).map((row) => (
                                  <div key={`${row.email}-${row.status}`} className="flex items-center justify-between gap-2 rounded-sm bg-muted/30 px-2 py-1.5">
                                    <span className="min-w-0 truncate">{row.email}</span>
                                    <Badge variant="orange" size="sm">{serverPreviewLabel(row.status)}</Badge>
                                  </div>
                                ))}
                                </div>
                              </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              All {finalReadyPreviewRows.length} invitation{finalReadyPreviewRows.length === 1 ? "" : "s"} {finalReadyPreviewRows.length === 1 ? "is" : "are"} ready to save.
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">Waiting for account-status preview...</p>
                      )}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="single" className="m-0">
                  <div className="grid grid-cols-[minmax(0,1fr)_160px] gap-3 max-sm:grid-cols-1">
                    <div className="grid gap-1.5">
                      <Label htmlFor="onboard-single-email">Email address</Label>
                      <Input
                        id="onboard-single-email"
                        name="singleInvitationEmail"
                        type="email"
                        value={singleEmail}
                        onChange={(event) => { setSingleEmail(event.target.value); setInviteError(""); }}
                        placeholder="user@example.com"
                        disabled={inviting}
                        autoComplete="email"
                        className="h-10"
                      />
                    </div>
                    <div className="grid content-start gap-1.5">
                      <Label htmlFor="onboard-single-role">Role</Label>
                      <Select name="singleInvitationRole" value={inviteRole} onValueChange={(value) => setInviteRole(value as InviteRole)} disabled={inviting}>
                        <SelectTrigger id="onboard-single-role" className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {inviteRoleOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              {needsCollaboratorPolicy && (
                <div className="grid gap-2 rounded-lg border p-3">
                  <Label htmlFor="onboard-collaborator-policy">Affiliation policy</Label>
                  <Select value={selectedPolicyId} onValueChange={setSelectedPolicyId} disabled={inviting || policiesLoading}>
                    <SelectTrigger id="onboard-collaborator-policy" className="h-10">
                      <SelectValue placeholder={policiesLoading ? "Loading affiliations…" : "Select an active affiliation"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {collaboratorPolicies.map((policy) => (
                          <SelectItem key={policy.id} value={policy.id}>
                            {policy.affiliation.displayName} ({policy.affiliation.badgeLabel})
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {selectedPolicy ? (
                    <p className="text-xs text-muted-foreground">
                      {selectedPolicy.capabilities.length} effective access control{selectedPolicy.capabilities.length === 1 ? "" : "s"}. Review details in Collaborator Access settings.
                    </p>
                  ) : !policiesLoading ? (
                    <p className="text-xs text-destructive">No active affiliation is available. Configure and activate one in Collaborator Access settings.</p>
                  ) : null}
                </div>
              )}

              {inviteError && (
                <Alert variant="destructive">
                  <AlertCircle className="size-4" />
                  <AlertDescription>{inviteError}</AlertDescription>
                </Alert>
              )}
            </DialogBody>

            <DialogFooter className="border-t border-border/40 px-6 py-4">
              <Button type="button" variant="outline" className="h-10" onClick={() => onOpenChange(false)} disabled={inviting}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="h-10"
                disabled={
                  inviting ||
                  (needsCollaboratorPolicy && !selectedPolicyId) ||
                  (inviteMode === "bulk"
                    ? finalReadyPreviewRows.length === 0 ||
                      blockingPreviewCount > 0 ||
                      overBulkLimit ||
                      previewing ||
                      !!previewError ||
                      !serverPreviewComplete ||
                      serverBlockingRows.length > 0
                    : singleEmail.trim().length === 0)
                }
              >
                {inviting && <Spinner data-icon="inline-start" />}
                {inviting ? "Saving..." : submitLabel}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
