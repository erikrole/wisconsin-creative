"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { sportLabel } from "@/lib/sports";
import { SPORT_CODES } from "@/lib/sports";
import type { UserDetail, Location, Role, StudentYear } from "../types";
import { AREA_LABELS, AREA_OPTIONS, ROLE_OPTIONS, STAFFING_TYPE_OPTIONS, STUDENT_YEAR_OPTIONS } from "../types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, Check, ChevronsUpDown } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SaveableField } from "@/components/SaveableField";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { cn } from "@/lib/utils";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { PROFILE_COMPLETION_QUERY_KEY } from "@/hooks/use-profile-completion";
import { syncCachedUserLists } from "@/lib/user-list-cache";
import { formatPhoneInput } from "@/lib/profile-phone";
import { anticipatedGraduationOptions, anticipatedGraduationValue, parseAnticipatedGraduation } from "@/lib/student-profile";
import { formatDateFull } from "@/lib/format";
import { useAdjustState } from "@/hooks/use-synced-draft";
import { type ApiEnvelope, userPatchUrl, userListCachePatch } from "./user-info-helpers";
import { TextInputField, SelectInputField, DateInputField, DirectReportField, SizesRow, BirthdayField, WiscardFields } from "./UserInfoFields";
import { ProfileGlanceCard, MyHoursCard, CalendarSubscriptionCard } from "./UserInfoCards";

type CollaboratorPolicyOption = {
  id: string;
  status: "ACTIVE" | "SUSPENDED";
  capabilities: string[];
  affiliation: { displayName: string; badgeLabel: string };
};

async function fetchActiveCollaboratorPolicies(): Promise<CollaboratorPolicyOption[]> {
  const response = await fetch("/api/collaborator-affiliations");
  if (handleAuthRedirect(response)) return [];
  if (!response.ok) throw new Error(await parseErrorMessage(response, "Failed to load affiliations"));
  const result = await parseJsonSafely<ApiEnvelope<CollaboratorPolicyOption[]>>(response);
  return (result?.data ?? []).filter((policy) => policy.status === "ACTIVE");
}

/* ── Sport Options (for the add dropdown) ─────────────── */

const SPORT_OPTIONS = SPORT_CODES.map((s) => ({
  value: s.code,
  label: s.label,
}));

const ANTICIPATED_GRADUATION_OPTIONS = anticipatedGraduationOptions();

/* ── User Info Tab ─────────────────────────────────────── */

