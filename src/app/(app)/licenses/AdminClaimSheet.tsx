"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Trash2, Archive, AlertCircle, KeyRound, RefreshCw } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format";
import { handleAuthRedirect, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import {
  encodeLicenseExpiryDate,
  isLicenseExpired,
  licenseDaysUntilExpiry,
  licenseExpiryInputValue,
} from "@/lib/license-dates";
import type { LicenseCode } from "./types";

type ClaimRecord = {
  id: string;
  userId: string | null;
  occupantLabel: string | null;
  claimedAt: string;
  releasedAt: string | null;
  user: { id: string; name: string; avatarUrl: string | null } | null;
};

type Props = {
  license: LicenseCode | null;
  isAdmin: boolean;
  hasMyLicense: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: () => void;
};

type LicenseHistoryResponse = {
  data?: ClaimRecord[];
};

type AssignableUser = {
  id: string;
  name: string;
  role: "ADMIN" | "STAFF" | "STUDENT";
};

async function throwLicenseError(res: Response, fallback: string) {
  if (handleAuthRedirect(res)) return true;
  if (!res.ok) throw new Error(await parseErrorMessage(res, fallback));
  return false;
}

export function AdminClaimSheet({ license, isAdmin, hasMyLicense, onOpenChange, onAction }: Props) {
  const [history, setHistory] = useState<ClaimRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [occupantLabel, setOccupantLabel] = useState("");
  const [addingOccupant, setAddingOccupant] = useState(false);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [assigningUser, setAssigningUser] = useState(false);
  const [editExpiry, setEditExpiry] = useState("");
  const [editAccount, setEditAccount] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const lastLicenseIdRef = useRef<string | null>(null);

  const licenseId = license?.id ?? null;

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    if (!licenseId) return;
    setLoadingHistory(true);
    setHistoryError(false);
    try {
      const res = await fetch(`/api/licenses/${licenseId}/history`, { signal });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to load license history"));
      const json = await parseJsonSafely<LicenseHistoryResponse>(res);
      setHistory(json?.data ?? []);
    } catch (err) {
      if (isAbortError(err)) return;
      setHistory([]);
      setHistoryError(true);
    } finally {
      if (!signal?.aborted) setLoadingHistory(false);
    }
  }, [licenseId]);

  useEffect(() => {
    if (!license) {
      lastLicenseIdRef.current = null;
      setHistory([]);
      setHistoryError(false);
      return;
    }
    // Only reset form state when a DIFFERENT license opens — the license prop
    // refreshes in place after list reloads and must not clobber in-progress edits.
    if (lastLicenseIdRef.current === license.id) return;
    lastLicenseIdRef.current = license.id;
    setEditExpiry(license.expiresAt ? licenseExpiryInputValue(license.expiresAt) : "");
    setEditAccount(license.accountEmail ?? "");
    setEditLabel(license.label ?? "");
    setHistory([]);
    setSelectedUserId("");
    setUsersLoading(true);
    void fetch("/api/users?limit=200&active=true&sort=name")
      .then(async (res) => {
        if (await throwLicenseError(res, "Failed to load users")) return null;
        return parseJsonSafely<{ data?: AssignableUser[] }>(res);
      })
      .then((json) => setUsers(json?.data ?? []))
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false));
    const controller = new AbortController();
    void loadHistory(controller.signal);
    return () => controller.abort();
  }, [license, loadHistory]);

  async function handleReleaseClaim(claimId?: string) {
    if (!license) return;
    const key = claimId ?? "all";
    setReleasing(key);
    try {
      const res = await fetch(`/api/licenses/${license.id}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(claimId ? { claimId } : { all: true }),
      });
      if (await throwLicenseError(res, "Failed to release")) return;
      toast.success(claimId ? "Slot released" : "All slots released");
      onAction();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setReleasing(null);
    }
  }

  async function handleClaimSlot() {
    if (!license || claiming) return;
    setClaiming(true);
    try {
      const res = await fetch(`/api/licenses/${license.id}/claim`, { method: "POST" });
      if (await throwLicenseError(res, "Failed to claim license")) return;
      // Claimed — clipboard may still fail (Safari gesture rules); never report that as failure.
      const json = await parseJsonSafely<{ data?: { code?: string } }>(res);
      const code = json?.data?.code;
      let copied = false;
      if (code) {
        try {
          await navigator.clipboard.writeText(code);
          copied = true;
        } catch {
          copied = false;
        }
      }
      toast.success(copied ? "Slot claimed and code copied to clipboard" : "Slot claimed", {
        description: copied ? code : "Copy the code from your license banner.",
        duration: 6000,
      });
      onAction();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setClaiming(false);
    }
  }

  async function handleAddOccupant(e: React.FormEvent) {
    e.preventDefault();
    if (!license || !occupantLabel.trim()) return;
    setAddingOccupant(true);
    try {
      const res = await fetch(`/api/licenses/${license.id}/occupy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: occupantLabel.trim() }),
      });
      if (await throwLicenseError(res, "Failed to add occupant")) return;
      toast.success("Unknown occupant recorded");
      setOccupantLabel("");
      onAction();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAddingOccupant(false);
    }
  }

  async function handleAssignUser(e: React.FormEvent) {
    e.preventDefault();
    if (!license || !selectedUserId || assigningUser) return;
    const assignee = users.find((candidate) => candidate.id === selectedUserId);
    setAssigningUser(true);
    try {
      const res = await fetch(`/api/licenses/${license.id}/occupy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId }),
      });
      if (await throwLicenseError(res, "Failed to assign license")) return;
      toast.success(`License assigned to ${assignee?.name ?? "user"}`);
      setSelectedUserId("");
      onAction();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAssigningUser(false);
    }
  }

  async function handleSaveDetails() {
    if (!license) return;
    setSavingDetails(true);
    try {
      const res = await fetch(`/api/licenses/${license.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: editLabel.trim(),
          accountEmail: editAccount.trim() || null,
          expiresAt: editExpiry ? encodeLicenseExpiryDate(editExpiry) : null,
        }),
      });
      if (await throwLicenseError(res, "Could not save license details")) return;
      toast.success("License details updated");
      onAction();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "License details were not saved");
    } finally {
      setSavingDetails(false);
    }
  }

  async function handleRetire() {
    if (!license || retiring) return;
    setRetiring(true);
    try {
      const res = await fetch(`/api/licenses/${license.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retire: true }),
      });
      if (await throwLicenseError(res, "Failed to retire license")) return;
      toast.success("License retired");
      onAction();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRetiring(false);
    }
  }

  async function handleDelete() {
    if (!license || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/licenses/${license.id}`, { method: "DELETE" });
      if (await throwLicenseError(res, "Failed to delete license")) return;
      toast.success("License deleted");
      onAction();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDeleting(false);
    }
  }

  const activeClaims = license?.claims ?? [];
  const canAddOccupant = isAdmin && activeClaims.length < 2;
  const daysLeft = license?.expiresAt ? licenseDaysUntilExpiry(license.expiresAt) : null;
  const isExpired = license?.expiresAt ? isLicenseExpired(license.expiresAt) : false;
  const isExpiringSoon = daysLeft != null && !isExpired && daysLeft <= 30;

  return (
    <Sheet open={!!license} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto p-6 sm:max-w-lg sm:p-8">
        <SheetHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <SheetTitle className="font-mono text-sm break-all">{license?.code}</SheetTitle>
            {isExpired && <Badge variant="destructive" className="text-xs">Expired</Badge>}
            {isExpiringSoon && (
              <Badge variant="orange" className="text-xs">
                Expiring soon
              </Badge>
            )}
          </div>
          <SheetDescription className="flex flex-col gap-0.5">
            {license?.label && <span className="block">{license.label}</span>}
            {license?.accountEmail && (
              <span className="block text-xs text-muted-foreground">{license.accountEmail}</span>
            )}
            {!license?.label && !license?.accountEmail && <span>License details</span>}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-8 flex flex-col gap-8">
          {/* Active slots */}
          <section className="flex flex-col gap-4">
            <h3 className="text-sm font-medium">Active slots ({activeClaims.length}/2)</h3>
            {activeClaims.length === 0 ? (
              <p className="text-xs text-muted-foreground">Both slots are open.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {activeClaims.map((claim) => {
                  const name = claim.user?.name ?? claim.occupantLabel ?? "Unknown";
                  return (
                    <div
                      key={claim.id}
                      className="flex items-center gap-2 rounded-md border bg-card p-2"
                    >
                      <UserAvatar name={name} avatarUrl={claim.user?.avatarUrl} size="default" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatRelativeTime(claim.claimedAt, new Date())}
                          {claim.userId === null && " · unknown user"}
                        </p>
                      </div>
                      {isAdmin && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              className="h-10 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                              disabled={!!releasing}
                            >
                              {releasing === claim.id ? "…" : "Release"}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Release slot for {name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                The slot returns to the pool immediately. {name} will need to claim it again.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleReleaseClaim(claim.id)}>
                                Release
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {isAdmin && license?.status !== "RETIRED" && activeClaims.length < 2 && (
              <div className="flex flex-col gap-1.5">
                <Button
                  variant="outline"
                  className="h-10 gap-1.5"
                  onClick={handleClaimSlot}
                  disabled={claiming || hasMyLicense}
                >
                  <KeyRound className="size-3.5" />
                  {claiming ? "Claiming…" : "Claim open slot"}
                </Button>
                {hasMyLicense && (
                  <p className="text-xs text-muted-foreground">
                    Return your current license before claiming another.
                  </p>
                )}
              </div>
            )}
            {isAdmin && activeClaims.length > 1 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-10 text-destructive hover:text-destructive"
                    disabled={!!releasing}
                  >
                    {releasing === "all" ? "Releasing all…" : "Release all slots"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Release all slots?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Both holders will be removed from this license. They will need to claim it again.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleReleaseClaim()}>
                      Release all
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </section>

          {/* Add unknown occupant */}
          {canAddOccupant && (
            <>
              <Separator />
              <section className="flex flex-col gap-4">
                <h3 className="text-sm font-medium">Assign open slot</h3>
                <form onSubmit={handleAssignUser} className="flex flex-col gap-2">
                  <Label htmlFor="license-assignee" className="text-xs">User</Label>
                  <div className="flex gap-2">
                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                      <SelectTrigger id="license-assignee" className="flex-1">
                        <SelectValue placeholder={usersLoading ? "Loading users…" : "Select a user"} />
                      </SelectTrigger>
                      <SelectContent>
                        {users.map((candidate) => (
                          <SelectItem key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button className="h-10" type="submit" disabled={assigningUser || !selectedUserId}>
                      {assigningUser ? "Assigning…" : "Assign"}
                    </Button>
                  </div>
                </form>

                <Separator />
                <h3 className="text-sm font-medium">Mark slot occupied</h3>
                <form onSubmit={handleAddOccupant} className="flex flex-col gap-2">
                  <Label htmlFor="occupant-name" className="text-xs">Occupant name</Label>
                  <div className="flex gap-2">
                    <Input
                      id="occupant-name"
                      name="occupantName"
                      autoComplete="off"
                      value={occupantLabel}
                      onChange={(e) => setOccupantLabel(e.target.value)}
                      className="flex-1"
                    />
                    <Button className="h-10" type="submit" disabled={addingOccupant || !occupantLabel.trim()}>
                      {addingOccupant ? "…" : "Add"}
                    </Button>
                  </div>
                </form>
              </section>
            </>
          )}

          {/* Details (admin) */}
          {isAdmin && (
            <>
              <Separator />
              <section className="flex flex-col gap-5">
                <h3 className="text-sm font-medium">Details</h3>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="license-label" className="text-xs">Label</Label>
                  <Input
                    id="license-label"
                    name="licenseLabel"
                    value={editLabel}
                    maxLength={200}
                    onChange={(e) => setEditLabel(e.target.value)}
                    placeholder="Optional internal label"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="account" className="text-xs">Account email</Label>
                  <Input
                    id="account"
                    name="accountEmail"
                    type="email"
                    autoComplete="email"
                    value={editAccount}
                    maxLength={254}
                    onChange={(e) => setEditAccount(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="expiry" className="text-xs">Annual expiry</Label>
                  <Input
                    id="expiry"
                    name="expiresAt"
                    type="date"
                    autoComplete="off"
                    value={editExpiry}
                    onChange={(e) => setEditExpiry(e.target.value)}
                  />
                </div>
                <Button className="h-10"
                  variant="outline"
                  onClick={handleSaveDetails}
                  disabled={savingDetails}
                  loading={savingDetails}
                >
                  Save details
                </Button>
              </section>
            </>
          )}

          {/* Danger zone */}
          {isAdmin && (
            <>
              <Separator />
              <section className="flex flex-col gap-4">
                <h3 className="text-sm font-medium text-muted-foreground">Danger zone</h3>
                <div className="flex gap-2 flex-wrap">
                  {license?.status === "AVAILABLE" && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button className="h-10" variant="outline" disabled={retiring}>
                          <Archive className="size-3.5 mr-1.5" />
                          {retiring ? "Retiring..." : "Retire"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Retire this license?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Retired licenses are hidden from students but kept for the audit log.
                            You can show them again from the page header.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={handleRetire} disabled={retiring}>
                            {retiring ? "Retiring..." : "Retire"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  {activeClaims.length === 0 && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          className="h-10 text-destructive hover:text-destructive"
                          disabled={deleting}
                        >
                          <Trash2 className="size-3.5 mr-1.5" />
                          {deleting ? "Deleting..." : "Delete"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle className="flex items-center gap-2">
                            <AlertCircle className="size-4 text-destructive" />
                            Delete this license?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes the license code and all of its claim history.
                            This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleDelete}
                            disabled={deleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {deleting ? "Deleting..." : "Delete"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
                {activeClaims.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Release all slots before retiring or deleting.
                  </p>
                )}
              </section>
            </>
          )}

          <Separator />

          {/* History */}
          <section className="flex flex-col gap-3 pb-8">
            <h3 className="text-sm font-medium">Claim history</h3>
            {loadingHistory ? (
              <div className="flex flex-col gap-2" aria-label="Loading claim history">
                <div className="h-10 rounded-md bg-muted/60" />
                <div className="h-10 rounded-md bg-muted/60" />
              </div>
            ) : historyError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Claim history could not load. Retry before auditing this license.</span>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 gap-1.5 text-xs"
                    onClick={() => void loadHistory()}
                  >
                    <RefreshCw className="size-3" />
                    Retry
                  </Button>
                </div>
              </div>
            ) : history.length === 0 ? (
              <p className="text-xs text-muted-foreground">No claims yet</p>
            ) : (
              <div className="flex flex-col gap-2">
                {history.map((claim) => {
                  const name = claim.user?.name ?? claim.occupantLabel ?? "Unknown";
                  return (
                    <div key={claim.id} className="flex items-center gap-2 text-sm">
                      <UserAvatar name={name} avatarUrl={claim.user?.avatarUrl} size="sm" />
                      <span className="flex-1 truncate">{name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatRelativeTime(claim.claimedAt, new Date())}
                        {claim.releasedAt
                          ? ` → ${formatRelativeTime(claim.releasedAt, new Date())}`
                          : " (active)"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
