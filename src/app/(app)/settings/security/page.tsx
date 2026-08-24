"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/server";
import { KeyRound, Loader2, Monitor, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/EmptyState";
import { useFetch } from "@/hooks/use-fetch";
import { useCurrentUser } from "@/hooks/use-current-user";
import { AccountUsernameField, passwordRulesAttribute } from "@/components/auth/AccountUsernameField";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { handleAuthRedirect, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { isPasskeyCancellation, passkeyErrorMessage, passkeyStorageLabel } from "@/lib/passkey-client";
import { SettingsPageShell } from "../SettingsPageShell";

type Session = {
  id: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
};

type Passkey = {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: string | null;
  backedUp: boolean;
};

export default function SecuritySettingsPage() {
  // The address a password manager should file these credentials under. Every
  // password box on this page otherwise stands alone.
  const { data: currentUser } = useCurrentUser();
  const accountEmail = currentUser?.email ?? "";

  // ── Sessions ──────────────────────────────────────────────────────────────
  const { data, loading, error, reload } = useFetch<{ data: Session[] }>({
    url: "/api/me/sessions",
    returnTo: "/settings/security",
  });
  const sessions = data?.data ?? [];

  const { data: passkeyData, loading: passkeysLoading, error: passkeysError, reload: reloadPasskeys } = useFetch<Passkey[] | { data: Passkey[] }>({
    url: "/api/me/passkeys",
    returnTo: "/settings/security",
  });
  const passkeys = Array.isArray(passkeyData) ? passkeyData : passkeyData?.data ?? [];

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const revokingRef = useRef(false);

  async function handleRevokeOne(id: string) {
    if (revokingRef.current) return;
    revokingRef.current = true;
    setRevokingId(id);
    try {
      const res = await fetch(`/api/me/sessions/${id}`, { method: "DELETE" });
      if (res.status === 401) { handleAuthRedirect(res, "/settings/security"); return; }
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Could not sign out session.");
        toast.error(msg);
        return;
      }
      toast.success("Session signed out.");
      reload();
    } catch (err) {
      if (isAbortError(err)) return;
      toast.error("Could not reach the server. Check your connection.");
    } finally {
      revokingRef.current = false;
      setRevokingId(null);
    }
  }

  async function handleRevokeAll() {
    if (revokingRef.current) return;
    revokingRef.current = true;
    setRevokingAll(true);
    try {
      const res = await fetch("/api/me/sessions", { method: "DELETE" });
      if (res.status === 401) { handleAuthRedirect(res, "/settings/security"); return; }
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Could not sign out other sessions.");
        toast.error(msg);
        return;
      }
      const json = await parseJsonSafely<{ revokedCount?: number }>(res);
      const count = json?.revokedCount ?? 0;
      toast.success(count === 0 ? "No other sessions to sign out." : `Signed out ${count} other session${count === 1 ? "" : "s"}.`);
      reload();
    } catch (err) {
      if (isAbortError(err)) return;
      toast.error("Could not reach the server. Check your connection.");
    } finally {
      revokingRef.current = false;
      setRevokingAll(false);
    }
  }

  // ── Change password ───────────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revokeOthers, setRevokeOthers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const savingRef = useRef(false);

  // ── Passkeys ──────────────────────────────────────────────────────────────
  const [passkeyCurrentPassword, setPasskeyCurrentPassword] = useState("");
  const [passkeyName, setPasskeyName] = useState("");
  const [passkeySaving, setPasskeySaving] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeySupported, setPasskeySupported] = useState(true);
  const passkeySavingRef = useRef(false);

  // Removal reauthenticates on its own instead of borrowing the enrollment
  // form's password field, which left the delete button silently inert.
  const [removalTarget, setRemovalTarget] = useState<Passkey | null>(null);
  const [removalPassword, setRemovalPassword] = useState("");
  const [removalError, setRemovalError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    setPasskeySupported(browserSupportsWebAuthn());
  }, []);

  async function handleRegisterPasskey(e: React.FormEvent) {
    e.preventDefault();
    if (passkeySavingRef.current) return;
    setPasskeyError(null);

    passkeySavingRef.current = true;
    setPasskeySaving(true);
    try {
      const optionsResponse = await fetch("/api/auth/passkey/registration/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: passkeyCurrentPassword }),
      });
      if (!optionsResponse.ok) {
        setPasskeyError(await parseErrorMessage(optionsResponse, "Could not start passkey setup."));
        return;
      }
      const optionsBody = await parseJsonSafely<{ options?: PublicKeyCredentialCreationOptionsJSON }>(optionsResponse);
      if (!optionsBody?.options) {
        setPasskeyError("Could not start passkey setup.");
        return;
      }

      const attestation = await startRegistration({ optionsJSON: optionsBody.options });
      const verifyResponse = await fetch("/api/auth/passkey/registration/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation, name: passkeyName }),
      });
      if (!verifyResponse.ok) {
        setPasskeyError(await parseErrorMessage(verifyResponse, "Passkey setup failed. Try again."));
        return;
      }

      toast.success("Passkey added.");
      setPasskeyCurrentPassword("");
      setPasskeyName("");
      reloadPasskeys();
    } catch (error) {
      if (isAbortError(error) || isPasskeyCancellation(error)) return;
      setPasskeyError(passkeyErrorMessage(error, "register"));
    } finally {
      passkeySavingRef.current = false;
      setPasskeySaving(false);
    }
  }

  function openPasskeyRemoval(passkey: Passkey) {
    setRemovalTarget(passkey);
    setRemovalPassword("");
    setRemovalError(null);
  }

  function closePasskeyRemoval() {
    if (removing) return;
    setRemovalTarget(null);
    setRemovalPassword("");
    setRemovalError(null);
  }

  async function handleRevokePasskey(e: React.FormEvent) {
    e.preventDefault();
    const passkey = removalTarget;
    if (!passkey || removing) return;
    if (!removalPassword) {
      setRemovalError("Enter your current password to confirm.");
      return;
    }

    setRemoving(true);
    setRemovalError(null);
    try {
      const res = await fetch(`/api/me/passkeys/${passkey.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: removalPassword }),
      });
      if (res.status === 401) { handleAuthRedirect(res, "/settings/security"); return; }
      if (!res.ok) {
        setRemovalError(await parseErrorMessage(res, "Could not remove passkey."));
        return;
      }
      toast.success(`${passkey.name || "Passkey"} removed.`);
      setRemovalTarget(null);
      setRemovalPassword("");
      reloadPasskeys();
    } catch (error) {
      if (isAbortError(error)) return;
      setRemovalError("Could not reach the server. Check your connection.");
    } finally {
      setRemoving(false);
    }
  }

  function resetForm() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setRevokeOthers(false);
    setPwError(null);
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;
    setPwError(null);

    if (newPassword !== confirmPassword) {
      setPwError("New passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const res = await fetch("/api/me/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions: revokeOthers }),
      });
      if (res.status === 401) { handleAuthRedirect(res, "/settings/security"); return; }
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to change password.");
        setPwError(msg);
        return;
      }
      toast.success("Password changed.");
      resetForm();
      if (revokeOthers) reload();
    } catch (err) {
      if (isAbortError(err)) return;
      toast.error("Could not reach the server. Check your connection.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const otherSessions = sessions.filter((s) => !s.isCurrent);
  const revoking = revokingId !== null || revokingAll;

  return (
    <SettingsPageShell title="Security" description="Manage passkeys, your password, and active sessions.">
      <div className="flex flex-col gap-4">
        {/* Passkeys */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Passkeys</CardTitle>
            <p className="text-sm text-muted-foreground">
              Use Face ID, Touch ID, or your device security to sign in without typing a password.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {passkeySupported ? (
              <form onSubmit={handleRegisterPasskey} className="flex flex-col gap-4">
                <AccountUsernameField email={accountEmail} id="passkey-username" />
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="passkey-current-pw">Current password</Label>
                    <Input
                      id="passkey-current-pw"
                      name="passkeyCurrentPassword"
                      type="password"
                      autoComplete="current-password"
                      value={passkeyCurrentPassword}
                      onChange={(e) => setPasskeyCurrentPassword(e.target.value)}
                      required
                      disabled={passkeySaving}
                      aria-describedby="passkey-current-pw-help"
                    />
                    <p id="passkey-current-pw-help" className="text-xs text-muted-foreground">
                      Confirms it is you before this device is trusted.
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="passkey-name">Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input
                      id="passkey-name"
                      name="passkeyName"
                      value={passkeyName}
                      onChange={(e) => setPasskeyName(e.target.value)}
                      placeholder="MacBook, iPhone, or security key"
                      maxLength={80}
                      disabled={passkeySaving}
                      aria-describedby="passkey-name-help"
                    />
                    <p id="passkey-name-help" className="text-xs text-muted-foreground">
                      Leave blank to name it after this browser and device.
                    </p>
                  </div>
                </div>
                {passkeyError && <p className="text-sm text-destructive" role="alert">{passkeyError}</p>}
                <div className="flex justify-end">
                  <Button type="submit" disabled={passkeySaving || !passkeyCurrentPassword}>
                    {passkeySaving ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                    {passkeySaving ? "Waiting for passkey…" : "Add passkey"}
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                This browser cannot create passkeys. Sign in with your password here, and add a passkey
                from Safari, Chrome, or the Gear Tracker iPhone app instead.
              </p>
            )}

            <div className="border-t pt-4">
              <h3 className="text-sm font-medium mb-3">Your passkeys</h3>
              {passkeysLoading ? (
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-12 w-full rounded-lg" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                </div>
              ) : passkeysError ? (
                <EmptyState
                  inline
                  icon="box"
                  title="Could not load passkeys"
                  description="Retry before managing your passkeys."
                  actionLabel="Retry"
                  onAction={reloadPasskeys}
                />
              ) : passkeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">No passkeys have been added yet.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {passkeys.map((passkey) => {
                    const storage = passkeyStorageLabel(passkey.deviceType, passkey.backedUp);
                    return (
                      <li key={passkey.id} className="flex items-center gap-3 px-4 py-3">
                        <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">{passkey.name || "Passkey"}</p>
                            {storage && <Badge variant="secondary" className="text-xs shrink-0">{storage}</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Added {new Date(passkey.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                            {passkey.lastUsedAt
                              ? ` · Used ${new Date(passkey.lastUsedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                              : " · Not used yet"}
                          </p>
                        </div>
                        <Button className="h-10"
                          type="button"
                          variant="ghost"
                          disabled={passkeySaving || removing}
                          onClick={() => openPasskeyRemoval(passkey)}
                        >
                          <Trash2 className="size-4" />
                          <span className="sr-only">Remove {passkey.name || "passkey"}</span>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Change password */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
              <AccountUsernameField email={accountEmail} id="security-username" />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="security-current-pw">Current password</Label>
                <Input
                  id="security-current-pw"
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  disabled={saving}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="security-new-pw">New password</Label>
                <Input
                  id="security-new-pw"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  {...passwordRulesAttribute}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  disabled={saving}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="security-confirm-pw">Confirm new password</Label>
                <Input
                  id="security-confirm-pw"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  {...passwordRulesAttribute}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  aria-invalid={!!pwError}
                  disabled={saving}
                />
                {pwError && <p className="text-xs text-destructive">{pwError}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="security-revoke-others"
                  name="revokeOtherSessions"
                  aria-label="Sign out of all other devices"
                  checked={revokeOthers}
                  onCheckedChange={(v) => setRevokeOthers(!!v)}
                  disabled={saving}
                />
                <Label htmlFor="security-revoke-others" className="font-normal text-sm">
                  Sign out of all other devices
                </Label>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={saving || !currentPassword || !newPassword || !confirmPassword}>
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {saving ? "Saving…" : "Change password"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Active sessions */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-base">Active sessions</CardTitle>
              {otherSessions.length > 0 && (
                <Button className="h-10"
                  variant="outline"
                  disabled={revoking}
                  onClick={handleRevokeAll}
                >
                  {revokingAll && <Loader2 className="size-4 animate-spin" />}
                  Sign out all other devices
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex flex-col gap-3 p-4 pt-0">
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
              </div>
            ) : error ? (
              <div className="px-2 pb-2">
                <EmptyState
                  inline
                  icon={error === "network" ? "wifi-off" : "box"}
                  title={error === "network" ? "You are offline" : "Could not load sessions"}
                  description={error === "network" ? "Check your connection and retry." : "Retry before managing active sessions."}
                  actionLabel="Retry"
                  onAction={reload}
                />
              </div>
            ) : sessions.length === 0 ? (
              <div className="px-2 pb-2">
                <EmptyState
                  inline
                  icon="check"
                  title="No active sessions found"
                  description="Only current, unexpired sessions appear here."
                />
              </div>
            ) : (
              <ul className="divide-y">
                {sessions.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-6 py-3">
                    <Monitor className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {new Date(s.createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                        {s.isCurrent && (
                          <Badge variant="secondary" className="text-xs">This device</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Expires{" "}
                        {new Date(s.expiresAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    {!s.isCurrent && (
                      <Button className="h-10"
                        variant="ghost"
                        disabled={revoking}
                        onClick={() => handleRevokeOne(s.id)}
                      >
                        {revokingId === s.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                        <span className="sr-only">Sign out</span>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!removalTarget} onOpenChange={(open) => { if (!open) closePasskeyRemoval(); }}>
        <DialogContent>
          <form onSubmit={handleRevokePasskey} className="flex flex-col gap-4">
            <AccountUsernameField email={accountEmail} id="passkey-removal-username" />
            <DialogHeader>
              <DialogTitle>Remove {removalTarget?.name || "this passkey"}?</DialogTitle>
              <DialogDescription>
                This device will stop signing you in with Face ID, Touch ID, or your device unlock.
                Your password still works, and you can add a passkey again later.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="passkey-removal-pw">Current password</Label>
              <Input
                id="passkey-removal-pw"
                name="passkeyRemovalPassword"
                type="password"
                autoComplete="current-password"
                value={removalPassword}
                onChange={(e) => { setRemovalPassword(e.target.value); setRemovalError(null); }}
                required
                autoFocus
                disabled={removing}
                aria-invalid={!!removalError}
              />
              {removalError && <p className="text-sm text-destructive" role="alert">{removalError}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closePasskeyRemoval} disabled={removing}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={removing || !removalPassword}>
                {removing && <Loader2 className="size-4 animate-spin" />}
                {removing ? "Removing…" : "Remove passkey"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsPageShell>
  );
}
