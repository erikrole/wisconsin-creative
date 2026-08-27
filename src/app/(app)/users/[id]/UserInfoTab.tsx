"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { sportLabel } from "@/lib/sports";
import { SPORT_CODES } from "@/lib/sports";
import type { UserDetail, Location, Role, StudentYear } from "../types";
import { AREA_LABELS, AREA_OPTIONS, ROLE_OPTIONS, STAFFING_TYPE_OPTIONS, STUDENT_YEAR_OPTIONS } from "../types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, Check, ChevronsUpDown, ClockIcon, Copy, InfoIcon, RefreshCw, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SaveableField, useSaveField } from "@/components/SaveableField";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { cn } from "@/lib/utils";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { copyTextToClipboard } from "@/lib/clipboard";
import { PROFILE_COMPLETION_QUERY_KEY } from "@/hooks/use-profile-completion";
import { syncCachedUserLists } from "@/lib/user-list-cache";
import { formatPhoneInput } from "@/lib/profile-phone";
import { APPAREL_FIT_OPTIONS, MENS_SHOE_SIZE_OPTIONS, SHOE_SYSTEM_OPTIONS, TOP_SIZE_OPTIONS, WOMENS_SHOE_SIZE_OPTIONS } from "@/lib/profile-sizing";
import {
  anticipatedGraduationOptions,
  anticipatedGraduationValue,
  parseAnticipatedGraduation,
} from "@/lib/student-profile";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type ApiEnvelope<T = unknown> = {
  data?: T;
  error?: string;
};

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

/* ── Text Input Field ─────────────────────────────────── */

