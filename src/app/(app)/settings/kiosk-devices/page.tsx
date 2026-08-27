"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import StatusIndicator from "@/components/ui/status-indicator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Copy,
  Monitor,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  ShoppingBag,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { handleAuthRedirect, parseErrorMessage, classifyError, isAbortError, parseJsonSafely } from "@/lib/errors";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useFetch } from "@/hooks/use-fetch";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SettingsPageShell } from "../SettingsPageShell";

type PendingPickup = {
  id: string;
  title: string;
  requesterName: string;
  startsAt: string;
  endsAt: string;
};

type KioskDevice = {
  id: string;
  name: string;
  locationId: string;
  location: { id: string; name: string };
  active: boolean;
  activated: boolean;
  activatedAt: string | null;
  lastSeenAt: string | null;
  appVersion: string | null;
  appBuild: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  createdAt: string;
  pendingPickupCount: number;
  openCheckoutCount: number;
  pendingPickups: PendingPickup[];
};

type LocationOption = { id: string; name: string };
type ErrorState = { type: "network" | "server" | "auth"; message: string };

/** Online = heartbeat in last 5 min, Recent = last 24h, Offline = stale */
function connectionStatus(device: KioskDevice): "online" | "recent" | "offline" | "inactive" {
  if (!device.activated || !device.active) return "inactive";
  if (!device.lastSeenAt) return "offline";
  const mins = (Date.now() - new Date(device.lastSeenAt).getTime()) / 60000;
  if (mins <= 5) return "online";
  if (mins <= 60 * 24) return "recent";
  return "offline";
}

function kioskHealth(device: KioskDevice): {
  state: "active" | "down" | "fixing" | "idle";
  label: string;
  description: string;
} {
  if (!device.active) {
    return {
      state: "idle",
      label: "Deactivated",
      description: "This kiosk is inactive and cannot use its device session.",
    };
  }
  if (!device.activated) {
    return {
      state: "idle",
      label: "Pending activation",
      description: "This kiosk needs an activation code entered on the iPad.",
    };
  }

  const status = connectionStatus(device);
  if (status === "online") {
    return {
      state: "active",
      label: "Online",
      description: "This kiosk checked in within the last 5 minutes.",
    };
  }
  if (status === "recent") {
    return {
      state: "fixing",
      label: "Heartbeat stale",
      description: "This kiosk has checked in within 24 hours but not within the last 5 minutes.",
    };
  }
  return {
    state: "down",
    label: "Offline",
    description: device.lastSeenAt
      ? "This kiosk has not checked in for over 24 hours."
      : "This kiosk has not checked in yet.",
  };
}

