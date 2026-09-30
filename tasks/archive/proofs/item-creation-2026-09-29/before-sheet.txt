"use client";

import { FormEvent, type ComponentType, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircleIcon, CheckCircle2Icon, CopyPlusIcon, LayersIcon, PackageIcon, ScanLineIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import ChooseImageModal from "@/components/ChooseImageModal";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { cn } from "@/lib/utils";

import type {
  FormValidationIssue,
  NewItemSheetProps,
  ItemKind,
  RequiredFieldProgress,
  SerializedIntakeTemplate,
} from "./new-item-sheet/types";
import { SectionHeading, SuccessFlash } from "@/components/form-layout";
import {
  SerializedItemForm,
  type SerializedFormHandle,
  type SerializedSubmitEntry,
} from "./new-item-sheet/SerializedItemForm";
import { BulkItemForm, type BulkFormHandle } from "./new-item-sheet/BulkItemForm";
import {
  persistDraftItemImage,
  type DraftItemImage,
} from "@/lib/item-image-draft";
import { getRepeatTagBase } from "./new-item-sheet/repeat-tags";
import {
  buildSerializedIntakeTemplate,
  type SerializedTemplateSource,
} from "./new-item-sheet/serialized-template";
import { serializedUnitFieldId } from "./new-item-sheet/serialized-batch";

type ImageStatus = "none" | "saved" | "failed";

type CreatedHandoff = {
  kind: ItemKind;
  label: string;
  href: string;
  openLabel: string;
  successMessage: string;
  description: string;
  createdRecord: boolean;
  imageEndpoint: string | null;
  failedImageEndpoints?: string[];
  imageStatus: ImageStatus;
  imageError: string;
  repeatTemplate?: SerializedIntakeTemplate;
  continuationTemplate?: SerializedIntakeTemplate;
  heading?: string;
  batch?: {
    attempted: number;
    created: number;
    failures: SerializedBatchFailure[];
  };
};

type SerializedBatchFailure = {
  unitKey: string;
  assetTag: string;
  message: string;
  fieldId: string;
};

type SubmissionProgress = {
  phase: "records" | "images";
  current: number;
  total: number;
};

type ItemCreateResponse = {
  data?: {
    id?: string;
  };
};

type SerializedSourceResponse = {
  data?: unknown;
};

type RelatedAssetResponse = {
  data?: Array<{ assetTag?: string | null }>;
};

function parseSerializedTemplateSource(value: unknown): SerializedTemplateSource | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== "string" || typeof source.assetTag !== "string") return null;
  const nestedId = (nested: unknown) => {
    if (!nested || typeof nested !== "object") return null;
    const id = (nested as Record<string, unknown>).id;
    return typeof id === "string" ? { id } : null;
  };
  return {
    id: source.id,
    assetTag: source.assetTag,
    name: typeof source.name === "string" ? source.name : null,
    brand: typeof source.brand === "string" ? source.brand : null,
    model: typeof source.model === "string" ? source.model : null,
    linkUrl: typeof source.linkUrl === "string" ? source.linkUrl : null,
    imageUrl: typeof source.imageUrl === "string" ? source.imageUrl : null,
    location: nestedId(source.location),
    category: nestedId(source.category),
    department: nestedId(source.department),
    parentAsset: nestedId(source.parentAsset),
    availableForReservation: typeof source.availableForReservation === "boolean" ? source.availableForReservation : true,
    availableForCheckout: typeof source.availableForCheckout === "boolean" ? source.availableForCheckout : true,
    availableForCustody: typeof source.availableForCustody === "boolean" ? source.availableForCustody : true,
  };
}

type KindOption = {
  kind: ItemKind;
  id: string;
  title: string;
  badge: string;
  badgeVariant: BadgeProps["variant"];
  description: string;
  outcome: string;
  icon: ComponentType<{ className?: string }>;
};

const KIND_OPTIONS: KindOption[] = [
  {
    kind: "standard",
    id: "kind-standard",
    title: "Standard",
    badge: "Serialized",
    badgeVariant: "blue",
    description: "One specific physical item with its own tag and scan code.",
    outcome: "Creates one item record that can be reserved, checked out, and found by QR.",
    icon: ScanLineIcon,
  },
  {
    kind: "units",
    id: "kind-units",
    title: "Units",
    badge: "Numbered family",
    badgeVariant: "purple",
    description: "One item family with numbered or scannable units under it.",
    outcome: "Creates a family record plus numbered units for kiosk pickup and return.",
    icon: LayersIcon,
  },
  {
    kind: "quantity",
    id: "kind-quantity",
    title: "Quantity",
    badge: "Count stock",
    badgeVariant: "green",
    description: "Count-only stock where individual units are not scanned.",
    outcome: "Creates or updates one stock record and tracks the count on hand.",
    icon: PackageIcon,
  },
];

