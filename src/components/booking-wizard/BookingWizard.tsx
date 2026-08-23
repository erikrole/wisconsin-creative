"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { EQUIPMENT_SECTIONS, classifyAssetType } from "@/lib/equipment-sections";
import { getUnsatisfiedRequirements } from "@/lib/equipment-guidance";
import type { EquipmentSectionKey } from "@/lib/equipment-sections";
import type { BulkSelection, EquipmentPickerSelectionState } from "@/components/EquipmentPicker";
import {
  roundTo15Min,
  toLocalDateTimeValue,
  type FormUser,
  type Location,
  type AvailableAsset,
  type BulkSkuOption,
} from "@/components/booking-list/types";
import type { FormState, FormAction } from "@/components/create-booking/types";
import { applyDurationPreservingStartChange } from "@/components/create-booking/date-duration";
import { useEventContext } from "@/components/create-booking/use-event-context";
import { useDraftManagement } from "@/components/create-booking/use-draft-management";
import { useKitFetching } from "@/components/create-booking/use-kit-fetching";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useFormOptions } from "@/hooks/use-form-options";
import { WizardStep1 } from "./WizardStep1";
import { WizardStep2 } from "./WizardStep2";
import { WizardStep3 } from "./WizardStep3";
import { applyBulkShortageRecovery, getStep2PrimaryActionLabel } from "./flow-summary";
import { CheckIcon, AlertCircleIcon, RotateCcwIcon, XIcon } from "lucide-react";

/* ───── Config per kind ───── */

type WizardConfig = {
  kind: "RESERVATION";
  apiBase: string;
  label: string;
  actionLabel: string;
  actionLabelProgress: string;
  requesterLabel: string;
  startLabel: string;
  endLabel: string;
  defaultTieToEvent: boolean;
};

const RESERVATION_CONFIG: WizardConfig = {
  kind: "RESERVATION",
  apiBase: "/api/reservations",
  label: "reservation",
  actionLabel: "Reserve for later",
  actionLabelProgress: "Reserving\u2026",
  requesterLabel: "Reserved for",
  startLabel: "Start",
  endLabel: "End",
  defaultTieToEvent: true,
};

const EMPTY_PICKER_SELECTION_STATE: EquipmentPickerSelectionState = {
  totalSelected: 0,
  resolvedAssetCount: 0,
  bulkQuantity: 0,
  unresolvedAssetCount: 0,
  conflictCount: 0,
  upcomingCommitmentCount: 0,
  turnaroundRiskCount: 0,
  bulkTurnaroundRiskCount: 0,
  checkingAvailability: false,
};

/* ───── Form reducer ───── */

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "SET_TIE_TO_EVENT":
      return { ...state, tieToEvent: action.value, selectedEvents: [] };
    case "SET_SPORT":
      return { ...state, sport: action.value, selectedEvents: [] };
    case "SET_SELECTED_EVENTS":
      return {
        ...state,
        selectedEvents: action.events,
        title: action.title ?? state.title,
        startsAt: action.startsAt ?? state.startsAt,
        endsAt: action.endsAt ?? state.endsAt,
        locationId: action.locationId ?? state.locationId,
      };
    case "SET_TITLE":
      return { ...state, title: action.value };
    case "SET_REQUESTER":
      return { ...state, requester: action.value };
    case "SET_LOCATION_ID":
      return { ...state, locationId: action.value };
    case "SET_STARTS_AT":
      return applyDurationPreservingStartChange(state, action.value);
    case "SET_ENDS_AT":
      return { ...state, endsAt: action.value };
    case "SET_NOTES":
      return { ...state, notes: action.value };
    case "RESET":
      return {
        tieToEvent: action.defaults.tieToEvent ?? true,
        sport: "",
        selectedEvents: [],
        title: "",
        requester: action.defaults.requester ?? "",
        locationId: action.defaults.locationId ?? "",
        startsAt: toLocalDateTimeValue(roundTo15Min(new Date())),
        endsAt: toLocalDateTimeValue(roundTo15Min(new Date(Date.now() + 24 * 60 * 60 * 1000))),
        notes: "",
      };
    case "LOAD_DRAFT":
      return { ...state, ...action.draft };
    default:
      return state;
  }
}