export default function UserInfoTab({
  user,
  locations,
  locationsLoading = false,
  locationsError = false,
  onRetryLocations,
  currentUserRole,
  isSelf = false,
  onUpdated,
}: {
  user: UserDetail;
  locations: Location[];
  locationsLoading?: boolean;
  locationsError?: boolean;
  onRetryLocations?: () => void;
  currentUserRole: Role | null;
  isSelf?: boolean;
  onUpdated: () => void;
}) {
  const queryClient = useQueryClient();
  const [addingSport, setAddingSport] = useState(false);
  const [addingArea, setAddingArea] = useState(false);
  const [selectedCollaboratorPolicyId, setSelectedCollaboratorPolicyId] = useState(user.collaboratorPolicy?.id ?? "");
  const [revealedCollaboratorAffiliation, setRevealedCollaboratorAffiliation] = useState(user.role === "COLLABORATOR");
  const sportBusyRef = useRef(false);
  const areaBusyRef = useRef(false);

  const isAdmin = currentUserRole === "ADMIN";
  const targetIsStudent = user.role === "STUDENT";

  // Permission logic:
  // - Everyone can edit their own nominal details (name, phone, location)
  // - Admins can edit everything for everyone
  // - Staff can only edit student profiles (not other staff or admins)
  const isStaff = currentUserRole === "STAFF";
  const canEditProfile = isAdmin || (isStaff && targetIsStudent);
  const canEditSelf = isSelf; // own name, phone, location
  const canEditRole = isAdmin || (isStaff && !isSelf && targetIsStudent);
  const canEditStaffingClass = canEditProfile;
  // Assignments: admin/staff can edit for self + students
  const canEditAssignments = isAdmin || (isStaff && (isSelf || targetIsStudent));
  const { data: activeCollaboratorPolicies = [] } = useQuery({
    queryKey: ["collaborator-affiliations", "active"],
    queryFn: fetchActiveCollaboratorPolicies,
    enabled: isAdmin,
    staleTime: 60_000,
  });

  useAdjustState([user.collaboratorPolicy?.id, user.role], () => {
    setSelectedCollaboratorPolicyId(user.collaboratorPolicy?.id ?? "");
    if (user.role === "COLLABORATOR") setRevealedCollaboratorAffiliation(true);
  });

  async function patchUser(payload: Record<string, unknown>) {
    const res = await fetch(userPatchUrl(user.id, payload, isSelf), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (handleAuthRedirect(res)) return;
    if (!res.ok) {
      const msg = await parseErrorMessage(res, "Failed to update user");
      throw new Error(msg);
    }
    const cachePatch = userListCachePatch(payload, locations);
    await syncCachedUserLists(queryClient, user.id, cachePatch);
    onUpdated();
    await queryClient.invalidateQueries({ queryKey: PROFILE_COMPLETION_QUERY_KEY });
  }

  async function changeRole(newRole: string) {
    if (newRole === "COLLABORATOR" && !selectedCollaboratorPolicyId) {
      setRevealedCollaboratorAffiliation(true);
      const message = "Select an active affiliation before assigning the Collaborator role.";
      toast.error(message);
      throw new Error(message);
    }
    const res = await fetch(`/api/users/${user.id}/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: newRole,
        ...(newRole === "COLLABORATOR" ? { collaboratorPolicyId: selectedCollaboratorPolicyId } : {}),
      }),
    });
    if (handleAuthRedirect(res)) return;
    if (!res.ok) {
      const msg = await parseErrorMessage(res, "Failed to change role");
      toast.error(msg);
      throw new Error(msg);
    }
    await syncCachedUserLists(queryClient, user.id, { role: newRole });
    onUpdated();
  }

  async function addSport(sportCode: string) {
    if (sportBusyRef.current) return;
    sportBusyRef.current = true;
    setAddingSport(true);
    try {
      const res = await fetch(`/api/sport-configs/${sportCode}/roster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to add sport");
        toast.error(msg);
      } else {
        onUpdated();
      }
    } catch {
      toast.error("Network error");
    } finally {
      sportBusyRef.current = false;
      setAddingSport(false);
    }
  }

  async function removeSport(assignmentId: string, sportCode: string) {
    if (sportBusyRef.current) return;
    sportBusyRef.current = true;
    try {
      const res = await fetch(`/api/sport-configs/${sportCode}/roster?assignmentId=${assignmentId}`, {
        method: "DELETE",
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to remove sport");
        toast.error(msg);
      } else {
        onUpdated();
      }
    } catch {
      toast.error("Network error");
    } finally {
      sportBusyRef.current = false;
    }
  }

  async function addArea(area: string) {
    if (areaBusyRef.current) return;
    areaBusyRef.current = true;
    setAddingArea(true);
    try {
      const res = await fetch("/api/student-areas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, area, isPrimary: false }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to add area");
        toast.error(msg);
      } else {
        onUpdated();
      }
    } catch {
      toast.error("Network error");
    } finally {
      areaBusyRef.current = false;
      setAddingArea(false);
    }
  }

  async function removeArea(assignmentId: string) {
    if (areaBusyRef.current) return;
    areaBusyRef.current = true;
    try {
      const res = await fetch(`/api/student-areas?id=${assignmentId}`, {
        method: "DELETE",
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to remove area");
        toast.error(msg);
      } else {
        onUpdated();
      }
    } catch {
      toast.error("Network error");
    } finally {
      areaBusyRef.current = false;
    }
  }

  async function toggleAreaPrimary(area: string, isPrimary: boolean) {
    if (areaBusyRef.current) return;
    areaBusyRef.current = true;
    try {
      const res = await fetch("/api/student-areas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, area, isPrimary }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to update area");
        toast.error(msg);
      } else {
        onUpdated();
      }
    } catch {
      toast.error("Network error");
    } finally {
      areaBusyRef.current = false;
    }
  }

  const locationOptions = locations.map((l) => ({
    value: l.id,
    label: l.name,
  }));
  const locationOptionsUnavailable = locationsLoading || locationsError;

  const assignedSportCodes = new Set((user.sportAssignments ?? []).map((sa) => sa.sportCode));

  const assignedAreas = new Set((user.areaAssignments ?? []).map((aa) => aa.area));
  const showCollaboratorAffiliation = isAdmin && (user.role === "COLLABORATOR" || revealedCollaboratorAffiliation);

  return (
    <div className="mt-3.5 flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
      <div className="flex flex-col gap-4">
        <Card id="contact" className="scroll-mt-16 rounded-xl shadow-xs">
        <CardHeader>
          <CardTitle className="text-base font-black tracking-tight">Contact</CardTitle>
        </CardHeader>
        <CardContent className="p-0 py-1">
          <TextInputField
            label="Name"
            value={user.name}
            canEdit={canEditProfile || canEditSelf}
            onSave={(v) => patchUser({ name: v })}
          />
          <TextInputField
            label="Campus email"
            value={user.email}
            canEdit={canEditProfile}
            onSave={(v) => patchUser({ email: v })}
            type="email"
          />
          <TextInputField
            label="Athletics email"
            value={user.athleticsEmail || ""}
            placeholder="name@athletics.wisc.edu"
            canEdit={canEditProfile || canEditSelf}
            onSave={(v) => patchUser({ athleticsEmail: v || null })}
            type="email"
          />
          <TextInputField
            label="Personal phone"
            value={formatPhoneInput(user.personalPhone || "")}
            placeholder="(XXX) XXX-XXXX"
            canEdit={canEditProfile || canEditSelf}
            onSave={(v) => patchUser({ personalPhone: v || null })}
            type="tel"
            formatInput={formatPhoneInput}
          />
          <TextInputField
            label="Work phone"
            value={formatPhoneInput(user.workPhone || "")}
            placeholder={user.workPhoneNotApplicable ? "No work phone" : "(XXX) XXX-XXXX"}
            canEdit={canEditProfile || canEditSelf}
            onSave={(v) => patchUser({ workPhone: v || null })}
            type="tel"
            formatInput={formatPhoneInput}
          />
          {(canEditProfile || canEditSelf) && (
            <WiscardFields
              cardNumber={user.wiscardCardNumber || ""}
              issueCode={user.wiscardIssueCode || ""}
              canEdit
              onPatch={patchUser}
            />
          )}
        </CardContent>
      </Card>

      <Card id="work" className="scroll-mt-16 rounded-xl shadow-xs">
        <CardHeader>
          <CardTitle className="text-base font-black tracking-tight">Work</CardTitle>
        </CardHeader>
        <CardContent className="p-0 py-1">
          <SelectInputField
            label="Role"
            value={user.role}
            options={ROLE_OPTIONS}
            canEdit={canEditRole}
            onSave={changeRole}
          />
          {showCollaboratorAffiliation && (
            <SelectInputField
              label="Collaborator affiliation"
              value={selectedCollaboratorPolicyId}
              options={activeCollaboratorPolicies.map((policy) => ({
                value: policy.id,
                label: `${policy.affiliation.displayName} (${policy.affiliation.badgeLabel}) · ${policy.capabilities.length} controls`,
              }))}
              canEdit={canEditRole}
              onSave={async (policyId) => {
                setSelectedCollaboratorPolicyId(policyId);
                if (user.role === "COLLABORATOR") {
                  const response = await fetch(`/api/users/${user.id}/role`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ role: "COLLABORATOR", collaboratorPolicyId: policyId }),
                  });
                  if (handleAuthRedirect(response)) return;
                  if (!response.ok) throw new Error(await parseErrorMessage(response, "Failed to change affiliation"));
                  onUpdated();
                }
              }}
              allowEmpty={user.role !== "COLLABORATOR"}
              emptyLabel="Only needed for Collaborator"
            />
          )}
          {locationsError && (
            <Alert variant="destructive" className="mx-3 my-2 w-auto">
              <AlertCircle className="size-4" />
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Locations could not load, so profile location editing is unavailable. The saved profile location is still shown.</span>
                {onRetryLocations && (
                  <Button type="button" variant="outline" onClick={onRetryLocations} className="h-10 shrink-0">
                    Retry locations
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
          {locationOptionsUnavailable ? (
            <SaveableField label="Location">
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full justify-start px-3 text-sm font-normal text-muted-foreground"
                disabled
                aria-label="Location unavailable"
              >
                {locationsLoading && <Spinner className="mr-2 size-3" />}
                {user.location || "No location"}
              </Button>
            </SaveableField>
          ) : (
            <SelectInputField
              label="Location"
              value={user.locationId || ""}
              options={locationOptions}
              canEdit={canEditProfile || canEditSelf}
              onSave={(v) => patchUser({ locationId: v || null })}
              allowEmpty
              emptyLabel="No location"
            />
          )}
          <SelectInputField
            label="Primary area"
            value={user.primaryArea || ""}
            options={AREA_OPTIONS}
            canEdit={canEditProfile}
            onSave={(v) => patchUser({ primaryArea: v || null })}
            allowEmpty
            emptyLabel="Not assigned"
          />
          {!targetIsStudent && (
            <TextInputField
              label="Title"
              value={user.title || ""}
              placeholder="e.g. Digital Producer"
              canEdit={canEditProfile || canEditSelf}
              onSave={(v) => patchUser({ title: v || null })}
            />
          )}
          <DateInputField
            label="Start date"
            value={user.startDate}
            canEdit={canEditProfile || canEditSelf}
            onSave={(iso) => patchUser({ startDate: iso })}
          />
          {targetIsStudent && (
            <>
              <SelectInputField
                label="Year"
                value={user.studentYearOverride || ""}
                options={STUDENT_YEAR_OPTIONS as { value: string; label: string }[]}
                canEdit={canEditProfile || canEditSelf}
                onSave={(v) => patchUser({ studentYearOverride: (v || null) as StudentYear | null })}
                emptyLabel="Select year"
              />
              <SelectInputField
                label="Anticipated graduation"
                value={anticipatedGraduationValue(user.graduationTerm, user.gradYear)}
                options={ANTICIPATED_GRADUATION_OPTIONS}
                canEdit={canEditProfile || canEditSelf}
                onSave={async (value) => {
                  const graduation = parseAnticipatedGraduation(value);
                  if (!graduation) throw new Error("Select an anticipated graduation term");
                  await patchUser({
                    graduationTerm: graduation.term,
                    gradYear: graduation.year,
                  });
                }}
                emptyLabel="Select term and year"
              />
            </>
          )}
          <DirectReportField
            user={user}
            canEdit={canEditProfile}
            onSavePicked={(pickedId) => patchUser({ directReportId: pickedId })}
            onSaveFreeText={(name) => patchUser({ directReportName: name })}
          />
          <BirthdayField
            user={user}
            canEdit={canEditProfile || canEditSelf}
            onPatch={patchUser}
          />
          <SizesRow
            user={user}
            isStudent={targetIsStudent}
            canEdit={canEditProfile || canEditSelf}
            onPatch={patchUser}
          />
          {user.createdAt && (
            <SaveableField label="Member since">
              <p className="m-0 text-sm">{formatDateFull(user.createdAt)}</p>
            </SaveableField>
          )}
        </CardContent>
      </Card>

      {isSelf && <MyHoursCard />}

      {isSelf && (
        <CalendarSubscriptionCard
          initialHasToken={user.hasIcsToken ?? false}
          onTokenChange={onUpdated}
        />
      )}
      </div>

      <div className="flex flex-col gap-4">
      <ProfileGlanceCard user={user} />
      <Card id="assignments" className="scroll-mt-16 rounded-xl shadow-xs">
        <CardHeader>
          <CardTitle className="text-base font-black tracking-tight">Assignments</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="py-1">
            <SelectInputField
              label="Schedule as"
              value={user.staffingType}
              options={STAFFING_TYPE_OPTIONS}
              canEdit={canEditStaffingClass}
              onSave={(v) => patchUser({ staffingType: v })}
            />
          </div>
          <div className="px-6 pb-6 pt-2">
          {/* Sport Assignments — Multi-select */}
          <h3 className="text-sm font-semibold mb-2">Sports</h3>
          {canEditAssignments ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-label="Sports assignments"
                  className="h-auto min-h-10 w-full justify-between font-normal"
                  disabled={addingSport}
                >
                  {(user.sportAssignments ?? []).length === 0 ? (
                    <span className="text-muted-foreground">Select sports...</span>
                  ) : (
                    <div className="flex flex-wrap gap-1 py-0.5">
                      {(user.sportAssignments ?? []).map((sa) => (
                        <Badge key={sa.id} variant="blue" size="sm">
                          {sportLabel(sa.sportCode)}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search sports..." aria-label="Search sports" />
                  <CommandList>
                    <CommandEmpty>No sports found.</CommandEmpty>
                    <CommandGroup>
                      {SPORT_OPTIONS.map((s) => {
                        const isSelected = assignedSportCodes.has(s.value);
                        const assignment = (user.sportAssignments ?? []).find((sa) => sa.sportCode === s.value);
                        return (
                          <CommandItem
                            key={s.value}
                            value={s.label}
                            onSelect={() => {
                              if (isSelected && assignment) {
                                removeSport(assignment.id, s.value);
                              } else {
                                addSport(s.value);
                              }
                            }}
                          >
                            <Check className={cn("mr-2 size-4", isSelected ? "opacity-100" : "opacity-0")} />
                            {s.label}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          ) : (user.sportAssignments ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground mb-1">No sport assignments</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 mb-1">
              {(user.sportAssignments ?? []).map((sa) => (
                <Badge key={sa.id} variant="blue" size="sm">
                  {sportLabel(sa.sportCode)}
                </Badge>
              ))}
            </div>
          )}

          <Separator className="my-3" />

          {/* Area Assignments — Multi-select */}
          <h3 className="text-sm font-semibold mb-2">Areas</h3>
          {canEditAssignments ? (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-label="Area assignments"
                    className="h-auto min-h-10 w-full justify-between font-normal"
                    disabled={addingArea}
                  >
                    {(user.areaAssignments ?? []).length === 0 ? (
                      <span className="text-muted-foreground">Select areas...</span>
                    ) : (
                      <span>
                        {(user.areaAssignments ?? []).length} area{(user.areaAssignments ?? []).length === 1 ? "" : "s"} selected
                      </span>
                    )}
                    <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandList>
                      <CommandGroup>
                        {AREA_OPTIONS.map((a) => {
                          const isSelected = assignedAreas.has(a.value);
                          const assignment = (user.areaAssignments ?? []).find((aa) => aa.area === a.value);
                          return (
                            <CommandItem
                              key={a.value}
                              value={a.label}
                              onSelect={() => {
                                if (isSelected && assignment) {
                                  removeArea(assignment.id);
                                } else {
                                  addArea(a.value);
                                }
                              }}
                            >
                              <Check className={cn("mr-2 size-4", isSelected ? "opacity-100" : "opacity-0")} />
                              {a.label}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {(user.areaAssignments ?? []).length > 0 && (
                <div className="mt-2 grid gap-1.5">
                  {(user.areaAssignments ?? []).map((aa) => (
                    <div
                      key={aa.id}
                      className="flex min-h-10 items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/40 py-1 pl-3 pr-1.5 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-foreground">
                          {AREA_LABELS[aa.area] || aa.area}
                        </span>
                        {aa.isPrimary && (
                          <Badge variant="purple" size="sm" className="ml-2">Primary</Badge>
                        )}
                      </div>
                      <OperationalRowActions label={`Actions for ${AREA_LABELS[aa.area] || aa.area} area`}>
                        <DropdownMenuItem onSelect={() => void toggleAreaPrimary(aa.area, !aa.isPrimary)}>
                          {aa.isPrimary ? "Remove primary" : "Set primary"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => void removeArea(aa.id)}
                        >
                          Remove area
                        </DropdownMenuItem>
                      </OperationalRowActions>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (user.areaAssignments ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No area assignments</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {(user.areaAssignments ?? []).map((aa) => (
                <Badge
                  key={aa.id}
                  variant={aa.isPrimary ? "purple" : "gray"}
                  size="sm"
                >
                  {AREA_LABELS[aa.area] || aa.area}
                  {aa.isPrimary && " (Primary)"}
                </Badge>
              ))}
            </div>
          )}
          </div>
        </CardContent>
      </Card>
      </div>
      </div>

    </div>
  );
}