function optionForKind(kind: ItemKind) {
  return KIND_OPTIONS.find((option) => option.kind === kind) ?? KIND_OPTIONS[0]!;
}

function payloadSuccessMessage(label: string, createdRecord: boolean) {
  if (!createdRecord) {
    return `"${label}" stock updated successfully.`;
  }
  return `"${label}" created successfully.`;
}

function batchFailureFieldId(entry: SerializedSubmitEntry, message: string) {
  if (message.startsWith("Serial number")) {
    return serializedUnitFieldId(entry.unit, "serial");
  }
  if (message.startsWith("QR code")) {
    return serializedUnitFieldId(entry.unit, "qr");
  }
  return serializedUnitFieldId(entry.unit, "asset-tag");
}

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-2 py-3">
      <span className="mt-0.5 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 text-right text-sm font-medium">{children}</div>
    </div>
  );
}

export function NewItemSheet({
  open,
  onOpenChange,
  locations,
  departments,
  categories,
  onCreated,
  sourceAssetId = null,
}: NewItemSheetProps) {
  const router = useRouter();
  const [kind, setKind] = useState<ItemKind>("standard");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const submittingRef = useRef(false);
  const successTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [createdHandoff, setCreatedHandoff] = useState<CreatedHandoff | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageSearchQuery, setImageSearchQuery] = useState("");
  const [imageDraft, setImageDraft] = useState<DraftItemImage | null>(null);
  const [imageRetrying, setImageRetrying] = useState(false);
  const [requiredProgress, setRequiredProgress] = useState<RequiredFieldProgress>({ completed: 0, total: 4 });
  const [bulkOperation, setBulkOperation] = useState<"create" | "adjust">("create");
  const [dirty, setDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [serializedTemplate, setSerializedTemplate] = useState<SerializedIntakeTemplate | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceLoadError, setSourceLoadError] = useState("");
  const [sourceLoadVersion, setSourceLoadVersion] = useState(0);
  const [serializedUnitCount, setSerializedUnitCount] = useState(1);
  const [submissionProgress, setSubmissionProgress] = useState<SubmissionProgress | null>(null);
  const [deferredImageEndpoints, setDeferredImageEndpoints] = useState<string[]>([]);
  const [batchContinuationTemplate, setBatchContinuationTemplate] = useState<SerializedIntakeTemplate | null>(null);

  const serializedRef = useRef<SerializedFormHandle>(null);
  const bulkRef = useRef<BulkFormHandle>(null);
  const sheetBodyRef = useRef<HTMLDivElement>(null);
  const sourceLoadRef = useRef(0);
  const resetAll = useCallback(() => {
    sourceLoadRef.current += 1;
    setError("");
    setSuccessMsg("");
    setKind("standard");
    setCreatedHandoff(null);
    setShowImageModal(false);
    setImageSearchQuery("");
    setImageDraft(null);
    setImageRetrying(false);
    setRequiredProgress({ completed: 0, total: 4 });
    setBulkOperation("create");
    setDirty(false);
    setShowDiscardConfirm(false);
    setSerializedTemplate(null);
    setSourceLoading(false);
    setSourceLoadError("");
    setSerializedUnitCount(1);
    setSubmissionProgress(null);
    setDeferredImageEndpoints([]);
    setBatchContinuationTemplate(null);
    serializedRef.current?.reset();
    bulkRef.current?.reset();
  }, []);

  function showSuccessMessage(msg: string) {
    setSuccessMsg(msg);
    clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setSuccessMsg(""), 3000);
  }

  useEffect(() => () => clearTimeout(successTimer.current), []);

  useEffect(() => {
    if (!open || !sourceAssetId) return;
    const requestId = ++sourceLoadRef.current;
    const controller = new AbortController();
    setKind("standard");
    setSerializedTemplate(null);
    setSourceLoadError("");
    setSourceLoading(true);
    setImageDraft(null);
    setSerializedUnitCount(1);
    setSubmissionProgress(null);
    setDeferredImageEndpoints([]);
    setBatchContinuationTemplate(null);

    void (async () => {
      try {
        const sourceRes = await fetch(`/api/assets/${sourceAssetId}`, { signal: controller.signal });
        if (handleAuthRedirect(sourceRes)) return;
        if (!sourceRes.ok) {
          throw new Error(await parseErrorMessage(sourceRes, "Could not load the source item."));
        }
        const sourceJson = await parseJsonSafely<SerializedSourceResponse>(sourceRes);
        const source = parseSerializedTemplateSource(sourceJson?.data);
        if (!source) {
          throw new Error("The source item returned an unreadable response.");
        }
        if (source.parentAsset) {
          throw new Error("Attached items need a parent selection. Start a blank item instead.");
        }

        let relatedAssets: Array<{ assetTag?: string | null }> = [];
        const repeatBase = getRepeatTagBase(source.assetTag);
        try {
          const relatedRes = await fetch(
            `/api/assets?q=${encodeURIComponent(repeatBase)}&limit=200&include_accessories=true`,
            { signal: controller.signal },
          );
          if (handleAuthRedirect(relatedRes)) return;
          if (relatedRes.ok) {
            const relatedJson = await parseJsonSafely<RelatedAssetResponse>(relatedRes);
            if (Array.isArray(relatedJson?.data)) relatedAssets = relatedJson.data;
          }
        } catch (relatedError) {
          if (relatedError instanceof Error && relatedError.name === "AbortError") return;
          // The source tag still provides a safe sequential fallback.
        }

        if (requestId !== sourceLoadRef.current || controller.signal.aborted) return;
        const template = buildSerializedIntakeTemplate(source, relatedAssets);
        setSerializedTemplate(template);
        setImageDraft(
          typeof source.imageUrl === "string" && source.imageUrl.startsWith("https://")
            ? { kind: "remote", url: source.imageUrl, previewUrl: source.imageUrl }
            : null,
        );
        setImageSearchQuery(template.productLabel);
        setDirty(true);
      } catch (sourceError) {
        if (sourceError instanceof Error && sourceError.name === "AbortError") return;
        if (requestId !== sourceLoadRef.current) return;
        setSourceLoadError(sourceError instanceof Error ? sourceError.message : "Could not load the source item.");
      } finally {
        if (requestId === sourceLoadRef.current) setSourceLoading(false);
      }
    })();

    return () => controller.abort();
  }, [open, sourceAssetId, sourceLoadVersion]);

  const markInteraction = useCallback(() => {
    setError("");
    setDirty(true);
  }, []);

  function focusValidationIssue(issue: FormValidationIssue) {
    setError(issue.message);
    if (kind === "standard") {
      serializedRef.current?.focusField(issue.fieldId);
    } else {
      bulkRef.current?.focusField(issue.fieldId);
    }
  }

  function showFormError(message: string, fieldId?: string) {
    setError(message);
    if (fieldId) {
      if (kind === "standard") serializedRef.current?.focusField(fieldId);
      else bulkRef.current?.focusField(fieldId);
      return;
    }
    requestAnimationFrame(() => sheetBodyRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function startBlankSerializedItem() {
    sourceLoadRef.current += 1;
    setKind("standard");
    setSerializedTemplate(null);
    setSourceLoading(false);
    setSourceLoadError("");
    setImageDraft(null);
    setImageSearchQuery("");
    setRequiredProgress({ completed: 0, total: 4 });
    setSerializedUnitCount(1);
    setSubmissionProgress(null);
    setDeferredImageEndpoints([]);
    setBatchContinuationTemplate(null);
    setDirty(false);
    serializedRef.current?.reset();
    requestAnimationFrame(() => serializedRef.current?.focus());
  }

  function closeAndReset() {
    onOpenChange(false);
    resetAll();
  }

  function requestClose() {
    if (submitting) return;
    if (createdHandoff) {
      onCreated();
      closeAndReset();
      return;
    }
    if (dirty) {
      setShowDiscardConfirm(true);
      return;
    }
    closeAndReset();
  }

  function finishCreatedHandoff(mode: "another" | "similar" | "remaining" | "open" | "list") {
    if (!createdHandoff) return;
    const handoff = createdHandoff;
    onCreated();
    if (mode === "remaining" && handoff.batch?.failures.length) {
      setError("");
      setSuccessMsg("");
      setCreatedHandoff(null);
      setImageRetrying(false);
      setSubmissionProgress(null);
      setDeferredImageEndpoints(handoff.failedImageEndpoints ?? []);
      setBatchContinuationTemplate(handoff.continuationTemplate ?? null);
      setDirty(true);
      showSuccessMessage(`${handoff.batch.created} created. Only the ${handoff.batch.failures.length} unfinished ${handoff.batch.failures.length === 1 ? "item remains" : "items remain"}.`);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => serializedRef.current?.focus());
      });
    } else if (mode === "similar" && handoff.repeatTemplate) {
      setError("");
      setSuccessMsg("");
      setKind("standard");
      setCreatedHandoff(null);
      setSerializedTemplate(handoff.repeatTemplate);
      setImageRetrying(false);
      setRequiredProgress({ completed: 0, total: 4 });
      setSerializedUnitCount(handoff.repeatTemplate.batchSize ?? 1);
      setSubmissionProgress(null);
      setDeferredImageEndpoints([]);
      setBatchContinuationTemplate(null);
      setBulkOperation("create");
      setDirty(true);
      showSuccessMessage(`Product details kept from "${handoff.label}". Enter the new serials and shipment details.`);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => serializedRef.current?.focus());
      });
    } else if (mode === "another") {
      resetAll();
      showSuccessMessage(handoff.createdRecord
        ? `"${handoff.label}" created. Ready for the next item.`
        : `"${handoff.label}" stock updated. Ready for the next item.`);
      requestAnimationFrame(() => {
        serializedRef.current?.focus();
      });
    } else {
      onOpenChange(false);
      resetAll();
      if (mode === "open") {
        router.push(handoff.href);
      }
    }
  }

  async function persistCreatedImage(endpoint: string) {
    if (!imageDraft) {
      return { imageStatus: "none" as const, imageError: "" };
    }

    try {
      await persistDraftItemImage(endpoint, imageDraft);
      return { imageStatus: "saved" as const, imageError: "" };
    } catch (imageError) {
      return {
        imageStatus: "failed" as const,
        imageError: imageError instanceof Error
          ? imageError.message
          : "The item was created, but its image could not be saved.",
      };
    }
  }

  async function retryCreatedImage() {
    if (!createdHandoff || !imageDraft || imageRetrying) return;
    const batchEndpoints = createdHandoff.failedImageEndpoints ?? [];
    if (batchEndpoints.length === 0 && !createdHandoff.imageEndpoint) return;
    setImageRetrying(true);
    if (batchEndpoints.length === 0 && createdHandoff.imageEndpoint) {
      const imageResult = await persistCreatedImage(createdHandoff.imageEndpoint);
      setCreatedHandoff((current) => current
        ? { ...current, ...imageResult }
        : current);
    } else {
      const failedEndpoints: string[] = [];
      let firstError = "";
      for (const endpoint of batchEndpoints) {
        const result = await persistCreatedImage(endpoint);
        if (result.imageStatus === "failed") {
          failedEndpoints.push(endpoint);
          firstError ||= result.imageError;
        }
      }
      setCreatedHandoff((current) => current
        ? {
            ...current,
            failedImageEndpoints: failedEndpoints,
            imageStatus: failedEndpoints.length === 0 ? "saved" : "failed",
            imageError: failedEndpoints.length === 0
              ? ""
              : `${failedEndpoints.length} ${failedEndpoints.length === 1 ? "image still needs" : "images still need"} attention. ${firstError}`,
          }
        : current);
    }
    setImageRetrying(false);
  }

  async function submitSerializedBatch(
    entries: SerializedSubmitEntry[],
    repeatTemplate: SerializedIntakeTemplate,
  ) {
    const created: Array<{ id: string | null; assetTag: string; imageEndpoint: string | null }> = [];
    const failures: SerializedBatchFailure[] = [];

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      setSubmissionProgress({ phase: "records", current: index + 1, total: entries.length });

      let res: globalThis.Response;
      try {
        res = await fetch("/api/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry.body),
        });
      } catch {
        const message = "The request could not reach the server. Check your connection and try again.";
        for (const remaining of entries.slice(index)) {
          failures.push({
            unitKey: remaining.unit.key,
            assetTag: remaining.unit.assetTag,
            message,
            fieldId: serializedUnitFieldId(remaining.unit, "asset-tag"),
          });
        }
        break;
      }

      if (handleAuthRedirect(res)) {
        const unfinishedKeys = [
          ...failures.map((failure) => failure.unitKey),
          ...entries.slice(index).map((remaining) => remaining.unit.key),
        ];
        serializedRef.current?.retainUnits(unfinishedKeys);
        setSerializedUnitCount(unfinishedKeys.length);
        if (created.length > 0) onCreated();
        return;
      }

      if (!res.ok) {
        const message = await parseErrorMessage(res, "Failed to create this item. Please try again.");
        failures.push({
          unitKey: entry.unit.key,
          assetTag: entry.unit.assetTag,
          message,
          fieldId: batchFailureFieldId(entry, message),
        });
        continue;
      }

      const json = await parseJsonSafely<ItemCreateResponse>(res);
      const createdId = json?.data?.id;
      created.push({
        id: createdId ?? null,
        assetTag: entry.unit.assetTag,
        imageEndpoint: imageDraft && createdId ? `/api/assets/${createdId}/image` : null,
      });
    }

    if (failures.length > 0) {
      serializedRef.current?.retainUnits(failures.map((failure) => failure.unitKey));
      setSerializedUnitCount(failures.length);
    }

    if (created.length === 0) {
      setDirty(true);
      const firstFailure = failures[0];
      if (firstFailure) {
        showFormError(
          `${failures.length} ${failures.length === 1 ? "item needs" : "items need"} attention. ${firstFailure.assetTag}: ${firstFailure.message}`,
          firstFailure.fieldId,
        );
      } else {
        showFormError("No items were created. Review the unit identities and try again.");
        requestAnimationFrame(() => serializedRef.current?.focus());
      }
      return;
    }

    const failedImageEndpoints: string[] = [];
    let firstImageError = "";
    const imageEndpoints = [
      ...deferredImageEndpoints,
      ...created.flatMap((createdItem) => createdItem.imageEndpoint ? [createdItem.imageEndpoint] : []),
    ];
    if (imageDraft) {
      for (let index = 0; index < imageEndpoints.length; index += 1) {
        const endpoint = imageEndpoints[index]!;
        setSubmissionProgress({ phase: "images", current: index + 1, total: imageEndpoints.length });
        const imageResult = await persistCreatedImage(endpoint);
        if (imageResult.imageStatus === "failed") {
          failedImageEndpoints.push(endpoint);
          firstImageError ||= imageResult.imageError;
        }
      }
    }
    setDeferredImageEndpoints([]);
    setBatchContinuationTemplate(null);

    const productLabel = repeatTemplate.productLabel || created[0]!.assetTag || "Item";
    const firstLinkedItem = created.find((item) => item.id);
    const allRecordsCreated = failures.length === 0;
    const imageStatus: ImageStatus = !imageDraft || imageEndpoints.length === 0
      ? "none"
      : failedImageEndpoints.length > 0
        ? "failed"
        : "saved";
    setCreatedHandoff({
      kind: "standard",
      label: productLabel,
      heading: `${created.length} ${productLabel} ${created.length === 1 ? "item is" : "items are"} ready`,
      href: firstLinkedItem?.id ? `/items/${firstLinkedItem.id}` : "/items",
      openLabel: firstLinkedItem ? "Open first item" : "Open item list",
      successMessage: allRecordsCreated
        ? `All ${created.length} physical items were created successfully.`
        : `${created.length} created successfully; ${failures.length} ${failures.length === 1 ? "item needs" : "items need"} attention.`,
      description: allRecordsCreated
        ? "Review the first item, add another matching shipment, or return to the refreshed list."
        : "Fix only the unfinished rows. The items already created will not be submitted again.",
      createdRecord: true,
      imageEndpoint: null,
      failedImageEndpoints,
      imageStatus,
      imageError: failedImageEndpoints.length > 0
        ? `${failedImageEndpoints.length} of ${imageEndpoints.length} ${failedImageEndpoints.length === 1 ? "image needs" : "images need"} attention. ${firstImageError}`
        : "",
      repeatTemplate: allRecordsCreated ? repeatTemplate : undefined,
      continuationTemplate: repeatTemplate,
      batch: {
        attempted: entries.length,
        created: created.length,
        failures,
      },
    });
    setDirty(!allRecordsCreated);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    if (submittingRef.current) return;

    try {
      let res: globalThis.Response;
      let label = "";
      let bulkHandoffHref: string | null = null;
      let bulkHandoffLabel = "Open item";
      let createsCatalogRecord = true;
      let repeatTemplate: SerializedIntakeTemplate | undefined;

      if (kind === "standard") {
        const validationIssue = serializedRef.current?.validate();
        if (validationIssue) {
          focusValidationIssue(validationIssue);
          return;
        }
        const entries = serializedRef.current!.getSubmitEntries();
        repeatTemplate = batchContinuationTemplate ?? serializedRef.current!.getRepeatTemplate();
        if (entries.length > 1 || batchContinuationTemplate || deferredImageEndpoints.length > 0) {
          setSubmitting(true);
          submittingRef.current = true;
          await submitSerializedBatch(entries, repeatTemplate);
          return;
        }
        const body = entries[0]!.body;
        label = (body.assetTag as string) || (body.name as string) || "Asset";

        setSubmitting(true);
        submittingRef.current = true;
        res = await fetch("/api/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        const validationIssue = bulkRef.current?.validate();
        if (validationIssue) {
          focusValidationIssue(validationIssue);
          return;
        }
        const payload = bulkRef.current!.getSubmitPayload();
        if (!payload) return;
        label = payload.label;
        bulkHandoffHref = payload.handoffHref ?? null;
        bulkHandoffLabel = payload.openLabel ?? bulkHandoffLabel;
        createsCatalogRecord = payload.createsCatalogRecord;

        setSubmitting(true);
        submittingRef.current = true;
        res = await fetch(payload.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload.body),
        });
      }

      if (handleAuthRedirect(res)) return;

      if (!res.ok) {
        const message = await parseErrorMessage(res, bulkOperation === "adjust"
          ? "Failed to add stock. Please try again."
          : "Failed to create item. Please try again.");
        const conflictFieldId = kind === "standard"
          ? message.startsWith("Asset tag")
            ? "new-item-asset-tag"
            : message.startsWith("Serial number")
              ? "new-item-serial-number"
              : message.startsWith("QR code")
                ? "new-item-qr-code"
                : undefined
          : undefined;
        showFormError(message, conflictFieldId);
        return;
      }

      const json = await parseJsonSafely<ItemCreateResponse>(res);

      const createdId = json?.data?.id;
      const handoffHref = createsCatalogRecord
        ? createdId
          ? kind === "standard"
            ? `/items/${createdId}`
            : `/items/bulk-${createdId}`
          : null
        : bulkHandoffHref;
      if (!handoffHref) {
        onCreated();
        setDirty(false);
        showFormError(
          `The item was ${createsCatalogRecord ? "created" : "updated"}, but its item link is unavailable. Refresh the list before continuing.`,
        );
        return;
      }

      const imageEndpoint = imageDraft && createsCatalogRecord && createdId
        ? kind === "standard"
          ? `/api/assets/${createdId}/image`
          : `/api/bulk-skus/${createdId}/image`
        : null;
      const imageResult = imageEndpoint
        ? await persistCreatedImage(imageEndpoint)
        : { imageStatus: "none" as const, imageError: "" };
      setCreatedHandoff({
        kind,
        label,
        href: handoffHref,
        openLabel: bulkHandoffLabel,
        successMessage: payloadSuccessMessage(label, createsCatalogRecord),
        description: kind === "standard"
          ? "Open the item to review its identity, booking policy, and activity."
          : kind === "units"
            ? "Open the item to review availability, numbered units, thresholds, and activity."
            : createsCatalogRecord
              ? "Open the item to review availability, stock, thresholds, and activity."
              : "Open the item to review the updated stock and activity.",
        createdRecord: createsCatalogRecord,
        imageEndpoint,
        repeatTemplate,
        ...imageResult,
      });
      setDirty(false);
    } catch {
      showFormError("You are offline or the request could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
      setSubmissionProgress(null);
    }
  }

  // Every creation path ends in the same explicit handoff.
  const showPostCreate = !!createdHandoff;

  const selectedKind = optionForKind(kind);
  const SelectedKindIcon = selectedKind.icon;
  const singleSubmitLabel = kind === "quantity" && bulkOperation === "adjust" ? "Add stock" : "Create item";
  const submitLabel = kind === "standard" && serializedUnitCount > 1
    ? `Create ${serializedUnitCount} items`
    : singleSubmitLabel;
  const requiredComplete = requiredProgress.completed === requiredProgress.total;

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            onOpenChange(true);
            return;
          }
          requestClose();
        }}
      >
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Add item</SheetTitle>
          <SheetDescription>
            Create a serialized item, numbered item family, or quantity-tracked stock record.
          </SheetDescription>
        </SheetHeader>

        <SheetBody ref={sheetBodyRef} className="px-4 py-5 sm:px-6 sm:py-6">
          {showPostCreate ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-md border border-border/60 bg-background p-5 shadow-xs">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[var(--green-bg)] text-[var(--green-text)]">
                    <CheckCircle2Icon className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <Badge variant={optionForKind(createdHandoff?.kind ?? kind).badgeVariant} size="sm">
                      {optionForKind(createdHandoff?.kind ?? kind).badge}
                    </Badge>
                    <h3 className="mt-2 text-lg font-semibold tracking-tight text-balance">
                      {createdHandoff?.heading ?? `${createdHandoff?.label ?? "Item"} is ready`}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {createdHandoff?.successMessage ?? "Saved successfully."}
                    </p>
                  </div>
                </div>

                <div className="mt-5 divide-y divide-border/70 border-y border-border/70">
                  <SummaryRow label="Status">
                    <Badge variant="gray" size="sm">
                      {createdHandoff?.batch
                        ? `${createdHandoff.batch.created} created`
                        : createdHandoff?.createdRecord ? "Created" : "Stock updated"}
                    </Badge>
                  </SummaryRow>
                  <SummaryRow label="Tracking">
                    {optionForKind(createdHandoff?.kind ?? kind).title}
                  </SummaryRow>
                  {createdHandoff?.batch && (
                    <SummaryRow label="Batch">
                      {createdHandoff.batch.failures.length === 0
                        ? `${createdHandoff.batch.created} of ${createdHandoff.batch.attempted} complete`
                        : `${createdHandoff.batch.created} complete, ${createdHandoff.batch.failures.length} unfinished`}
                    </SummaryRow>
                  )}
                  {createdHandoff?.imageStatus !== "none" && (
                    <SummaryRow label="Image">
                      <Badge
                        variant={createdHandoff.imageStatus === "saved" ? "blue" : "red"}
                        size="sm"
                      >
                        {createdHandoff.imageStatus === "saved" ? "Saved" : "Needs attention"}
                      </Badge>
                    </SummaryRow>
                  )}
                  <SummaryRow label="Next">
                    <span className="text-muted-foreground">{createdHandoff?.description}</span>
                  </SummaryRow>
                </div>
              </div>

              {createdHandoff?.batch && createdHandoff.batch.failures.length > 0 && (
                <Alert className="border-[var(--orange)]/30 bg-[var(--orange-bg)] text-[var(--orange-text)]">
                  <AlertCircleIcon className="size-4" />
                  <AlertTitle>{createdHandoff.batch.failures.length} {createdHandoff.batch.failures.length === 1 ? "item needs" : "items need"} attention</AlertTitle>
                  <AlertDescription>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {createdHandoff.batch.failures.slice(0, 5).map((failure) => (
                        <li key={failure.unitKey}>
                          <span className="font-medium">{failure.assetTag}</span>: {failure.message}
                        </li>
                      ))}
                    </ul>
                    {createdHandoff.batch.failures.length > 5 && (
                      <p className="mt-2">And {createdHandoff.batch.failures.length - 5} more unfinished items.</p>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {createdHandoff?.imageStatus === "failed" && (
                <Alert variant="destructive">
                  <AlertCircleIcon className="size-4" />
                  <AlertDescription className="flex flex-col items-start gap-3">
                    <span>
                      {createdHandoff.batch ? "Items created, but their images need attention." : "Item created, but its image needs attention."} {createdHandoff.imageError}
                    </span>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10"
                    loading={imageRetrying}
                    onClick={retryCreatedImage}
                  >
                    Retry image
                  </Button>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          ) : (
            <form id="new-item-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
              {/* ── Tracking style ── */}
              <section className="flex flex-col gap-3">
                <SectionHeading>Tracking style</SectionHeading>
                <RadioGroup
                  className="grid grid-cols-3 gap-2"
                  name="item-kind"
                  value={kind}
                  onValueChange={(value) => {
                    const nextKind = value as ItemKind;
                    if (nextKind === kind) return;
                    sourceLoadRef.current += 1;
                    markInteraction();
                    setError("");
                    setSerializedTemplate(null);
                    setSourceLoading(false);
                    setSourceLoadError("");
                    setImageDraft(null);
                    setRequiredProgress({ completed: 0, total: 4 });
                    setSerializedUnitCount(1);
                    setSubmissionProgress(null);
                    setDeferredImageEndpoints([]);
                    setBatchContinuationTemplate(null);
                    setBulkOperation("create");
                    setKind(nextKind);
                    requestAnimationFrame(() => {
                      requestAnimationFrame(() => {
                        if (nextKind === "standard") serializedRef.current?.focus();
                        else bulkRef.current?.focus();
                      });
                    });
                  }}
                  disabled={submitting || sourceLoading}
                >
                  {KIND_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const selected = kind === option.kind;
                    return (
                      <label
                        key={option.kind}
                        htmlFor={option.id}
                        className={cn(
                          "flex min-h-24 min-w-0 cursor-pointer flex-col gap-2 rounded-xl border px-3 py-3 shadow-xs transition-[background-color,border-color,box-shadow]",
                          selected
                            ? "border-primary/55 bg-primary/5 shadow-[0_8px_24px_rgba(0,0,0,0.05)]"
                            : "border-border/55 bg-background hover:bg-muted/40",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div
                            className={cn(
                              "flex size-8 shrink-0 items-center justify-center rounded-md",
                              selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                            )}
                          >
                            <Icon className="size-4" />
                          </div>
                          <RadioGroupItem value={option.kind} id={option.id} />
                        </div>
                        <div className="min-w-0">
                          <span className="block text-sm font-semibold">{option.title}</span>
                          <Badge variant={option.badgeVariant} size="sm" className="mt-1 max-w-full whitespace-normal text-center leading-tight">
                            {option.badge}
                          </Badge>
                          <span className="sr-only">. {option.description}</span>
                        </div>
                      </label>
                    );
                  })}
                </RadioGroup>
                <div className="flex items-start gap-2 rounded-md border border-border/50 bg-muted/25 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                  <SelectedKindIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <p>
                    <span className="font-medium text-foreground">{selectedKind.description}</span>{" "}
                    {selectedKind.outcome}
                  </p>
                </div>
              </section>

              {successMsg && <SuccessFlash message={successMsg} />}

              {error && (
                <Alert id="new-item-form-error" variant="destructive" role="alert">
                  <AlertCircleIcon className="size-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {kind === "standard" ? sourceLoading ? (
                <Alert aria-live="polite">
                  <CopyPlusIcon className="size-4" />
                  <AlertTitle>Loading product details</AlertTitle>
                  <AlertDescription>
                    Reusing the source item&apos;s product, category, location, image, and workflow defaults.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  {sourceLoadError && (
                    <Alert variant="destructive">
                      <AlertCircleIcon className="size-4" />
                      <AlertTitle>Could not reuse this item</AlertTitle>
                      <AlertDescription className="flex flex-col items-start gap-3">
                        <span>{sourceLoadError} No new item was created.</span>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" className="h-10" onClick={() => setSourceLoadVersion((version) => version + 1)}>
                            Retry source
                          </Button>
                          <Button type="button" variant="outline" className="h-10" onClick={startBlankSerializedItem}>
                            Start blank
                          </Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}

                  {serializedTemplate && (
                    <Alert className="border-[var(--blue)]/25 bg-[var(--blue-bg)] text-[var(--blue-text)]">
                      <CopyPlusIcon className="size-4" />
                      <AlertTitle>
                        {serializedUnitCount > 1
                          ? `Adding ${serializedUnitCount} ${serializedTemplate.productLabel} items`
                          : `Adding another ${serializedTemplate.productLabel}`}
                      </AlertTitle>
                      <AlertDescription className="flex flex-col items-start gap-3">
                        <span>
                          Product details, category, location, image, link, and workflow settings came from {serializedTemplate.sourceLabel}. Serial, QR, campus tag, purchase, warranty, fiscal year, and notes are new for {serializedUnitCount > 1 ? "this shipment" : "this item"}.
                        </span>
                        <Button type="button" variant="outline" className="h-10" onClick={startBlankSerializedItem}>
                          Start a different item
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}

                  <SerializedItemForm
                    ref={serializedRef}
                    categories={categories}
                    departments={departments}
                    locations={locations}
                    image={imageDraft}
                    template={serializedTemplate}
                    onChooseImage={(searchQuery) => {
                      setImageSearchQuery(searchQuery);
                      setShowImageModal(true);
                    }}
                    onClearImage={() => {
                      setImageDraft(null);
                      markInteraction();
                    }}
                    onProgressChange={setRequiredProgress}
                    onUnitCountChange={setSerializedUnitCount}
                    onInteract={markInteraction}
                    disabled={submitting}
                  />
                </>
              ) : (
                <BulkItemForm
                  ref={bulkRef}
                  categories={categories}
                  locations={locations}
                  open={open}
                  trackingMode={kind}
                  image={imageDraft}
                  onChooseImage={(searchQuery) => {
                    setImageSearchQuery(searchQuery);
                    setShowImageModal(true);
                  }}
                  onClearImage={() => {
                    setImageDraft(null);
                    markInteraction();
                  }}
                  onProgressChange={setRequiredProgress}
                  onOperationChange={setBulkOperation}
                  onInteract={markInteraction}
                  disabled={submitting}
                />
              )}
            </form>
          )}
        </SheetBody>

        <SheetFooter className="flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {showPostCreate ? (
            <>
              <div className="flex-1" />
              <Button
                variant="outline"
                type="button"
                className="h-10"
                onClick={() => finishCreatedHandoff("list")}
              >
                Return to list
              </Button>
              {createdHandoff && (
                <Button
                  variant="outline"
                  type="button"
                  className="h-10"
                  onClick={() => finishCreatedHandoff("open")}
                >
                  {createdHandoff.openLabel}
                </Button>
              )}
              {createdHandoff?.batch?.failures.length ? (
                <Button
                  type="button"
                  className="h-10"
                  onClick={() => finishCreatedHandoff("remaining")}
                >
                  Fix {createdHandoff.batch.failures.length} remaining
                </Button>
              ) : (
                <>
                  {createdHandoff?.repeatTemplate && (
                    <Button
                      variant="outline"
                      type="button"
                      className="h-10"
                      onClick={() => finishCreatedHandoff("another")}
                    >
                      Add different item
                    </Button>
                  )}
                  <Button
                    type="button"
                    className="h-10"
                    onClick={() => finishCreatedHandoff(createdHandoff?.repeatTemplate ? "similar" : "another")}
                  >
                    {createdHandoff?.repeatTemplate
                      ? createdHandoff.batch ? "Add another shipment" : "Add another like this"
                      : "Add another item"}
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <div className="flex-1 text-xs text-muted-foreground sm:mr-auto">
                {submissionProgress
                  ? submissionProgress.phase === "records"
                    ? `Creating item ${submissionProgress.current} of ${submissionProgress.total}`
                    : `Saving image ${submissionProgress.current} of ${submissionProgress.total}`
                  : requiredComplete
                    ? "Required fields complete"
                    : `${requiredProgress.completed} of ${requiredProgress.total} required fields complete`}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:contents">
                <Button className="h-10" variant="outline" type="button" disabled={submitting} onClick={requestClose}>
                  Cancel
                </Button>
                <Button className="h-10" type="submit" form="new-item-form" loading={submitting} disabled={sourceLoading}>
                  {submitLabel}
                </Button>
              </div>
            </>
          )}
        </SheetFooter>
      </SheetContent>

      </Sheet>

      <ChooseImageModal
        mode="draft"
        open={showImageModal}
        onClose={() => setShowImageModal(false)}
        initialSelection={imageDraft}
        searchQuery={imageSearchQuery}
        onDraftChanged={(selection) => {
          setImageDraft(selection);
          markInteraction();
        }}
      />

      <AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this item?</AlertDialogTitle>
            <AlertDialogDescription>
              The item has not been created. Closing now will clear the fields and any staged image.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10">Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="h-10"
              onClick={closeAndReset}
            >
              Discard item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