export default function KioskDevicesPage() {
  const confirm = useConfirm();

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [cancellingPickupId, setCancellingPickupId] = useState<string | null>(null);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addLocationId, setAddLocationId] = useState("");
  const [adding, setAdding] = useState(false);

  // Activation code display
  const [codeDialog, setCodeDialog] = useState<{ name: string; code: string } | null>(null);

  // Pending pickup clear dialog
  const [pickupDialog, setPickupDialog] = useState<KioskDevice | null>(null);

  const {
    data: devices,
    loading,
    error: fetchError,
    reload: load,
  } = useFetch<KioskDevice[]>({
    url: "/api/kiosk-devices",
    returnTo: "/settings/kiosk-devices",
  });

  const {
    data: formOptions,
    loading: formOptionsLoading,
    error: formOptionsError,
    reload: reloadFormOptions,
  } = useFetch<{ locations: LocationOption[] }>({
    url: "/api/form-options",
    returnTo: "/settings/kiosk-devices",
    transform: (json) => (json as Record<string, unknown>).data as { locations: LocationOption[] },
    refetchOnFocus: false,
  });
  const locations = formOptions?.locations ?? [];
  const locationsUnavailable = formOptionsLoading || Boolean(formOptionsError) || locations.length === 0;

  const error: ErrorState | null = fetchError
    ? { type: fetchError, message: fetchError === "network" ? "Could not connect to server" : "Failed to load kiosk devices" }
    : null;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = addName.trim();
    if (!trimmedName || !addLocationId) return;

    setAdding(true);
    try {
      const res = await fetch("/api/kiosk-devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, locationId: addLocationId }),
      });
      if (handleAuthRedirect(res, "/settings/kiosk-devices")) return;
      if (res.ok) {
        const json = await parseJsonSafely<{ activationCode?: string }>(res);
        if (!json?.activationCode) {
          toast.error("Kiosk was created, but the activation code could not be read. Regenerate the code before using the iPad.");
          load();
          return;
        }
        setCodeDialog({ name: trimmedName, code: json.activationCode });
        setShowAdd(false);
        setAddName("");
        setAddLocationId("");
        load();
      } else {
        const msg = await parseErrorMessage(res, "Failed to create kiosk device");
        toast.error(msg);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You're offline. Check your connection." : "Failed to create kiosk device");
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(device: KioskDevice) {
    const action = device.active ? "deactivate" : "activate";
    if (device.active) {
      const ok = await confirm({
        title: "Deactivate kiosk?",
        message: `Deactivate "${device.name}"? This signs out the iPad, clears its session, and requires a new activation code before it can be used again.`,
        confirmLabel: "Deactivate",
        variant: "danger",
      });
      if (!ok) return;
    }

    setTogglingId(device.id);
    try {
      const res = await fetch(`/api/kiosk-devices/${device.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !device.active }),
      });
      if (handleAuthRedirect(res, "/settings/kiosk-devices")) return;
      if (res.ok) {
        toast.success(`Kiosk ${action}d`);
        load();
      } else {
        toast.error(`Failed to ${action} kiosk`);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You're offline. Check your connection." : `Failed to ${action} kiosk`);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleRegenerate(device: KioskDevice) {
    if (device.activated) {
      const ok = await confirm({
        title: "Reset activation code?",
        message: `Generate a new code for "${device.name}"? This signs out the iPad and moves this device back to pending activation.`,
        confirmLabel: "Generate code",
        variant: "danger",
      });
      if (!ok) return;
    }

    setRegeneratingId(device.id);
    try {
      const res = await fetch(`/api/kiosk-devices/${device.id}/regenerate-code`, {
        method: "POST",
      });
      if (handleAuthRedirect(res, "/settings/kiosk-devices")) return;
      if (res.ok) {
        const json = await parseJsonSafely<{ activationCode?: string }>(res);
        if (!json?.activationCode) {
          toast.error("New code was generated, but the response could not be read. Try regenerating again.");
          return;
        }
        setCodeDialog({ name: device.name, code: json.activationCode });
        toast.success("New activation code generated");
        load();
      } else {
        const msg = await parseErrorMessage(res, "Failed to regenerate code");
        toast.error(msg);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You're offline. Check your connection." : "Failed to regenerate code");
    } finally {
      setRegeneratingId(null);
    }
  }

  async function handleDelete(device: KioskDevice) {
    const ok = await confirm({
      title: "Delete kiosk device?",
      message: `Permanently delete "${device.name}"? Use this only for retired or duplicate devices. This cannot be undone.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;

    setDeletingId(device.id);
    try {
      const res = await fetch(`/api/kiosk-devices/${device.id}`, {
        method: "DELETE",
      });
      if (handleAuthRedirect(res, "/settings/kiosk-devices")) return;
      if (res.ok) {
        toast.success("Kiosk device deleted");
        load();
      } else {
        toast.error("Failed to delete kiosk device");
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You're offline. Check your connection." : "Failed to delete kiosk device");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCancelPickup(booking: PendingPickup) {
    const ok = await confirm({
      title: "Cancel pending pickup?",
      message: `Cancel "${booking.title}" for ${booking.requesterName}? This releases all reserved items.`,
      confirmLabel: "Cancel pickup",
      variant: "danger",
    });
    if (!ok) return;

    setCancellingPickupId(booking.id);
    try {
      const res = await fetch(`/api/bookings/${booking.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (handleAuthRedirect(res, "/settings/kiosk-devices")) return;
      if (res.ok) {
        toast.success("Pickup cancelled");
        // Stay open so staff can clear several stuck pickups in one pass —
        // closing after every single cancel forced reopening the dialog
        // over and over. The dialog's own empty state covers the last one.
        setPickupDialog((current) => current && ({
          ...current,
          pendingPickupCount: Math.max(0, current.pendingPickupCount - 1),
          pendingPickups: current.pendingPickups.filter((p) => p.id !== booking.id),
        }));
        load();
      } else {
        const msg = await parseErrorMessage(res, "Failed to cancel pickup");
        toast.error(msg);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You're offline. Check your connection." : "Failed to cancel pickup");
    } finally {
      setCancellingPickupId(null);
    }
  }

  async function copyCode(code: string) {
    const copied = await copyTextToClipboard(code);
    if (copied) {
      toast.success("Code copied to clipboard");
      return;
    }
    toast.error("Could not copy the activation code", {
      description: "Select the visible code and copy it manually.",
    });
  }

  function formatRelative(dateStr: string | null): string {
    if (!dateStr) return "Never";
    return formatRelativeTime(dateStr, new Date());
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  return (
    <SettingsPageShell
      title="Kiosk Devices"
      description="Manage iPad kiosk stations for self-serve gear checkout."
      mainClassName="flex flex-col gap-4"
    >
        <div className="flex justify-end">
          {!showAdd && (
            <Button onClick={() => setShowAdd(true)} className="min-h-10">
              <Plus className="size-4 mr-1.5" />
              Add Kiosk
            </Button>
          )}
        </div>

      {/* Add form */}
      {showAdd && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">New Kiosk Device</CardTitle>
          </CardHeader>
          <CardContent>
            {formOptionsError ? (
              <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-destructive">Locations could not load, so new kiosk devices cannot be assigned yet.</span>
                  <Button className="h-10" type="button" variant="outline" onClick={reloadFormOptions}>
                    Retry locations
                  </Button>
                </div>
              </div>
            ) : locations.length === 0 && !formOptionsLoading ? (
              <div className="mb-4 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                Add a location before creating kiosk devices.
              </div>
            ) : null}

            <form onSubmit={handleAdd} className="flex items-end gap-3">
              <div className="flex-1 flex flex-col gap-1.5">
                <Label htmlFor="kiosk-name">Name</Label>
                <Input
                  id="kiosk-name"
                  name="kioskName"
                  placeholder="e.g. Video Office iPad"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  disabled={adding}
                />
              </div>
              <div className="flex-1 flex flex-col gap-1.5">
                <Label htmlFor="kiosk-location">Location</Label>
                <Select
                  name="kioskLocationId"
                  value={addLocationId}
                  onValueChange={setAddLocationId}
                  disabled={adding || locationsUnavailable}
                >
                  <SelectTrigger id="kiosk-location" disabled={locationsUnavailable}>
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={adding || locationsUnavailable || !addName.trim() || !addLocationId}>
                {adding && <Spinner data-icon="inline-start" />}
                Create
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowAdd(false);
                  setAddName("");
                  setAddLocationId("");
                }}
                disabled={adding}
              >
                Cancel
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-4">
            {error.type === "network" ? (
              <WifiOff className="size-5 text-destructive" />
            ) : (
              <AlertTriangle className="size-5 text-destructive" />
            )}
            <span className="text-sm text-destructive">{error.message}</span>
            <Button variant="outline" className="ml-auto min-h-10" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {!error && formOptionsError && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="size-5 text-destructive" />
            <span className="text-sm text-destructive">
              Locations could not load. Kiosk assignment controls are unavailable until locations are readable.
            </span>
            <Button variant="outline" className="ml-auto min-h-10" onClick={reloadFormOptions}>
              Retry locations
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {loading && !error && (
        <div className="flex flex-col gap-3">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="size-10 rounded" />
                  <div className="flex-1 flex flex-col gap-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && (devices ?? []).length === 0 && (
        <Card>
          <CardContent className="py-0">
            <EmptyState
              inline
              icon="clipboard"
              title="No kiosk devices yet"
              description="Add a kiosk device to enable self-serve checkout on an iPad."
            />
          </CardContent>
        </Card>
      )}

      {/* Device list */}
      {!loading && !error && (devices ?? []).length > 0 && (
        <div className="flex flex-col gap-3">
          {(devices ?? []).map((device) => {
            const health = kioskHealth(device);
            return (
              <Card key={device.id} className={cn(!device.active && "opacity-60")}>
                <CardContent className="py-4 flex flex-col gap-3">
                  {/* Main row */}
                  <div className="flex items-center gap-4">
                    <div className="flex size-10 items-center justify-center rounded bg-muted shrink-0">
                      <Monitor className="size-5 text-muted-foreground" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{device.name}</span>
                        <StatusIndicator
                          state={health.state}
                          label={health.label}
                          size="sm"
                          title={health.description}
                        />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span>{device.location.name}</span>
                        {device.activated && (
                          <>
                            <span>·</span>
                            <span>Last seen: {formatRelative(device.lastSeenAt)}</span>
                            {/* Build identity answers "is this iPad on the new
                                build?" without a database query. Devices on an
                                older build never report it, so say so plainly
                                rather than rendering an empty gap. */}
                            <span>
                              Build:{" "}
                              {device.appVersion
                                ? `${device.appVersion} (${device.appBuild ?? "?"})`
                                : "Unknown — pre-reporting build"}
                            </span>
                            {device.osVersion ? (
                              <span>
                                iPadOS {device.osVersion}
                                {device.deviceModel ? ` · ${device.deviceModel}` : ""}
                              </span>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0">
                      <OperationalRowActions
                        label={`Actions for ${device.name}`}
                        icon={
                          togglingId === device.id || deletingId === device.id || regeneratingId === device.id
                            ? <Spinner />
                            : undefined
                        }
                      >
                        {device.active && (
                          <DropdownMenuItem
                            onSelect={() => handleRegenerate(device)}
                            disabled={regeneratingId === device.id}
                          >
                            <RefreshCw className="size-4" />
                            {device.activated ? "Reset activation code" : "Regenerate code"}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() => handleToggle(device)}
                          disabled={togglingId === device.id}
                          variant={device.active ? "destructive" : "default"}
                        >
                          {device.active ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                          {device.active ? "Deactivate kiosk" : "Activate kiosk"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => handleDelete(device)}
                          disabled={deletingId === device.id}
                          variant="destructive"
                        >
                          <Trash2 className="size-4" />
                          Delete device
                        </DropdownMenuItem>
                      </OperationalRowActions>
                    </div>
                  </div>

                  {/* Health stats strip — only when activated */}
                  {device.activated && (
                    <div className="flex items-center gap-3 px-1 pt-1 border-t">
                      {/* Pending pickups */}
                      <button
                        type="button"
                        onClick={() => device.pendingPickupCount > 0 && setPickupDialog(device)}
                        className={cn(
                          "flex min-h-10 items-center gap-1.5 rounded-md px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                          device.pendingPickupCount > 0
                            ? "text-[var(--orange-text)] hover:bg-[var(--orange-bg)] cursor-pointer"
                            : "text-muted-foreground cursor-default"
                        )}
                        aria-label={
                          device.pendingPickupCount > 0
                            ? `View pending pickups for ${device.name}`
                            : `No pending pickups for ${device.name}`
                        }
                        title={device.pendingPickupCount > 0 ? "View and clear pending pickups" : "No pending pickups"}
                        disabled={device.pendingPickupCount === 0}
                      >
                        <ShoppingBag className="size-3.5" />
                        <span>{device.pendingPickupCount} pending pickup{device.pendingPickupCount !== 1 ? "s" : ""}</span>
                      </button>

                      <span className="w-px h-3 bg-border" />

                      {/* Open checkouts */}
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-2 py-1">
                        {device.openCheckoutCount > 0
                          ? <CheckCircle2 className="size-3.5 text-[var(--green-text)]" />
                          : <Circle className="size-3.5" />
                        }
                        <span>{device.openCheckoutCount} active checkout{device.openCheckoutCount !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Activation code dialog — shown after creating a device */}
      <Dialog open={!!codeDialog} onOpenChange={() => setCodeDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kiosk Activation Code</DialogTitle>
            <DialogDescription>
              Enter this code on the iPad to activate <strong>{codeDialog?.name}</strong>. This code is shown only once.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center gap-3 py-6">
            <code className="text-4xl font-mono font-bold tracking-[0.3em] bg-muted px-6 py-3 rounded-lg">
              {codeDialog?.code}
            </code>
            <Button
              variant="outline"
              size="icon"
              className="size-10"
              onClick={() => {
                if (codeDialog) void copyCode(codeDialog.code);
              }}
              aria-label="Copy activation code"
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setCodeDialog(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pending pickup clear dialog */}
      <Dialog open={!!pickupDialog} onOpenChange={() => setPickupDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pending Pickups</DialogTitle>
            <DialogDescription>
              Pickups at <strong>{pickupDialog?.location.name}</strong> waiting to be collected. Cancel any that are stuck or expired.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-1 max-h-72 overflow-y-auto">
            {(pickupDialog?.pendingPickups ?? []).length === 0 && (
              <EmptyState
                inline
                compact
                icon="clipboard"
                title="No pending pickups"
                description="This kiosk has no pickup work waiting right now."
              />
            )}
            {(pickupDialog?.pendingPickups ?? []).map((b) => (
              <div key={b.id} className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
                <ShoppingBag className="size-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{b.title}</p>
                  <p className="text-xs text-muted-foreground">{b.requesterName} &middot; {formatDate(b.startsAt)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => handleCancelPickup(b)}
                  disabled={cancellingPickupId === b.id}
                  aria-label={`Cancel pending pickup ${b.title}`}
                  title="Cancel pending pickup"
                >
                  {cancellingPickupId === b.id ? <Spinner /> : <X className="size-4" />}
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
        <Button variant="outline" onClick={() => setPickupDialog(null)}>Close</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
    </SettingsPageShell>
  );
}
