"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Plus, Power, PowerOff, WifiOff } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { useLastAudit } from "@/hooks/use-last-audit";
import { LastEditedHint } from "@/components/LastEditedHint";
import {
  classifyError,
  handleAuthRedirect,
  isAbortError,
  parseErrorMessage,
} from "@/lib/errors";
import { SettingsPageShell } from "../SettingsPageShell";

type LocationCounts = {
  users: number;
  assets: number;
  bookings: number;
  kioskDevices: number;
  locationMappings: number;
};

type Location = {
  id: string;
  name: string;
  address: string | null;
  active: boolean;
  isHomeVenue: boolean;
  _count?: LocationCounts;
};

function describeUsage(c?: LocationCounts): string {
  if (!c) return "";
  const parts: string[] = [];
  if (c.assets) parts.push(`${c.assets} item${c.assets === 1 ? "" : "s"}`);
  if (c.bookings) parts.push(`${c.bookings} booking${c.bookings === 1 ? "" : "s"}`);
  if (c.kioskDevices) parts.push(`${c.kioskDevices} kiosk${c.kioskDevices === 1 ? "" : "s"}`);
  if (c.locationMappings) parts.push(`${c.locationMappings} venue map${c.locationMappings === 1 ? "" : "s"}`);
  if (c.users) parts.push(`${c.users} user${c.users === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export default function LocationsSettingsPage() {
  const confirm = useConfirm();
  const { data: fetched, loading, error, reload } = useFetch<Location[]>({
    url: "/api/locations?includeInactive=1",
    returnTo: "/settings/locations",
    transform: (json) => (json.data as Location[]) ?? [],
  });

  const [localItems, setLocalItems] = useState<Location[] | null>(null);
  const [prevFetched, setPrevFetched] = useState(fetched);
  if (fetched !== prevFetched) {
    setPrevFetched(fetched);
    setLocalItems(null);
  }
  const items = localItems ?? fetched ?? [];
  const lastEdited = useLastAudit("location", items.map((l) => l.id));

  const [busy, setBusy] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newHome, setNewHome] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  function patchLocal(id: string, patch: Partial<Location>) {
    setLocalItems((prev) => (prev ?? items).map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    if (!newName.trim()) {
      setAddError("Location name is required.");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          address: newAddress.trim() || undefined,
          isHomeVenue: newHome,
        }),
      });
      if (handleAuthRedirect(res, "/settings/locations")) { setAdding(false); return; }
      if (res.ok) {
        toast.success(`Added "${newName.trim()}"`);
        setNewName("");
        setNewAddress("");
        setNewHome(false);
        setShowAdd(false);
        reload();
      } else {
        const msg = await parseErrorMessage(res, "Failed to create location");
        setAddError(msg);
        toast.error(msg);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      const msg = kind === "network" ? "You’re offline. Check your connection." : "Failed to create location";
      setAddError(msg);
      toast.error(msg);
    }
    setAdding(false);
  }

  async function patchLocation(id: string, patch: Partial<Location>, optimistic = true) {
    if (optimistic) patchLocal(id, patch);
    try {
      const res = await fetch(`/api/locations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (handleAuthRedirect(res, "/settings/locations")) return false;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to save");
        toast.error(msg);
        if (optimistic) reload();
        return false;
      }
      return true;
    } catch (err) {
      if (isAbortError(err)) return false;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You’re offline. Check your connection." : "Failed to save");
      if (optimistic) reload();
      return false;
    }
  }

  async function toggleHome(loc: Location) {
    setBusy(`home-${loc.id}`);
    await patchLocation(loc.id, { isHomeVenue: !loc.isHomeVenue });
    setBusy(null);
  }

  async function toggleActive(loc: Location) {
    if (loc.active) {
      const usage = describeUsage(loc._count);
      const ok = await confirm({
        title: `Deactivate "${loc.name}"?`,
        message: usage
          ? `This location is referenced by ${usage}. Existing records stay intact, but new item, kiosk, and venue-mapping pickers will stop offering it until reactivated.`
          : "Existing records stay intact. New item, kiosk, and venue-mapping pickers will stop offering this location until reactivated.",
        confirmLabel: "Deactivate",
        variant: "danger",
      });
      if (!ok) return;
    }
    setBusy(`active-${loc.id}`);
    const success = await patchLocation(loc.id, { active: !loc.active });
    if (success) {
      toast.success(`${loc.name} ${loc.active ? "deactivated" : "reactivated"}`);
    }
    setBusy(null);
  }

  function startRename(loc: Location) {
    setRenamingId(loc.id);
    setRenameValue(loc.name);
  }

  async function commitRename(loc: Location) {
    const next = renameValue.trim();
    if (!next || next === loc.name) {
      setRenamingId(null);
      return;
    }
    setBusy(`rename-${loc.id}`);
    const success = await patchLocation(loc.id, { name: next });
    if (success) toast.success(`Renamed to "${next}"`);
    setRenamingId(null);
    setBusy(null);
  }

  const description = "Catalog of physical locations referenced by items, kiosks, calendar events, and venue mappings. Mark a location as a home venue to flag events held there as home games for shift coverage.";

  if (loading) {
    return (
      <SettingsPageShell title="Locations" description={description} mainClassName="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
      </SettingsPageShell>
    );
  }

  if (error) {
    const Icon = error === "network" ? WifiOff : AlertTriangle;
    return (
      <SettingsPageShell title="Locations" description={description}>
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
                <Icon className="size-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {error === "network"
                    ? "Could not connect to the server."
                    : "Failed to load locations."}
                </p>
                <Button variant="outline" onClick={reload}>
                  Retry
                </Button>
              </CardContent>
            </Card>
      </SettingsPageShell>
    );
  }

  const active = items.filter((l) => l.active);
  const inactive = items.filter((l) => !l.active);

  return (
    <SettingsPageShell title="Locations" description={description} mainClassName="flex flex-col gap-4">
        <div className="flex justify-end">
          {!showAdd && (
            <Button className="h-10" onClick={() => setShowAdd(true)}>
              <Plus className="size-4 mr-1.5" />
              Add location
            </Button>
          )}
        </div>

        {showAdd && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">New location</CardTitle>
            </CardHeader>
            <CardContent>
              {addError && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{addError}</AlertDescription>
                </Alert>
              )}
              <form onSubmit={handleAdd} className="flex flex-col gap-4">
                <div className="grid grid-cols-[1fr_1fr] gap-3 max-sm:grid-cols-1">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="loc-name">Name</Label>
                    <Input
                      id="loc-name"
                      value={newName}
                      onChange={(e) => { setNewName(e.target.value); setAddError(""); }}
                      placeholder="e.g. Camp Randall Stadium"
                      required
                      autoFocus
                      disabled={adding}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="loc-address">Address (optional)</Label>
                    <Input
                      id="loc-address"
                      value={newAddress}
                      onChange={(e) => setNewAddress(e.target.value)}
                      placeholder="1440 Monroe St, Madison, WI"
                      disabled={adding}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="loc-home"
                    checked={newHome}
                    onCheckedChange={setNewHome}
                    disabled={adding}
                  />
                  <Label htmlFor="loc-home" className="text-sm font-medium">
                    Home venue
                  </Label>
                </div>
                <div className="flex gap-2">
                  <Button className="h-10" type="submit" disabled={adding || !newName.trim()}>
                    {adding ? <><Spinner data-icon="inline-start" />Adding...</> : "Add location"}
                  </Button>
                  <Button className="h-10"
                    type="button"
                    variant="outline"
                    onClick={() => { setShowAdd(false); setNewName(""); setNewAddress(""); setNewHome(false); setAddError(""); }}
                    disabled={adding}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-base">
              Active locations ({active.length})
            </CardTitle>
          </CardHeader>
          {active.length === 0 ? (
            <CardContent className="py-0">
              <EmptyState
                inline
                icon="folder"
                title="No locations yet"
                description="Add one to support item forms, kiosks, calendar events, and venue mappings."
              />
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Home venue</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {active.map((loc) => (
                  <TableRow key={loc.id}>
                    <TableCell className="align-top">
                      {renamingId === loc.id ? (
                        <Input
                          id={`location-name-${loc.id}`}
                          name="locationName"
                          aria-label={`Rename ${loc.name}`}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(loc)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(loc);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          disabled={busy === `rename-${loc.id}`}
                          autoFocus
                          className="h-8 max-w-[260px]"
                        />
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <button
                            type="button"
                            className="text-left font-medium hover:text-[var(--wi-red)] transition-colors"
                            onClick={() => startRename(loc)}
                            title="Click to rename"
                          >
                            {loc.name}
                          </button>
                          <LastEditedHint info={lastEdited[loc.id]} />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground align-top">
                      {loc.address || "—"}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex items-center gap-2">
                        {loc.isHomeVenue && <Badge variant="green" size="sm">Home</Badge>}
                        <Switch
                          checked={loc.isHomeVenue}
                          onCheckedChange={() => toggleHome(loc)}
                          disabled={busy === `home-${loc.id}`}
                          aria-label={`Toggle ${loc.name} home venue`}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right align-top">
                      <OperationalRowActions
                        label={`Actions for ${loc.name}`}
                        icon={busy === `active-${loc.id}` ? <Spinner /> : undefined}
                      >
                        <DropdownMenuItem
                          onSelect={() => toggleActive(loc)}
                          disabled={busy === `active-${loc.id}`}
                          variant="destructive"
                        >
                          <PowerOff className="size-4" />
                          Deactivate
                        </DropdownMenuItem>
                      </OperationalRowActions>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        {inactive.length > 0 && (
          <Card>
            <CardHeader className="pb-0">
              <CardTitle className="text-base text-muted-foreground">
                Deactivated ({inactive.length})
              </CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Still referenced by</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inactive.map((loc) => (
                  <TableRow key={loc.id} className="opacity-70">
                    <TableCell className="font-medium">{loc.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {describeUsage(loc._count) || "Nothing"}
                    </TableCell>
                    <TableCell className="text-right">
                      <OperationalRowActions
                        label={`Actions for ${loc.name}`}
                        icon={busy === `active-${loc.id}` ? <Spinner /> : undefined}
                      >
                        <DropdownMenuItem
                          onSelect={() => toggleActive(loc)}
                          disabled={busy === `active-${loc.id}`}
                        >
                          <Power className="size-4" />
                          Reactivate
                        </DropdownMenuItem>
                      </OperationalRowActions>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
    </SettingsPageShell>
  );
}
