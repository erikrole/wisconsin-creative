"use client";

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { toLocalDateTimeValue } from "../booking-list/types";
import type { BulkSelection } from "@/components/EquipmentPicker";
import type { BookingListConfig, CalendarEvent } from "../booking-list/types";
import type { FormState, FormAction } from "./types";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";

export function useDraftManagement({
  draftId,
  open,
  form,
  selectedAssetIds,
  selectedBulkItems,
  dispatch,
  setSelectedAssetIds,
  setSelectedBulkItems,
  onDraftIdChange,
  config,
}: {
  draftId: string | null;
  open: boolean;
  form: FormState;
  selectedAssetIds: string[];
  selectedBulkItems: BulkSelection[];
  dispatch: Dispatch<FormAction>;
  setSelectedAssetIds: Dispatch<SetStateAction<string[]>>;
  setSelectedBulkItems: Dispatch<SetStateAction<BulkSelection[]>>;
  onDraftIdChange: (id: string | null) => void;
  config: BookingListConfig;
}) {
  const draftLoadedRef = useRef(false);

  // ── Load draft ──
  useEffect(() => {
    if (!draftId || draftLoadedRef.current || !open) return;
    draftLoadedRef.current = true;
    fetch(`/api/drafts/${draftId}`)
      .then(async (res) => {
        if (handleAuthRedirect(res)) return null;
        if (!res.ok) {
          toast.error(await parseErrorMessage(res, "Couldn’t load your draft"));
          return null;
        }
        return parseJsonSafely<{ data?: Record<string, unknown> }>(res);
      })
      .then((json) => {
        if (!json?.data) return;
        const d = json.data;
        const draft: Partial<FormState> = {};
        if (typeof d.title === "string" && d.title !== "Untitled draft") draft.title = d.title;
        if (typeof d.requesterUserId === "string") draft.requester = d.requesterUserId;
        if (typeof d.locationId === "string") draft.locationId = d.locationId;
        if (typeof d.startsAt === "string") draft.startsAt = toLocalDateTimeValue(new Date(d.startsAt));
        if (typeof d.endsAt === "string") draft.endsAt = toLocalDateTimeValue(new Date(d.endsAt));
        if (typeof d.sportCode === "string") draft.sport = d.sportCode;
        if (typeof d.notes === "string") draft.notes = d.notes;
        if (d.custodyScope === "PERSON" || d.custodyScope === "SHARED") draft.custodyScope = d.custodyScope;
        if (Array.isArray(d.events) && d.events.length) {
          draft.tieToEvent = true;
          draft.selectedEvents = d.events as CalendarEvent[];
        }
        dispatch({ type: "LOAD_DRAFT", draft });
        if (Array.isArray(d.serializedAssetIds) && d.serializedAssetIds.length) setSelectedAssetIds(d.serializedAssetIds as string[]);
        if (Array.isArray(d.bulkItems) && d.bulkItems.length) {
          setSelectedBulkItems(
            d.bulkItems.map((bi: { bulkSkuId: string; quantity: number }) => ({
              bulkSkuId: bi.bulkSkuId,
              quantity: bi.quantity,
            })),
          );
        }
      })
      .catch(() => {
        toast.error("Couldn\u2019t load your draft \u2014 starting fresh");
      });
  }, [dispatch, draftId, open, setSelectedAssetIds, setSelectedBulkItems]);

  // ── Draft save ──
  const saveDraft = useCallback(async () => {
    const hasData = form.title.trim() || selectedAssetIds.length > 0 || selectedBulkItems.length > 0;
    if (!hasData) return;
    try {
      const payload: Record<string, unknown> = {
        kind: config.kind,
        title: form.title.trim(),
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        serializedAssetIds: selectedAssetIds,
        bulkItems: selectedBulkItems,
        custodyScope: form.custodyScope,
      };
      if (draftId) payload.id = draftId;
      if (form.requester) payload.requesterUserId = form.requester;
      if (form.locationId) payload.locationId = form.locationId;
      if (form.notes.trim()) payload.notes = form.notes.trim();
      if (form.selectedEvents.length > 0) {
        payload.eventIds = form.selectedEvents.map((e) => e.id);
        payload.sportCode = form.selectedEvents[0]!.sportCode || form.sport || undefined;
      } else if (form.sport) {
        payload.sportCode = form.sport;
      }
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        const json = await parseJsonSafely<{ data?: { id?: string } }>(res);
        if (!json?.data?.id) {
          toast.error("Draft was saved, but the response was incomplete. Refresh and try again.");
          return;
        }
        onDraftIdChange(json.data.id);
        toast.info("Draft saved");
      } else {
        toast.error(await parseErrorMessage(res, "Draft couldn’t be saved"));
      }
    } catch {
      toast.error("Draft couldn\u2019t be saved \u2014 your changes may be lost");
    }
  }, [form, selectedAssetIds, selectedBulkItems, draftId, config.kind, onDraftIdChange]);

  // ── Delete draft ──
  async function deleteDraft() {
    if (!draftId) return;
    try {
      await fetch(`/api/drafts/${draftId}`, { method: "DELETE" });
    } catch {
      /* best-effort */
    }
    onDraftIdChange(null);
  }

  // Expose resetDraftLoaded so parent can clear it after successful submission
  function resetDraftLoaded() {
    draftLoadedRef.current = false;
  }

  return { saveDraft, deleteDraft, resetDraftLoaded };
}
