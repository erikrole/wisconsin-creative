"use client";

import { useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
  Copy,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  ShoppingBag,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { restoreDialogFocus } from "@/lib/a11y-resilience";
import { handleAuthRedirect, parseErrorMessage, classifyError, isAbortError, parseJsonSafely } from "@/lib/errors";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useFetch } from "@/hooks/use-fetch";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsRow } from "../_components/SettingsGroup";
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
  const addKioskRef = useRef<HTMLButtonElement>(null);

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
      href="/settings/kiosk-devices"
      description="Manage iPad kiosk stations for self-serve gear checkout."
      mainClassName="flex flex-col gap-6"
      actions={
        !showAdd ? (
          <Button ref={addKioskRef} onClick={() => setShowAdd(true)} className="min-h-10">
            <Plus className="size-4" />
            Add kiosk
          </Button>
        ) : undefined
      }
    >

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd}>
          <SettingsGroup title="New kiosk">
            {formOptionsError ? (
              <div className="flex flex-col gap-3 px-4 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="text-destructive">Locations could not load, so new kiosk devices cannot be assigned yet.</span>
                <Button className="h-10" type="button" variant="outline" onClick={reloadFormOptions}>
                  Retry locations
                </Button>
              </div>
            ) : locations.length === 0 && !formOptionsLoading ? (
              <p className="m-0 px-4 py-3.5 text-sm text-muted-foreground">Add a location before creating kiosks.</p>
            ) : null}
            <SettingsRow label="Name" htmlFor="kiosk-name" description="What staff will see, like the room it lives in.">
              <Input
                id="kiosk-name"
                name="kioskName"
                placeholder="e.g. Video Office iPad"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                disabled={adding}
              />
            </SettingsRow>
            <SettingsRow label="Location" htmlFor="kiosk-location">
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
            </SettingsRow>
            <div className="flex justify-end gap-2 bg-muted/40 px-4 py-3">
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
              <Button type="submit" disabled={adding || locationsUnavailable || !addName.trim() || !addLocationId}>
                {adding && <Spinner data-icon="inline-start" />}
                Create kiosk
              </Button>
            </div>
          </SettingsGroup>
        </form>
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
        <SettingsGroup>
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="size-9 rounded-md" />
            </div>
          ))}
        </SettingsGroup>
      )}

      {/* Empty state */}
      {!loading && !error && (devices ?? []).length === 0 && (
        <SettingsGroup>
          <EmptyState
            inline
            icon="clipboard"
            title="No kiosks yet"
            description="Add a kiosk to enable self-serve checkout on an iPad."
          />
        </SettingsGroup>
      )}

      {/* Device list */}
      {!loading && !error && (devices ?? []).length > 0 && (
        <SettingsGroup>
          {(devices ?? []).map((device) => {
            const health = kioskHealth(device);
            const pickups = device.pendingPickupCount;
            return (
              <div key={device.id} className={cn("flex items-start gap-3 px-4 py-4", !device.active && "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="truncate text-sm font-bold">{device.name}</span>
                    <StatusIndicator state={health.state} label={health.label} size="sm" title={health.description} />
                  </div>
                  <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">
                    {device.location.name}
                    {device.activated ? ` · Last seen ${formatRelative(device.lastSeenAt)}` : ""}
                  </p>
                  {device.activated && (
                    <>
                      {/* Build identity answers "is this iPad on the new build?" without
                          a database query. Older builds never report it, so say so plainly. */}
                      <p className="m-0 mt-0.5 text-xs text-muted-foreground">
                        {device.appVersion
                          ? `App ${device.appVersion} (${device.appBuild ?? "?"})`
                          : "App version unknown (older build)"}
                        {device.osVersion ? ` · iPadOS ${device.osVersion}` : ""}
                        {device.deviceModel ? ` · ${device.deviceModel}` : ""}
                      </p>
                      <p className="m-0 mt-2 flex flex-wrap items-center gap-x-1 text-[13px]">
                        <button
                          type="button"
                          onClick={() => pickups > 0 && setPickupDialog(device)}
                          disabled={pickups === 0}
                          className={cn(
                            "-mx-1 inline-flex min-h-8 items-center rounded-md px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            pickups > 0
                              ? "cursor-pointer font-bold text-[var(--orange-text)] hover:bg-[var(--orange-bg)]"
                              : "cursor-default text-muted-foreground",
                          )}
                          aria-label={
                            pickups > 0
                              ? `View pending pickups for ${device.name}`
                              : `No pending pickups for ${device.name}`
                          }
                          title={pickups > 0 ? "View and clear pending pickups" : "No pending pickups"}
                        >
                          {pickups} pending pickup{pickups !== 1 ? "s" : ""}
                        </button>
                        <span className="text-muted-foreground">
                          · {device.openCheckoutCount} active checkout{device.openCheckoutCount !== 1 ? "s" : ""}
                        </span>
                      </p>
                    </>
                  )}
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
            );
          })}
        </SettingsGroup>
      )}

      {/* Activation code dialog — shown after creating a device */}
      <Dialog
        open={!!codeDialog}
        onOpenChange={(next) => {
          if (!next) setCodeDialog(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            restoreDialogFocus(addKioskRef.current, event);
          }}
        >
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