function TextInputField({
  label,
  value,
  placeholder,
  canEdit,
  onSave,
  type = "text",
  formatInput,
}: {
  label: ReactNode;
  value: string;
  placeholder?: string;
  canEdit: boolean;
  onSave: (v: string) => Promise<void>;
  type?: "text" | "email" | "tel" | "url";
  formatInput?: (value: string) => string;
}) {
  const [draft, setDraft] = useState(value);
  const { status, save } = useSaveField(onSave);
  const id = useId();

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed === value) return;
    save(trimmed);
  }, [draft, value, save]);

  return (
    <SaveableField label={label} status={status} htmlFor={id}>
      <Input
        id={id}
        type={type}
        value={draft}
        onChange={(e) => setDraft(formatInput ? formatInput(e.target.value) : e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        disabled={!canEdit}
        className="h-8 text-sm"
      />
    </SaveableField>
  );
}

/* ── Select Input Field ───────────────────────────────── */

function SelectInputField({
  label,
  value,
  options,
  canEdit,
  onSave,
  allowEmpty,
  emptyLabel,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  canEdit: boolean;
  onSave: (v: string) => Promise<void>;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const { status, save } = useSaveField(onSave);

  return (
    <SaveableField label={label} status={status}>
      <Select
        value={value || "__none__"}
        onValueChange={(v) => {
          const resolved = v === "__none__" ? "" : v;
          if (resolved === value) return;
          save(resolved);
        }}
        disabled={!canEdit}
      >
        <SelectTrigger size="sm" className="text-sm" aria-label={label}>
          <SelectValue placeholder={emptyLabel || "None"} />
        </SelectTrigger>
        <SelectContent><SelectGroup>
          {allowEmpty && (
            <SelectItem value="__none__">{emptyLabel || "None"}</SelectItem>
          )}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectGroup></SelectContent>
      </Select>
    </SaveableField>
  );
}

/* ── Date Input Field ─────────────────────────────────── */

function DateInputField({
  label,
  value,
  canEdit,
  onSave,
}: {
  label: string;
  value: string | null;          // ISO datetime
  canEdit: boolean;
  onSave: (iso: string | null) => Promise<void>;
}) {
  const initial = value ? value.slice(0, 10) : "";
  const [draft, setDraft] = useState(initial);
  const { status, save } = useSaveField<string | null>(onSave);
  const id = useId();

  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const commit = useCallback(() => {
    if (draft === initial) return;
    if (!draft) {
      save(null);
      return;
    }
    // Normalize to UTC midnight; date column in Postgres ignores time.
    const iso = new Date(`${draft}T00:00:00.000Z`).toISOString();
    save(iso);
  }, [draft, initial, save]);

  return (
    <SaveableField label={label} status={status} htmlFor={id}>
      <Input
        id={id}
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        disabled={!canEdit}
        className="h-8 text-sm"
      />
    </SaveableField>
  );
}

/* ── Direct Report Autocomplete ───────────────────────── */

type DirectReportSearchResult = { id: string; name: string; email: string };

function DirectReportField({
  user,
  canEdit,
  onSavePicked,
  onSaveFreeText,
}: {
  user: UserDetail;
  canEdit: boolean;
  onSavePicked: (pickedUserId: string | null) => Promise<void>;
  onSaveFreeText: (name: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectReportSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const linkedName = user.directReport?.name ?? null;
  const displayValue = linkedName ?? user.directReportName ?? "";

  // Debounced search against the existing /api/users endpoint.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users?q=${encodeURIComponent(trimmed)}&limit=8&active=all`);
        if (handleAuthRedirect(res)) return;
        if (!res.ok) return;
        const json = await parseJsonSafely<ApiEnvelope<Array<{ id: string; name: string; email: string }>>>(res);
        const data: DirectReportSearchResult[] = (json?.data ?? [])
          .filter((u: { id: string }) => u.id !== user.id)
          .map((u: { id: string; name: string; email: string }) => ({
            id: u.id, name: u.name, email: u.email,
          }));
        setResults(data);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open, user.id]);

  async function pickUser(picked: DirectReportSearchResult) {
    setOpen(false);
    setQuery("");
    await onSavePicked(picked.id);
  }

  async function saveFreeTextFromQuery() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setOpen(false);
    setQuery("");
    await onSaveFreeText(trimmed);
  }

  async function clear() {
    setOpen(false);
    setQuery("");
    if (user.directReportId) {
      await onSavePicked(null);
    } else if (user.directReportName) {
      await onSaveFreeText(null);
    }
  }

  return (
    <SaveableField label="Direct Report" status="idle">
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            disabled={!canEdit}
            aria-label="Direct report"
            className="w-full justify-between h-10 font-normal text-sm"
          >
            {displayValue ? (
              <span className="flex items-center gap-1.5 truncate">
                <span className="truncate">{displayValue}</span>
                {!linkedName && user.directReportName && <span className="text-xs text-muted-foreground">(external)</span>}
              </span>
            ) : (
              <span className="text-muted-foreground">No direct report</span>
            )}
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search users or type a name..."
              aria-label="Search direct reports"
              value={query}
              onValueChange={setQuery}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results.length === 0 && query.trim()) {
                  e.preventDefault();
                  void saveFreeTextFromQuery();
                }
              }}
            />
            <CommandList>
              {searching && (
                <CommandEmpty>Searching…</CommandEmpty>
              )}
              {!searching && results.length === 0 && query.trim().length >= 2 && (
                <CommandEmpty>
                  <button
                    type="button"
                    className="text-sm text-left w-full px-2 py-1 hover:bg-accent rounded"
                    onClick={saveFreeTextFromQuery}
                  >
                    Use “{query.trim()}” as free-text
                  </button>
                </CommandEmpty>
              )}
              {!searching && results.length === 0 && query.trim().length < 2 && (
                <CommandEmpty>Type at least 2 characters…</CommandEmpty>
              )}
              {results.length > 0 && (
                <CommandGroup heading="Users">
                  {results.map((r) => (
                    <CommandItem
                      key={r.id}
                      value={r.id}
                      onSelect={() => pickUser(r)}
                    >
                      <div className="flex flex-col">
                        <span>{r.name}</span>
                        <span className="text-xs text-muted-foreground">{r.email}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {(user.directReportId || user.directReportName) && (
                <CommandGroup>
                  <CommandItem onSelect={clear} className="text-destructive">
                    <X className="mr-2 size-4" /> Clear
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </SaveableField>
  );
}

/* ── Sizes Row (compact 2- or 3-column inline edit) ───── */

function SizeMiniSelect({
  label,
  value,
  options,
  canEdit,
  onSave,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  canEdit: boolean;
  onSave: (v: string | null) => Promise<void>;
}) {
  const { status, save } = useSaveField<string | null>(onSave);
  const choices = value && !options.some((option) => option.value === value)
    ? [{ value, label: value }, ...options]
    : options;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {status === "saving" && " · saving"}
        {status === "saved" && " · saved"}
        {status === "error" && " · error"}
      </span>
      <Select value={value || "__none__"} onValueChange={(next) => save(next === "__none__" ? null : next)} disabled={!canEdit}>
        <SelectTrigger size="sm" aria-label={label}><SelectValue placeholder="Select" /></SelectTrigger>
        <SelectContent><SelectGroup>
          <SelectItem value="__none__">Not set</SelectItem>
          {choices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}
        </SelectGroup></SelectContent>
      </Select>
    </div>
  );
}

function SizesRow({
  user,
  isStudent,
  canEdit,
  onPatch,
}: {
  user: UserDetail;
  isStudent: boolean;
  canEdit: boolean;
  onPatch: (payload: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <div className="px-3 py-2 border-t flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">Sizes</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <SizeMiniSelect
          label="Top fit"
          value={user.topSizeFit ?? ""}
          options={APPAREL_FIT_OPTIONS}
          canEdit={canEdit}
          onSave={(v) => onPatch({ topSizeFit: v })}
        />
        <SizeMiniSelect
          label={isStudent ? "Clothing size" : "Top size"}
          value={user.topSize ?? ""}
          options={TOP_SIZE_OPTIONS.map((value) => ({ value, label: value }))}
          canEdit={canEdit}
          onSave={(v) => onPatch({ topSize: v })}
        />
        {!isStudent && (
          <SizeMiniSelect
            label="Bottom size"
            value={user.bottomSize ?? ""}
            options={TOP_SIZE_OPTIONS.map((value) => ({ value, label: value }))}
            canEdit={canEdit}
            onSave={(v) => onPatch({ bottomSize: v })}
          />
        )}
        <SizeMiniSelect
          label="Shoe sizing"
          value={user.shoeSizeSystem ?? ""}
          options={SHOE_SYSTEM_OPTIONS}
          canEdit={canEdit}
          onSave={(v) => onPatch({ shoeSizeSystem: v })}
        />
        <SizeMiniSelect
          label="Shoe size"
          value={user.shoeSize ?? ""}
          options={(user.shoeSizeSystem === "US_MENS" ? MENS_SHOE_SIZE_OPTIONS : WOMENS_SHOE_SIZE_OPTIONS).map((value) => ({ value, label: value }))}
          canEdit={canEdit}
          onSave={(v) => onPatch({ shoeSize: v })}
        />
      </div>
    </div>
  );
}

const MONTH_OPTIONS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function BirthdayField({
  user,
  canEdit,
  canViewBirthYear,
  onPatch,
}: {
  user: UserDetail;
  canEdit: boolean;
  canViewBirthYear: boolean;
  onPatch: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [month, setMonth] = useState(user.birthdayMonth ? String(user.birthdayMonth) : "");
  const [day, setDay] = useState(user.birthdayDay ? String(user.birthdayDay) : "");
  const [year, setYear] = useState(user.birthYear ? String(user.birthYear) : "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMonth(user.birthdayMonth ? String(user.birthdayMonth) : "");
    setDay(user.birthdayDay ? String(user.birthdayDay) : "");
    setYear(user.birthYear ? String(user.birthYear) : "");
  }, [user.birthdayMonth, user.birthdayDay, user.birthYear]);

  const dirty = month !== (user.birthdayMonth ? String(user.birthdayMonth) : "")
    || day !== (user.birthdayDay ? String(user.birthdayDay) : "")
    || (canViewBirthYear && year !== (user.birthYear ? String(user.birthYear) : ""));

  async function saveBirthday() {
    if ((month && !day) || (!month && day)) {
      toast.error("Choose both a birthday month and day");
      return;
    }
    setSaving(true);
    try {
      await onPatch({
        birthdayMonth: month ? Number(month) : null,
        birthdayDay: day ? Number(day) : null,
        ...(canViewBirthYear ? { birthYear: year ? Number(year) : null } : {}),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SaveableField label="Birthday" ariaLabel="birthday" className="items-start">
      <div className={cn("grid grid-cols-2 gap-2", canViewBirthYear ? "sm:grid-cols-[1.5fr_0.8fr_1fr_auto]" : "sm:grid-cols-[1.5fr_0.8fr_auto]")}>
        <Select value={month || "__none__"} onValueChange={(value) => setMonth(value === "__none__" ? "" : value)} disabled={!canEdit || saving}>
          <SelectTrigger size="sm" aria-label="Birthday month"><SelectValue placeholder="Month" /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="__none__">Month</SelectItem>
            {MONTH_OPTIONS.map((label, index) => <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
        <Select value={day || "__none__"} onValueChange={(value) => setDay(value === "__none__" ? "" : value)} disabled={!canEdit || saving}>
          <SelectTrigger size="sm" aria-label="Birthday day"><SelectValue placeholder="Day" /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="__none__">Day</SelectItem>
            {Array.from({ length: 31 }, (_, index) => String(index + 1)).map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
        {canViewBirthYear && (
          <Input type="number" inputMode="numeric" min={1900} max={2100} value={year} onChange={(event) => setYear(event.target.value.slice(0, 4))} placeholder="Year" aria-label="Birth year" disabled={!canEdit || saving} className="h-8" />
        )}
        <Button type="button" className="h-10" onClick={saveBirthday} disabled={!canEdit || !dirty || saving}>
          {saving && <Spinner data-icon="inline-start" />}
          Save
        </Button>
      </div>
    </SaveableField>
  );
}

function WiscardFields({
  cardNumber,
  issueCode,
  canEdit,
  onPatch,
}: {
  cardNumber: string;
  issueCode: string;
  canEdit: boolean;
  onPatch: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [cardDraft, setCardDraft] = useState(cardNumber);
  const [issueDraft, setIssueDraft] = useState(issueCode);
  const cardSave = useSaveField<string>((value) => onPatch({ wiscardCardNumber: value || null }));
  const issueSave = useSaveField<string>((value) => onPatch({ wiscardIssueCode: value || null }));
  const cardId = useId();
  const issueId = useId();

  useEffect(() => setCardDraft(cardNumber), [cardNumber]);
  useEffect(() => setIssueDraft(issueCode), [issueCode]);

  const status = cardSave.status === "saving" || issueSave.status === "saving"
    ? "saving"
    : cardSave.status === "error" || issueSave.status === "error"
      ? "error"
      : cardSave.status === "saved" || issueSave.status === "saved"
        ? "saved"
        : "idle";

  return (
    <SaveableField label="Wiscard number" status={status} htmlFor={cardId}>
      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          id={cardId}
          inputMode="numeric"
          autoComplete="off"
          value={cardDraft}
          onChange={(event) => setCardDraft(event.target.value.replace(/\D/g, "").slice(0, 10))}
          onBlur={() => { if (cardDraft !== cardNumber) void cardSave.save(cardDraft); }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          placeholder="XXXXXXXXXX"
          disabled={!canEdit}
          className="h-8 text-sm"
        />
        <div className="flex min-w-0 items-center gap-1.5">
          <label htmlFor={issueId} className="whitespace-nowrap text-xs text-muted-foreground">Issue code</label>
          <Input
            id={issueId}
            inputMode="numeric"
            autoComplete="off"
            aria-label="Issue code"
            value={issueDraft}
            onChange={(event) => setIssueDraft(event.target.value.replace(/\D/g, "").slice(0, 1))}
            onBlur={() => { if (issueDraft !== issueCode) void issueSave.save(issueDraft); }}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            placeholder="X"
            disabled={!canEdit}
            className="h-8 w-14 min-w-0 text-sm"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label="Where to find the Wiscard issue code" className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <InfoIcon />
              </button>
            </TooltipTrigger>
            <TooltipContent>Issue code can be found in the bottom right of your Wiscard</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </SaveableField>
  );
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

  useEffect(() => {
    setSelectedCollaboratorPolicyId(user.collaboratorPolicy?.id ?? "");
  }, [user.collaboratorPolicy?.id]);

  // Fields a user can edit on their own profile (mirrors updateProfileSchema).
  const SELF_EDITABLE_FIELDS = new Set([
    "name", "locationId", "phone", "personalPhone", "workPhone", "slackHandle", "slackProfileUrl",
    "wiscardNumber", "wiscardCardNumber", "wiscardIssueCode",
    "title", "athleticsEmail", "startDate", "gradYear", "graduationTerm", "studentYearOverride",
    "topSizeFit", "topSize", "bottomSize", "shoeSizeSystem", "shoeSize",
    "birthdayMonth", "birthdayDay", "birthYear",
  ]);

  async function patchUser(payload: Record<string, unknown>) {
    const isSelfProfileField =
      isSelf && Object.keys(payload).every((k) => SELF_EDITABLE_FIELDS.has(k));

    const url = isSelfProfileField
      ? "/api/profile"
      : `/api/users/${user.id}`;

    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (handleAuthRedirect(res)) return;
    if (!res.ok) {
      const msg = await parseErrorMessage(res, "Failed to update user");
      throw new Error(msg);
    }
    const cachePatch = { ...payload };
    if (Object.prototype.hasOwnProperty.call(payload, "locationId")) {
      const locationId = typeof payload.locationId === "string" ? payload.locationId : null;
      cachePatch.location = locations.find((location) => location.id === locationId)?.name ?? null;
    }
    await syncCachedUserLists(queryClient, user.id, cachePatch);
    onUpdated();
    await queryClient.invalidateQueries({ queryKey: PROFILE_COMPLETION_QUERY_KEY });
  }

  async function changeRole(newRole: string) {
    if (newRole === "COLLABORATOR" && !selectedCollaboratorPolicyId) {
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 mt-3.5">
      <div className="flex flex-col gap-4">
        {/* Profile Card */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="p-0 py-1">
          <TextInputField
            label="Name"
            value={user.name}
            canEdit={canEditProfile || canEditSelf}
            onSave={(v) => patchUser({ name: v })}
          />
          <TextInputField
            label="Campus Email"
            value={user.email}
            canEdit={canEditProfile}
            onSave={(v) => patchUser({ email: v })}
            type="email"
          />
          <TextInputField
            label="Athletics Email"
            value={user.athleticsEmail || ""}
            placeholder="name@athletics.wisc.edu"
            canEdit={canEditProfile || canEditSelf}
            onSave={(v) => patchUser({ athleticsEmail: v || null })}
            type="email"
          />
          <TextInputField
            label="Personal Phone"
            value={formatPhoneInput(user.personalPhone || "")}
            placeholder="(XXX) XXX-XXXX"
            canEdit={canEditProfile || canEditSelf}
            onSave={(v) => patchUser({ personalPhone: v || null })}
            type="tel"
            formatInput={formatPhoneInput}
          />
          <TextInputField
            label="Work Phone"
            value={formatPhoneInput(user.workPhone || "")}
            placeholder={user.workPhoneNotApplicable ? "No work phone" : "(XXX) XXX-XXXX"}
            canEdit={canEditProfile || canEditSelf}
            onSave={(v) => patchUser({ workPhone: v || null })}
            type="tel"
            formatInput={formatPhoneInput}
          />
          <WiscardFields
            cardNumber={user.wiscardCardNumber || ""}
            issueCode={user.wiscardIssueCode || ""}
            canEdit={canEditProfile || canEditSelf}
            onPatch={patchUser}
          />
          <SelectInputField
            label="Role"
            value={user.role}
            options={ROLE_OPTIONS}
            canEdit={canEditRole}
            onSave={changeRole}
          />
          {isAdmin && (
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
              emptyLabel="Select before assigning"
            />
          )}
          <SelectInputField
            label="Scheduling class"
            value={user.staffingType}
            options={STAFFING_TYPE_OPTIONS}
            canEdit={canEditStaffingClass}
            onSave={(v) => patchUser({ staffingType: v })}
          />
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
            label="Primary Area"
            value={user.primaryArea || ""}
            options={AREA_OPTIONS}
            canEdit={canEditProfile}
            onSave={(v) => patchUser({ primaryArea: v || null })}
            allowEmpty
            emptyLabel="Not assigned"
          />
        </CardContent>
      </Card>

      {/* Details Card — fields migrated from the team Sheet */}
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="p-0 py-1">
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
            label="Start Date"
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
                label="Anticipated Graduation"
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
            canViewBirthYear={isSelf || isAdmin}
            onPatch={patchUser}
          />
          <SizesRow
            user={user}
            isStudent={targetIsStudent}
            canEdit={canEditProfile || canEditSelf}
            onPatch={patchUser}
          />
        </CardContent>
      </Card>

      {/* My Hours Card — only shown for own profile */}
      {isSelf && <MyHoursCard />}

      {/* Calendar Subscription — only shown for own profile */}
      {isSelf && (
        <CalendarSubscriptionCard
          initialToken={user.icsToken ?? null}
          onTokenChange={onUpdated}
        />
      )}
      </div>

      {/* Assignments Card */}
      <Card>
        <CardHeader>
          <CardTitle>Assignments</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

    </div>
  );
}

/* ── My Hours Card ──────────────────────────────────────── */

type MyHoursData = {
  thisWeek: number;
  thisMonth: number;
  shiftCountWeek: number;
  shiftCountMonth: number;
};

async function fetchMyHours(): Promise<MyHoursData | null> {
  const r = await fetch("/api/shifts/my-hours");
  if (handleAuthRedirect(r)) return null;
  if (!r.ok) return null;
  const j = await parseJsonSafely<ApiEnvelope<MyHoursData>>(r);
  return j?.data ?? null;
}

function MyHoursCard() {
  const { data: hours } = useQuery({
    queryKey: ["shifts", "my-hours"],
    queryFn: fetchMyHours,
    staleTime: 5 * 60_000,
  });

  if (!hours || (hours.shiftCountWeek === 0 && hours.shiftCountMonth === 0)) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClockIcon className="size-4" />
          My hours
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-2xl font-bold">{hours.thisWeek}h</div>
            <div className="text-xs text-muted-foreground">
              This week ({hours.shiftCountWeek} shift{hours.shiftCountWeek !== 1 ? "s" : ""})
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold">{hours.thisMonth}h</div>
            <div className="text-xs text-muted-foreground">
              This month ({hours.shiftCountMonth} shift{hours.shiftCountMonth !== 1 ? "s" : ""})
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Calendar Subscription Card ─────────────────────────── */

function CalendarSubscriptionCard({
  initialToken,
  onTokenChange,
}: {
  initialToken: string | null;
  onTokenChange: () => void;
}) {
  const [token, setToken] = useState(initialToken);
  const [generating, setGenerating] = useState(false);

  const feedUrl = token
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/shifts/ics/${token}`
    : null;
  const webcalUrl = feedUrl ? feedUrl.replace(/^https?/, "webcal") : null;

  async function generateToken() {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/shifts/ics-token", { method: "POST" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to generate token");
        toast.error(msg);
      } else {
        const json = await parseJsonSafely<ApiEnvelope<{ token?: string }>>(res);
        setToken(json?.data?.token ?? null);
        onTokenChange();
      }
    } catch {
      toast.error("Network error");
    } finally {
      setGenerating(false);
    }
  }

  async function copyUrl() {
    if (!feedUrl) return;
    const copied = await copyTextToClipboard(feedUrl);
    if (copied) {
      toast.success("Feed URL copied");
      return;
    }
    toast.error("Could not copy the feed URL", {
      description: "Select the visible URL and copy it manually.",
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calendar subscription</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {token ? (
          <>
            <p className="text-sm text-muted-foreground">
              Subscribe to your shifts in Apple Calendar, Google Calendar, or any app that supports ICS feeds.
              The URL stays in sync — no re-subscribing needed.
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={feedUrl ?? ""}
                className="h-8 text-xs font-mono"
                onFocus={(e) => e.target.select()}
              />
              <Button variant="outline" className="h-10" onClick={() => void copyUrl()} title="Copy URL">
                <Copy className="size-4" />
              </Button>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button asChild className="h-10">
                <a href={webcalUrl ?? "#"}>Subscribe in Calendar</a>
              </Button>
              <Button className="h-10"
                variant="outline"
                onClick={generateToken}
                disabled={generating}
                title="Rotate token — invalidates the old URL"
              >
                {generating ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Rotate URL
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Generate a private URL to subscribe to your shifts in any calendar app.
            </p>
            <Button className="h-10" onClick={generateToken} disabled={generating}>
              {generating && <RefreshCw className="size-4 animate-spin mr-2" />}
              Generate feed URL
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