/* ───── Component ───── */

export function BookingWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const config = RESERVATION_CONFIG;

  // ── URL params ──
  const initialTitle = searchParams.get("title") || "";
  const initialStartsAt = searchParams.get("startsAt") || undefined;
  const initialEndsAt = searchParams.get("endsAt") || undefined;
  const initialLocationId = searchParams.get("locationId") || undefined;
  const initialAssetIds = searchParams.get("newFor") ? [searchParams.get("newFor")!] : undefined;
  const initialEventId = searchParams.get("eventId") || undefined;
  const initialSportCode = searchParams.get("sportCode") || undefined;
  const initialDraftId = searchParams.get("draftId") || null;
  const initialRequesterUserId = searchParams.get("requesterUserId") || undefined;
  const initialShiftAssignmentId = searchParams.get("shiftAssignmentId") || undefined;

  // ── Form options ──
  const { data: formOpts, isError: formOptsError, refetch: refetchFormOpts } = useFormOptions();
  const users: FormUser[] = formOpts?.users ?? [];
  const locations: Location[] = formOpts?.locations ?? [];
  const bulkSkus: BulkSkuOption[] = formOpts?.bulkSkus ?? [];

  // ── Current user ──
  const { data: meData } = useCurrentUser();
  const initialRequester = initialRequesterUserId ?? meData?.id ?? "";
  const firstLocationId = locations[0]?.id ?? "";

  // ── Existing drafts (for resume banner) ──
  // Persist dismissal for 1 hour via sessionStorage so it doesn't reappear on every reload.
  const draftBannerKey = "wi:draftBannerDismissed:RESERVATION";
  const [draftBannerDismissed, setDraftBannerDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    const ts = window.sessionStorage.getItem(draftBannerKey);
    if (!ts) return false;
    return Date.now() - Number(ts) < 60 * 60 * 1000;
  });
  const dismissDraftBanner = useCallback(() => {
    setDraftBannerDismissed(true);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(draftBannerKey, String(Date.now()));
    }
  }, [draftBannerKey]);
  const { data: draftsData } = useQuery({
    queryKey: ["drafts"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/drafts", { signal });
      if (handleAuthRedirect(res)) return null;
      if (!res.ok) return null;
      const json = await parseJsonSafely<{ data?: Array<{ id: string; kind: string; title: string; itemCount: number; updatedAt: string }> }>(res);
      return json?.data ?? null;
    },
    staleTime: 30_000,
    enabled: !initialDraftId, // skip if already resuming a draft
  });
  const existingDrafts: Array<{ id: string; kind: string; title: string; itemCount: number; updatedAt: string }> =
    (draftsData ?? []).filter((d: { kind: string }) => d.kind === "RESERVATION");

  // ── Step state ──
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // ── Form state ──
  const [form, dispatch] = useReducer(formReducer, {
    tieToEvent: config.defaultTieToEvent || !!initialSportCode,
    sport: initialSportCode || "",
    selectedEvents: [],
    title: initialTitle,
    requester: initialRequester || "",
    locationId: initialLocationId || locations[0]?.id || "",
    startsAt: initialStartsAt || toLocalDateTimeValue(roundTo15Min(new Date())),
    endsAt: initialEndsAt || toLocalDateTimeValue(roundTo15Min(new Date(Date.now() + 24 * 60 * 60 * 1000))),
    notes: "",
  });

  useEffect(() => {
    if (initialRequester && !form.requester) {
      dispatch({ type: "SET_REQUESTER", value: initialRequester });
    }
  }, [initialRequester, form.requester]);

  useEffect(() => {
    if (firstLocationId && !form.locationId) {
      dispatch({ type: "SET_LOCATION_ID", value: firstLocationId });
    }
  }, [firstLocationId, form.locationId]);

  // ── Equipment state ──
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(initialAssetIds ?? []);
  const [selectedBulkItems, setSelectedBulkItems] = useState<BulkSelection[]>([]);
  const [selectedAssetDetails, setSelectedAssetDetails] = useState<AvailableAsset[]>([]);
  const [pickerSelectionState, setPickerSelectionState] = useState<EquipmentPickerSelectionState>(
    EMPTY_PICKER_SELECTION_STATE,
  );
  const resolvedSelectedAssetIds = useMemo(
    () => selectedAssetDetails.map((asset) => asset.id),
    [selectedAssetDetails],
  );
  const [activeSection, setActiveSection] = useState<EquipmentSectionKey>(EQUIPMENT_SECTIONS[0]!.key);

  // ── Kit state ──
  const [kitId, setKitId] = useState<string>("");
  const { kits, kitsLoading, kitsLoadError, retryKits } = useKitFetching({ locationId: form.locationId, open: true });

  // ── Events + shift ──
  const { events, eventsLoading, eventsLoadError, retryEvents, myShiftForEvent, toggleEvent } = useEventContext({
    sport: form.sport,
    tieToEvent: form.tieToEvent,
    open: true,
    selectedEvents: form.selectedEvents,
    initialEventId,
    dispatch,
  });

  // ── Draft management ──
  const [draftId, setDraftId] = useState<string | null>(initialDraftId);
  const { saveDraft, deleteDraft } = useDraftManagement({
    draftId,
    open: true,
    form,
    selectedAssetIds: resolvedSelectedAssetIds,
    selectedBulkItems,
    dispatch,
    setSelectedAssetIds,
    setSelectedBulkItems,
    onDraftIdChange: setDraftId,
    config: { apiBase: config.apiBase } as never,
  });

  // ── Submission state ──
  const [createError, setCreateError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const submittingRef = useRef(false);

  // Clears the error banner whenever the user edits any step-1 field.
  const step1Dispatch = useCallback((action: FormAction) => {
    setCreateError("");
    dispatch(action);
  }, []);

  // ── Equipment requirement check ──
  const unsatisfiedRequirements = useMemo(() => {
    if (selectedAssetDetails.length === 0) return [];
    const sectionKeys = [...new Set(
      selectedAssetDetails.map((a) => classifyAssetType(a.type, a.categoryName))
    )] as EquipmentSectionKey[];
    if (selectedBulkItems.length > 0) sectionKeys.push("batteries");
    return getUnsatisfiedRequirements(sectionKeys);
  }, [selectedAssetDetails, selectedBulkItems]);

  // ── Item count ──
  const itemCount = selectedAssetDetails.length + selectedBulkItems.reduce((sum, b) => sum + b.quantity, 0);

  // ── Warn before unload ──
  useEffect(() => {
    const hasData = form.title.trim() || selectedAssetIds.length > 0 || selectedBulkItems.length > 0;
    if (!hasData) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [form.title, selectedAssetIds.length, selectedBulkItems.length]);

  // ── Step 1 validation ──
  function validateStep1(): string | null {
    if (!form.title.trim()) return "Give this booking a name";
    if (!form.requester) return "Select who this is for";
    if (!form.locationId) return "Choose a pickup location";
    const s = new Date(form.startsAt);
    const e = new Date(form.endsAt);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return "Invalid date. Check start and end times";
    if (e <= s) return "End date must be after start date";
    return null;
  }

  // ── Step 2 validation ──
  function validateStep2(): string | null {
    if (itemCount === 0) return "Add at least one piece of equipment";
    if (unsatisfiedRequirements.length > 0) return unsatisfiedRequirements[0]!.message;
    return null;
  }

  // ── Navigation ──
  function handleNext() {
    if (step === 1) {
      const error = validateStep1();
      if (error) { setCreateError(error); return; }
      setCreateError("");
      setStep(2);
    } else if (step === 2) {
      if (itemCount === 0 && pickerSelectionState.unresolvedAssetCount > 0) {
        setCreateError("Remove unavailable selected items or pick replacement equipment before review");
        return;
      }
      const error = validateStep2();
      if (error) { setCreateError(error); return; }
      setCreateError("");
      setStep(3);
    }
  }

  function getStep2PrimaryLabel() {
    return getStep2PrimaryActionLabel({
      ...pickerSelectionState,
      itemCount,
    });
  }
  const step2NeedsEquipment =
    step === 2 &&
    itemCount === 0 &&
    pickerSelectionState.unresolvedAssetCount === 0;

  function handleBack() {
    setCreateError("");
    if (step === 2) setStep(1);
    if (step === 3) setStep(2);
  }

  // ── Submit ──
  async function handleSubmit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setCreateError("");

    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      requesterUserId: form.requester,
      locationId: form.locationId,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      serializedAssetIds: resolvedSelectedAssetIds,
      bulkItems: selectedBulkItems,
    };

    if (kitId) payload.kitId = kitId;
    if (form.notes.trim()) payload.notes = form.notes.trim();
    if (initialShiftAssignmentId) payload.shiftAssignmentId = initialShiftAssignmentId;
    if (form.selectedEvents.length > 0) {
      // Multi-event contract (D-031): client always sends `eventIds[]` sorted chronologically.
      // Server picks ordinal 0 as the canonical Booking.eventId and writes a BookingEvent
      // junction row per id. Legacy `eventId` field is mutually exclusive — never sent here.
      payload.eventIds = form.selectedEvents.map((e) => e.id);
      payload.sportCode = form.selectedEvents[0]!.sportCode || form.sport || undefined;
    } else if (form.sport) {
      payload.sportCode = form.sport;
    }

    try {
      const res = await fetchWithTimeout(config.apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) await saveDraft();
      if (handleAuthRedirect(res)) return;

      const json = await parseJsonSafely<{
        error?: string;
        data?: {
          id?: string;
          refNumber?: string | null;
          conflicts?: Array<{ assetId: string; conflictingBookingTitle?: string }>;
          unavailableAssets?: Array<{ assetId: string; status: string }>;
          shortages?: Array<{ bulkSkuId: string; requested: number; available: number }>;
        };
      }>(res);
      if (!res.ok) {
        if (res.status === 409 && json?.data) {
          const msgs: string[] = [];
          const d = json.data;
          // Auto-remove conflicting/unavailable assets so user doesn't have to find them manually
          const tagFor = (id: string) => selectedAssetDetails.find((a) => a.id === id)?.assetTag || id;
          const conflictingAssetIds = new Set<string>([
            ...(d.conflicts?.map((c) => c.assetId) ?? []),
            ...(d.unavailableAssets?.map((u) => u.assetId) ?? []),
          ]);
          msgs.push(
            ...(d.conflicts?.map((c) => `${tagFor(c.assetId)} conflicts with \u201c${c.conflictingBookingTitle || "another booking"}\u201d`) ?? []),
            ...(d.unavailableAssets?.map((u) => `${tagFor(u.assetId)} is ${u.status === "MAINTENANCE" ? "in maintenance" : u.status.toLowerCase()}`) ?? []),
            ...(d.shortages?.map((s) => `${bulkSkus.find((sk) => sk.id === s.bulkSkuId)?.name || s.bulkSkuId}: only ${s.available} available (requested ${s.requested})`) ?? []),
          );
          if (conflictingAssetIds.size > 0) {
            setSelectedAssetIds((prev) => prev.filter((id) => !conflictingAssetIds.has(id)));
          }
          // Auto-clamp bulk quantities to server-reported availability so the user
          // doesn't have to infer and repair the too-high quantity manually.
          const bulkRecovery = d.shortages?.length
            ? applyBulkShortageRecovery(
                selectedBulkItems,
                d.shortages,
                (id) => bulkSkus.find((sk) => sk.id === id)?.name,
              )
            : null;
          if (bulkRecovery && bulkRecovery.adjustedCount > 0) {
            setSelectedBulkItems(bulkRecovery.nextBulkItems);
          }
          const removedCount = conflictingAssetIds.size;
          const bulkAdjustedCount = bulkRecovery?.adjustedCount ?? 0;
          const conflictMessage = msgs.length > 0 ? msgs.join(". ") : json?.error || "Availability conflict";
          const removalNote = removedCount > 0
            ? `${removedCount} item${removedCount !== 1 ? "s" : ""} removed from your selection.`
            : "";
          const bulkNote = bulkAdjustedCount > 0
            ? "Bulk quantities adjusted to available stock."
            : "";
          const notes = [removalNote, bulkNote].filter(Boolean).join(" ");
          setCreateError(notes ? `${conflictMessage}. ${notes}` : conflictMessage);
          setStep(2);
        } else {
          setCreateError(json?.error || await parseErrorMessage(res, `Couldn\u2019t create this ${config.label}. Please try again`));
        }
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }

      await deleteDraft();
      const created = json?.data;
      if (!created?.id) {
        setCreateError(`${config.label} was created, but the response was incomplete. Refresh the list to find it.`);
        return;
      }
      const refNumber = created.refNumber ?? undefined;
      toast.success(`${config.label.charAt(0).toUpperCase() + config.label.slice(1)}${refNumber ? ` ${refNumber}` : ""} created`, {
        description: "Opened Bookings with this reservation highlighted.",
      });

      const bookingId = created.id;
      const params = new URLSearchParams();
      params.set("tab", "reservations");
      params.set("highlight", bookingId);
      router.push(`/bookings?${params.toString()}`);
    } catch {
      setCreateError(`Couldn\u2019t create this ${config.label}. Please try again`);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const steps = [
    { label: "Details", step: 1 as const },
    { label: "Equipment", step: 2 as const },
    { label: "Confirm", step: 3 as const },
  ];
  const headerTitle = form.title.trim() || "Reservation details";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:py-12">

      {/* ── Header ── */}
      <header className="mb-7 flex flex-col items-center gap-2 text-center">
        <Badge variant="purple" size="sm">
          Reservation
        </Badge>
        <h1 className="max-w-3xl">
          {headerTitle}
        </h1>
      </header>

      {/* ── Existing drafts banner ── */}
      {!draftBannerDismissed && existingDrafts.length > 0 && (
        <div className="mb-6 rounded-md border border-border/60 bg-background/80 shadow-xs">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <RotateCcwIcon data-icon="inline-start" className="shrink-0 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">
                {existingDrafts.length === 1
                  ? "Draft available"
                  : `${existingDrafts.length} drafts available`}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {existingDrafts.slice(0, 2).map((d) => (
                <Button key={d.id} variant="ghost" asChild className="h-10 shrink-0">
                  <a href={`/reservations/new?draftId=${d.id}`}>
                    {d.title || "Resume"}
                  </a>
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={dismissDraftBanner}
                aria-label="Dismiss draft banner"
              >
                <XIcon />
              </Button>
            </div>
          </div>
          {existingDrafts.length > 2 && (
            <div className="px-3 pb-2 text-xs text-muted-foreground">
              Resume another draft from the dashboard.
            </div>
          )}
        </div>
      )}

      {/* ── Step progress ── */}
      <div
        className="mb-8 flex items-center justify-center gap-2"
        role="navigation"
        aria-label="Wizard steps"
      >
        {steps.map((s) => {
          const isActive = step === s.step;
          const isDone = step > s.step;
          const isLocked = s.step > step;
          return (
            <Button
              key={s.step}
              type="button"
              variant="ghost"
              disabled={isLocked}
              onClick={() => { if (isDone) { setCreateError(""); setStep(s.step); } }}
              className={cn(
                "h-10 rounded-full px-3 text-xs text-muted-foreground",
                isActive && "bg-foreground text-background hover:bg-foreground/90 hover:text-background",
                isDone && "text-foreground hover:bg-muted/60",
                isLocked && "cursor-default",
              )}
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center text-[10px] font-semibold",
                  isLocked && "opacity-30",
                )}
              >
                {isDone ? <CheckIcon /> : s.step}
              </span>

              <span
                className={cn(
                  "font-medium",
                  isLocked && "opacity-30",
                )}
              >
                {s.label}
              </span>
            </Button>
          );
        })}
      </div>

      {/* ── Form options error ── */}
      {formOptsError && (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>Failed to load form data. Dropdowns may be empty.</span>
          <Button variant="outline" onClick={() => refetchFormOpts()} className="h-10 shrink-0">
            Retry
          </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ── Error banner ── */}
      {createError && (
        <Alert variant="destructive" className="mb-5">
          <AlertCircleIcon />
          <AlertDescription>{createError}</AlertDescription>
        </Alert>
      )}

      {/* ── Step content ── */}
      {step === 1 && (
        <WizardStep1
          form={form}
          dispatch={step1Dispatch}
          config={config}
          users={users}
          locations={locations}
          kits={kits}
          kitsLoading={kitsLoading}
          kitsLoadError={kitsLoadError}
          kitId={kitId}
          setKitId={setKitId}
          onRetryKits={retryKits}
          events={events}
          eventsLoading={eventsLoading}
          eventsLoadError={eventsLoadError}
          onRetryEvents={retryEvents}
          myShiftForEvent={myShiftForEvent}
          toggleEvent={toggleEvent}
        />
      )}

      {step === 2 && (
        <WizardStep2
          form={form}
          bulkSkus={bulkSkus}
          selectedAssetIds={selectedAssetIds}
          setSelectedAssetIds={setSelectedAssetIds}
          selectedBulkItems={selectedBulkItems}
          setSelectedBulkItems={setSelectedBulkItems}
          onSelectedAssetsChange={setSelectedAssetDetails}
          onSelectionStateChange={setPickerSelectionState}
          selectionState={pickerSelectionState}
          itemCount={itemCount}
          activeSection={activeSection}
          onActiveSectionChange={setActiveSection}
        />
      )}

      {step === 3 && (
        <WizardStep3
          config={config}
          form={form}
          users={users}
          locations={locations}
          selectedAssetDetails={selectedAssetDetails}
          selectedBulkItems={selectedBulkItems}
          bulkSkus={bulkSkus}
          itemCount={itemCount}
          selectionState={pickerSelectionState}
        />
      )}

      {/* ── Footer navigation ── */}
      <div className="mt-10 flex items-center justify-between border-t border-border/60 pt-5">
        <div>
          {step > 1 && (
            <Button className="h-10"
              variant="outline"
              onClick={handleBack}
            >
              Back
            </Button>
          )}
          {step === 1 && (
            <Button
              variant="ghost"
              disabled={savingDraft}
              loading={savingDraft}
              onClick={async () => {
                setSavingDraft(true);
                await saveDraft();
                setSavingDraft(false);
                router.back();
              }}
              className="h-10 text-muted-foreground"
            >
              Save draft & exit
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {step < 3 && (
            <Button
              onClick={handleNext}
              disabled={step2NeedsEquipment}
            >
              {step === 2 && getStep2PrimaryLabel()}
              {step === 1 && "Next"}
            </Button>
          )}
          {step === 3 && (
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              loading={submitting}
              variant="brand"
              size="lg"
            >
              {config.actionLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
