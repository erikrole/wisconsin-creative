"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, classifyError, isAbortError, parseErrorMessage } from "@/lib/errors";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsPageShell } from "../SettingsPageShell";
import { AlertTriangle, CheckCircle2, MapPin, Plus, Trash2 } from "lucide-react";

type LocationMapping = {
  id: string;
  pattern: string;
  priority: number;
  location: { id: string; name: string };
};

type Location = { id: string; name: string };

type VenueAuditLocation = {
  id: string;
  name: string;
  active: boolean;
  isHomeVenue: boolean;
};

type VenueAuditMapping = {
  id: string;
  pattern: string;
  locationId: string;
  location: VenueAuditLocation | null;
};

type VenueMappingAudit = {
  homeVenuesWithoutMappings: VenueAuditLocation[];
  mappingsToMissingLocations: VenueAuditMapping[];
  mappingsToInactiveLocations: VenueAuditMapping[];
  homeMappingsToNonHomeLocations: VenueAuditMapping[];
  issueCount: number;
};

const emptyAudit: VenueMappingAudit = {
  homeVenuesWithoutMappings: [],
  mappingsToMissingLocations: [],
  mappingsToInactiveLocations: [],
  homeMappingsToNonHomeLocations: [],
  issueCount: 0,
};

export default function VenueMappingsPage() {
  const confirm = useConfirm();
  const { data: fetchedMappings, loading, reload: reloadMappings } = useFetch<LocationMapping[]>({
    url: "/api/location-mappings",
    returnTo: "/settings/venue-mappings",
    transform: (json) => (json.data as LocationMapping[]) ?? [],
  });
  const {
    data: fetchedLocations,
    loading: locationsLoading,
    error: locationsError,
    reload: reloadLocations,
  } = useFetch<Location[]>({
    url: "/api/locations",
    returnTo: "/settings/venue-mappings",
    transform: (json) => (json.data as Location[]) ?? [],
  });
  const {
    data: fetchedAudit,
    loading: auditLoading,
    error: auditError,
    reload: reloadAudit,
  } = useFetch<VenueMappingAudit>({
    url: "/api/location-mappings/audit",
    returnTo: "/settings/venue-mappings",
    transform: (json) => (json.data as VenueMappingAudit) ?? emptyAudit,
  });

  const mappings = fetchedMappings ?? [];
  const locations = fetchedLocations ?? [];
  const audit = fetchedAudit ?? emptyAudit;
  const locationsUnavailable = locationsLoading || Boolean(locationsError) || locations.length === 0;

  const [showAdd, setShowAdd] = useState(false);
  const [addingMapping, setAddingMapping] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newPattern, setNewPattern] = useState("");
  const [newLocationId, setNewLocationId] = useState("");
  const [newPriority, setNewPriority] = useState("0");

  // Live regex tester — pure client-side (the regex is the user's input).
  const [testPattern, setTestPattern] = useState("");
  const [testSample, setTestSample] = useState("");
  type RegexTest =
    | { kind: "empty" }
    | { kind: "invalid"; reason: string }
    | { kind: "match"; matchText: string }
    | { kind: "no-match" };

  function evalRegex(pattern: string, sample: string): RegexTest {
    if (!pattern.trim()) return { kind: "empty" };
    let re: RegExp;
    try {
      re = new RegExp(pattern, "i");
    } catch (err) {
      return { kind: "invalid", reason: err instanceof Error ? err.message : "Invalid regex" };
    }
    if (!sample) return { kind: "empty" };
    const match = sample.match(re);
    if (match) return { kind: "match", matchText: match[0] };
    return { kind: "no-match" };
  }
  const testResult = evalRegex(testPattern, testSample);

  function resetAddForm() {
    setNewPattern("");
    setNewLocationId("");
    setNewPriority("0");
    setTestPattern("");
  }

  function openAddMapping(defaults?: { pattern?: string; locationId?: string }) {
    setShowAdd(true);
    const nextPattern = defaults?.pattern ?? "";
    setNewPattern(nextPattern);
    setTestPattern(nextPattern);
    setNewLocationId(defaults?.locationId ?? "");
    setNewPriority("0");
  }

  async function handleAddMapping(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAddingMapping(true);
    try {
      const res = await fetch("/api/location-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pattern: newPattern,
          locationId: newLocationId,
          priority: parseInt(newPriority, 10) || 0,
        }),
      });
      if (handleAuthRedirect(res, "/settings/venue-mappings")) return;
      if (res.ok) {
        setShowAdd(false);
        toast.success("Venue mapping added");
        reloadMappings();
        reloadAudit();
        resetAddForm();
      } else {
        const msg = await parseErrorMessage(res, "Failed to create mapping");
        toast.error(msg);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You\u2019re offline. Check your connection." : "Failed to create mapping");
    } finally {
      setAddingMapping(false);
    }
  }

  async function handleDeleteMapping(mapping: LocationMapping) {
    const ok = await confirm({
      title: "Delete venue mapping",
      message: `Delete the "${mapping.pattern}" mapping to ${mapping.location.name}? Future synced events matching this venue text will not auto-assign this location.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    setDeletingId(mapping.id);
    try {
      const res = await fetch(`/api/location-mappings/${mapping.id}`, {
        method: "DELETE",
      });
      if (handleAuthRedirect(res, "/settings/venue-mappings")) return;
      if (res.ok) {
        toast.success("Venue mapping deleted");
        reloadMappings();
        reloadAudit();
      } else {
        toast.error("Delete failed");
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You\u2019re offline. Check your connection." : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <SettingsPageShell
      title="Venue Mappings"
      description="Map raw venue text from calendar feeds to one of your locations. Home-location matches flag events as home games for shift coverage. Manage locations on the Locations tab."
    >
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Mapping Audit</CardTitle>
            <Button className="h-10" type="button" variant="outline" onClick={reloadAudit}>
              Refresh audit
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {auditLoading ? (
              <div className="flex justify-center py-8">
                <Spinner className="size-8" />
              </div>
            ) : auditError ? (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  <span>Venue mapping diagnostics could not load.</span>
                  <Button className="h-10" type="button" variant="outline" onClick={reloadAudit}>
                    Retry audit
                  </Button>
                </AlertDescription>
              </Alert>
            ) : audit.issueCount === 0 ? (
              <div className="flex items-center gap-3 rounded-md border border-border/60 bg-muted/20 px-4 py-3">
                <CheckCircle2 className="size-5 text-[var(--green)]" />
                <div>
                  <p className="text-sm font-medium">Venue mappings look current</p>
                  <p className="text-sm text-muted-foreground">
                    Active home venues have mappings, and existing mappings point at active locations.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="orange">{audit.issueCount} to review</Badge>
                  <p className="text-sm text-muted-foreground">
                    Fix these before relying on venue-derived home, away, and neutral schedule handling.
                  </p>
                </div>

                {audit.homeVenuesWithoutMappings.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold">Home venues without mappings</h3>
                    <div className="divide-y rounded-md border">
                      {audit.homeVenuesWithoutMappings.map((location) => (
                        <div key={location.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                          <div className="flex items-center gap-3">
                            <MapPin className="size-4 text-muted-foreground" />
                            <div>
                              <p className="text-sm font-medium">{location.name}</p>
                              <p className="text-xs text-muted-foreground">
                                Add a pattern so synced events can map to this home venue.
                              </p>
                            </div>
                          </div>
                          <Button className="h-10"
                            type="button"
                            variant="outline"
                            onClick={() => openAddMapping({ pattern: location.name, locationId: location.id })}
                          >
                            <Plus className="mr-1.5 size-4" />
                            Add mapping
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {audit.mappingsToInactiveLocations.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold">Mappings to inactive locations</h3>
                    <div className="divide-y rounded-md border">
                      {audit.mappingsToInactiveLocations.map((mapping) => (
                        <div key={mapping.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                          <div>
                            <p className="font-mono text-xs">{mapping.pattern}</p>
                            <p className="text-xs text-muted-foreground">
                              Points at inactive location {mapping.location?.name ?? mapping.locationId}.
                            </p>
                          </div>
                          <Button className="h-10" asChild variant="outline">
                            <Link href="/settings/locations">Review location</Link>
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {audit.mappingsToMissingLocations.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold">Mappings to missing locations</h3>
                    <div className="divide-y rounded-md border">
                      {audit.mappingsToMissingLocations.map((mapping) => (
                        <div key={mapping.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                          <div>
                            <p className="font-mono text-xs">{mapping.pattern}</p>
                            <p className="text-xs text-muted-foreground">
                              Points at location ID {mapping.locationId}, which no longer exists.
                            </p>
                          </div>
                          <Badge variant="red">Broken mapping</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {audit.homeMappingsToNonHomeLocations.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold">Home-looking mappings to non-home locations</h3>
                    <div className="divide-y rounded-md border">
                      {audit.homeMappingsToNonHomeLocations.map((mapping) => (
                        <div key={mapping.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                          <div>
                            <p className="font-mono text-xs">{mapping.pattern}</p>
                            <p className="text-xs text-muted-foreground">
                              Points at {mapping.location?.name ?? mapping.locationId}, but that location is not marked Home Venue.
                            </p>
                          </div>
                          <Button className="h-10" asChild variant="outline">
                            <Link href="/settings/locations">Review home venue</Link>
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        {/* Venue Pattern Mappings */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Pattern Mappings</CardTitle>
            {!showAdd && (
              <Button className="h-10" onClick={() => openAddMapping()}>
                <Plus className="mr-1.5 size-4" />
                Add mapping
              </Button>
            )}
          </CardHeader>

          {showAdd && (
            <CardContent>
              <form onSubmit={handleAddMapping}>
                <div className="flex flex-wrap gap-2 items-end">
                  <Input
                    name="pattern"
                    placeholder="Venue pattern (e.g. Camp Randall)"
                    required
                    value={newPattern}
                    className="flex-[2] min-w-[150px]"
                    onChange={(e) => {
                      setNewPattern(e.target.value);
                      setTestPattern(e.target.value);
                    }}
                  />
                  <Select
                    name="locationId"
                    required
                    value={newLocationId}
                    onValueChange={setNewLocationId}
                  >
                    <SelectTrigger className="flex-1 min-w-[120px]" disabled={locationsUnavailable}>
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
                  <Input
                    name="priority"
                    type="number"
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value)}
                    placeholder="Priority"
                    className="w-20"
                    title="Higher priority mappings are checked first"
                  />
                  <div className="flex gap-2">
                    <Button className="h-10" type="submit" disabled={addingMapping || locationsUnavailable}>
                      {addingMapping ? "Adding..." : "Add"}
                    </Button>
                    <Button className="h-10"
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowAdd(false);
                        resetAddForm();
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>

                {locationsError ? (
                  <Alert variant="destructive" className="mt-3">
                    <AlertDescription className="flex flex-wrap items-center gap-2">
                      <span>Locations could not load, so new venue mappings cannot be assigned yet.</span>
                      <Button className="h-10" type="button" variant="outline" onClick={reloadLocations}>
                        Retry locations
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : locations.length === 0 && !locationsLoading ? (
                  <Alert className="mt-3">
                    <AlertDescription>
                      Add an active location before creating venue mappings.
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="mt-3 rounded-md border bg-muted/30 p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="vm-test-sample" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Test pattern
                    </label>
                    <span
                      className={`text-xs font-medium ${
                        testResult.kind === "match"
                          ? "text-[var(--green)]"
                          : testResult.kind === "invalid"
                            ? "text-destructive"
                            : "text-muted-foreground"
                      }`}
                    >
                      {testResult.kind === "empty" && "Type a pattern + sample text below"}
                      {testResult.kind === "invalid" && `✗ Invalid regex: ${testResult.reason}`}
                      {testResult.kind === "match" && `✓ Matches "${testResult.matchText}"`}
                      {testResult.kind === "no-match" && "✗ Does not match"}
                    </span>
                  </div>
                  <Input
                    id="vm-test-sample"
                    type="text"
                    value={testSample}
                    onChange={(e) => setTestSample(e.target.value)}
                    placeholder='Sample venue text — e.g. "Camp Randall Stadium · Madison, WI"'
                    className="h-8 text-sm"
                  />
                </div>
              </form>
            </CardContent>
          )}

          {loading ? (
            <CardContent className="py-10 text-center">
              <Spinner className="size-8" />
            </CardContent>
          ) : mappings.length === 0 ? (
            <CardContent className="py-0">
              <EmptyState
                inline
                icon="calendar"
                title="No venue mappings configured"
                description="Add patterns to automatically assign raw calendar venue text to locations."
              />
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pattern</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappings.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs">{m.pattern}</TableCell>
                    <TableCell>
                      <Badge variant="blue">{m.location.name}</Badge>
                    </TableCell>
                    <TableCell>{m.priority}</TableCell>
                    <TableCell className="text-right">
                      <OperationalRowActions
                        label={`Actions for ${m.pattern}`}
                        icon={deletingId === m.id ? <Spinner /> : undefined}
                      >
                        <DropdownMenuItem
                          onSelect={() => handleDeleteMapping(m)}
                          disabled={deletingId === m.id}
                          variant="destructive"
                        >
                          <Trash2 className="size-4" />
                          Delete mapping
                        </DropdownMenuItem>
                      </OperationalRowActions>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
    </SettingsPageShell>
  );
}
