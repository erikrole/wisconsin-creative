"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AlertCircleIcon, Dices } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import type {
  BulkMode,
  FormValidationIssue,
  Location,
  RequiredFieldProgress,
} from "./types";
import type { CategoryOption } from "@/types/category";
import { generateQrCode } from "./helpers";
import { FormFieldError, FormRow } from "@/components/form-layout";
import {
  FormCombobox,
  CategoryCombobox,
  BulkSkuCombobox,
  type BulkSkuOption,
} from "@/components/FormCombobox";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { MAX_BULK_QUANTITY_PER_LINE, MAX_NUMBERED_UNITS_PER_CREATE } from "@/lib/request-limits";
import { OperationalLoadingState } from "@/components/OperationalLoadingState";
import { FormSection } from "./FormSection";
import { ItemImageDraftField } from "./ItemImageDraftField";
import type { DraftItemImage } from "@/lib/item-image-draft";

export interface BulkFormHandle {
  validate(): FormValidationIssue | null;
  getSubmitPayload(): {
    url: string;
    body: Record<string, unknown>;
    label: string;
    createsCatalogRecord: boolean;
    handoffHref?: string;
    openLabel?: string;
  } | null;
  reset(): void;
  focus(): void;
  focusField(fieldId: string): void;
}

interface Props {
  categories: CategoryOption[];
  locations: Location[];
  open: boolean;
  trackingMode: "units" | "quantity";
  image: DraftItemImage | null;
  onChooseImage: (searchQuery: string) => void;
  onClearImage: () => void;
  onProgressChange: (progress: RequiredFieldProgress) => void;
  onOperationChange: (operation: "create" | "adjust") => void;
  onInteract: () => void;
  disabled?: boolean;
}

type BulkSkuListResponse = {
  data?: BulkSkuOption[];
};

type ExistingItemsState = "idle" | "loading" | "ready" | "error";

export const BulkItemForm = forwardRef<BulkFormHandle, Props>(
  function BulkItemForm({
    categories,
    locations,
    open,
    trackingMode,
    image,
    onChooseImage,
    onClearImage,
    onProgressChange,
    onOperationChange,
    onInteract,
    disabled = false,
  }, ref) {
    const [bulkMode, setBulkMode] = useState<BulkMode>("new");
    const [bulkName, setBulkName] = useState("");
    const [categoryId, setCategoryId] = useState("");
    const [locationId, setLocationId] = useState("");
    const [bulkQrCode, setBulkQrCode] = useState("");
    const [initialQuantity, setInitialQuantity] = useState("0");
    const [imageOpen, setImageOpen] = useState(false);

    const [existingBulkSkus, setExistingBulkSkus] = useState<BulkSkuOption[]>([]);
    const [existingItemsState, setExistingItemsState] = useState<ExistingItemsState>("idle");
    const [existingItemsError, setExistingItemsError] = useState("");
    const [existingItemsReload, setExistingItemsReload] = useState(0);
    const [selectedBulkSkuId, setSelectedBulkSkuId] = useState("");
    const [addQty, setAddQty] = useState("1");
    const [validationAttempted, setValidationAttempted] = useState(false);

    const bulkNameInputRef = useRef<HTMLInputElement>(null);
    const locationOptions = locations.map((location) => ({ value: location.id, label: location.name }));
    const quantityOnlyBulkSkus = existingBulkSkus.filter((sku) => !sku.trackByNumber);

    useEffect(() => {
      if (!open || trackingMode !== "quantity") return;
      const controller = new AbortController();
      setExistingItemsState("loading");
      setExistingItemsError("");
      (async () => {
        try {
          const res = await fetch("/api/bulk-skus?limit=200", { signal: controller.signal });
          if (handleAuthRedirect(res)) return;
          if (!res.ok) {
            const message = await parseErrorMessage(res, "Count-tracked items could not load.");
            if (!controller.signal.aborted) {
              setExistingItemsState("error");
              setExistingItemsError(message);
            }
            return;
          }
          const json = await parseJsonSafely<BulkSkuListResponse>(res);
          if (!controller.signal.aborted) {
            if (!json || !Array.isArray(json.data)) {
              setExistingItemsState("error");
              setExistingItemsError("Count-tracked items returned an unreadable response. Retry before adding stock.");
              return;
            }
            setExistingBulkSkus(json.data);
            setExistingItemsState("ready");
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            setExistingItemsState("error");
            setExistingItemsError(error instanceof Error && error.name === "AbortError"
              ? ""
              : "Count-tracked items could not load. Check your connection and retry.");
          }
        }
      })();
      return () => controller.abort();
    }, [existingItemsReload, open, trackingMode]);

    useEffect(() => {
      if (trackingMode === "units") setBulkMode("new");
    }, [trackingMode]);

    useEffect(() => {
      onOperationChange(bulkMode === "existing" ? "adjust" : "create");
      if (bulkMode === "existing") {
        onProgressChange({
          completed: [
            Boolean(selectedBulkSkuId),
            Number.isInteger(Number(addQty))
              && Number(addQty) >= 1
              && Number(addQty) <= MAX_BULK_QUANTITY_PER_LINE,
          ].filter(Boolean).length,
          total: 2,
        });
        return;
      }
      onProgressChange({
        completed: [bulkName.trim(), categoryId, locationId, bulkQrCode.trim()].filter(Boolean).length,
        total: 4,
      });
    }, [addQty, bulkMode, bulkName, bulkQrCode, categoryId, locationId, onOperationChange, onProgressChange, selectedBulkSkuId]);

    const nameMissing = validationAttempted && bulkMode === "new" && !bulkName.trim();
    const categoryMissing = validationAttempted && bulkMode === "new" && !categoryId;
    const locationMissing = validationAttempted && bulkMode === "new" && !locationId;
    const qrCodeMissing = validationAttempted && bulkMode === "new" && !bulkQrCode.trim();
    const selectedItemMissing = validationAttempted && bulkMode === "existing" && !selectedBulkSkuId;
    const parsedAddQuantity = Number(addQty);
    const addQuantityInvalid = validationAttempted
      && bulkMode === "existing"
      && (!Number.isInteger(parsedAddQuantity)
        || parsedAddQuantity < 1
        || parsedAddQuantity > MAX_BULK_QUANTITY_PER_LINE);
    const parsedInitialQuantity = Number(initialQuantity);
    const initialQuantityMax = trackingMode === "units"
      ? MAX_NUMBERED_UNITS_PER_CREATE
      : MAX_BULK_QUANTITY_PER_LINE;
    const initialQuantityInvalid = validationAttempted
      && bulkMode === "new"
      && (!Number.isInteger(parsedInitialQuantity)
        || parsedInitialQuantity < 0
        || parsedInitialQuantity > initialQuantityMax);

    function focusField(fieldId: string) {
      requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
    }

    useImperativeHandle(ref, () => ({
      validate() {
        setValidationAttempted(true);
        if (bulkMode === "new") {
          if (!bulkName.trim()) return { message: "Enter an item name to continue.", fieldId: "new-bulk-item-name" };
          if (!categoryId) return { message: "Select a category to continue.", fieldId: "new-bulk-item-category" };
          if (!locationId) return { message: "Select a location to continue.", fieldId: "new-bulk-item-location" };
          if (!bulkQrCode.trim()) return { message: "Enter or generate a QR code to continue.", fieldId: "new-bulk-item-qr-code" };
          if (!Number.isInteger(parsedInitialQuantity) || parsedInitialQuantity < 0) {
            return { message: "Initial quantity must be a whole number of zero or more.", fieldId: "new-bulk-item-initial-quantity" };
          }
          if (parsedInitialQuantity > initialQuantityMax) {
            return {
              message: trackingMode === "units"
                ? `Create at most ${MAX_NUMBERED_UNITS_PER_CREATE} numbered units at once.`
                : `Initial quantity cannot exceed ${MAX_BULK_QUANTITY_PER_LINE.toLocaleString()}.`,
              fieldId: "new-bulk-item-initial-quantity",
            };
          }
        } else {
          if (existingItemsState === "loading") {
            return { message: "Wait for count-tracked items to finish loading.", fieldId: "existing-bulk-item" };
          }
          if (existingItemsState === "error") {
            return { message: "Retry count-tracked items before adding stock.", fieldId: "retry-existing-bulk-items" };
          }
          if (quantityOnlyBulkSkus.length === 0) {
            return { message: "No active count-tracked items are available. Choose Create new item.", fieldId: "bulk-new" };
          }
          if (!selectedBulkSkuId) return { message: "Select an item to continue.", fieldId: "existing-bulk-item" };
          if (!Number.isInteger(parsedAddQuantity) || parsedAddQuantity < 1) {
            return { message: "Quantity received must be a whole number of at least 1.", fieldId: "existing-bulk-item-add-quantity" };
          }
          if (parsedAddQuantity > MAX_BULK_QUANTITY_PER_LINE) {
            return {
              message: `Quantity received cannot exceed ${MAX_BULK_QUANTITY_PER_LINE.toLocaleString()}.`,
              fieldId: "existing-bulk-item-add-quantity",
            };
          }
        }
        return null;
      },
      getSubmitPayload() {
        if (bulkMode === "existing") {
          const sku = quantityOnlyBulkSkus.find((item) => item.id === selectedBulkSkuId);
          return {
            url: `/api/bulk-skus/${selectedBulkSkuId}/adjust`,
            body: { quantityDelta: parsedAddQuantity, reason: "Added through Add item" },
            label: sku?.name || "Item",
            createsCatalogRecord: false,
            handoffHref: `/items/bulk-${selectedBulkSkuId}`,
            openLabel: "Open item",
          };
        }
        const selectedCategory = categories.find((category) => category.id === categoryId);
        return {
          url: "/api/bulk-skus",
          body: {
            name: bulkName.trim(),
            category: selectedCategory?.name ?? "Uncategorized",
            ...(categoryId ? { categoryId } : {}),
            locationId,
            binQrCodeValue: bulkQrCode.trim(),
            initialQuantity: parsedInitialQuantity,
            trackByNumber: trackingMode === "units",
          },
          label: bulkName.trim() || "Item",
          createsCatalogRecord: true,
          openLabel: "Open item",
        };
      },
      reset() {
        setBulkMode("new");
        setBulkName("");
        setCategoryId("");
        setLocationId("");
        setBulkQrCode("");
        setInitialQuantity("0");
        setSelectedBulkSkuId("");
        setAddQty("1");
        setImageOpen(false);
        setValidationAttempted(false);
      },
      focus() {
        bulkNameInputRef.current?.focus();
      },
      focusField,
    }));

    return (
      <fieldset disabled={disabled} className="contents" onInputCapture={onInteract}>
        {trackingMode === "quantity" && (
          <FormSection
            title="Stock action"
            badge={bulkMode === "new" ? "Create new" : "Add stock"}
            badgeVariant={bulkMode === "new" ? "green" : "orange"}
            description="Create a count-tracked record or increase stock for an existing one."
          >
            <RadioGroup
              name="bulk-mode"
              value={bulkMode}
              onValueChange={(value) => {
                const nextMode = value as BulkMode;
                onInteract();
                setValidationAttempted(false);
                setBulkMode(nextMode);
                if (nextMode === "existing") {
                  onClearImage();
                }
              }}
              disabled={disabled}
              className="grid gap-2 sm:grid-cols-2"
            >
              <Label htmlFor="bulk-new" className="min-h-16 cursor-pointer items-start gap-3 rounded-md border border-border/60 p-3 has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5">
                <RadioGroupItem value="new" id="bulk-new" className="mt-0.5" />
                <span>
                  <span className="block font-medium">Create new item</span>
                  <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">Start one new count-tracked catalog row.</span>
                </span>
              </Label>
              <Label htmlFor="bulk-existing" className="min-h-16 cursor-pointer items-start gap-3 rounded-md border border-border/60 p-3 has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5">
                <RadioGroupItem value="existing" id="bulk-existing" className="mt-0.5" />
                <span>
                  <span className="block font-medium">Add to existing</span>
                  <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">Record an incoming shipment.</span>
                </span>
              </Label>
            </RadioGroup>
          </FormSection>
        )}

        {bulkMode === "new" ? (
          <>
            <FormSection
              title="Essentials"
              badge={trackingMode === "units" ? "Numbered family" : "Count stock"}
              badgeVariant={trackingMode === "units" ? "purple" : "green"}
              description={trackingMode === "units"
                ? "Name, category, location, and family QR create one catalog row with numbered units beneath it."
                : "Name, category, location, and stock QR create one count-tracked catalog row."}
            >
              <FormRow label="Item name" htmlFor="new-bulk-item-name" required>
                <Input
                  id="new-bulk-item-name"
                  name="bulkName"
                  ref={bulkNameInputRef}
                  value={bulkName}
                  onChange={(event) => setBulkName(event.target.value)}
                  placeholder={trackingMode === "units" ? "e.g. Sony BP-U70 Battery" : "e.g. Gaff Tape"}
                  autoComplete="off"
                  required
                  aria-invalid={nameMissing || undefined}
                  aria-describedby={nameMissing ? "new-bulk-item-name-error" : undefined}
                  className="h-10"
                />
                {nameMissing && <FormFieldError id="new-bulk-item-name-error">Item name is required.</FormFieldError>}
              </FormRow>

              <FormRow label="Category" htmlFor="new-bulk-item-category" required>
                <CategoryCombobox
                  id="new-bulk-item-category"
                  value={categoryId}
                  onValueChange={(value) => {
                    onInteract();
                    setCategoryId(value);
                  }}
                  categories={categories}
                  disabled={disabled}
                  triggerClassName="h-10"
                  ariaInvalid={categoryMissing}
                  ariaDescribedBy={categoryMissing ? "new-bulk-item-category-error" : undefined}
                />
                {categoryMissing && <FormFieldError id="new-bulk-item-category-error">Category is required.</FormFieldError>}
              </FormRow>

              <FormRow label="Location" htmlFor="new-bulk-item-location" required>
                <FormCombobox
                  id="new-bulk-item-location"
                  value={locationId}
                  onValueChange={(value) => {
                    onInteract();
                    setLocationId(value);
                  }}
                  options={locationOptions}
                  placeholder="Select a location"
                  searchPlaceholder="Search locations..."
                  emptyLabel="No location found."
                  disabled={disabled}
                  triggerClassName="h-10"
                  ariaInvalid={locationMissing}
                  ariaDescribedBy={locationMissing ? "new-bulk-item-location-error" : undefined}
                />
                {locationMissing && <FormFieldError id="new-bulk-item-location-error">Location is required.</FormFieldError>}
              </FormRow>

              <FormRow label={trackingMode === "units" ? "Family QR code" : "Stock QR code"} htmlFor="new-bulk-item-qr-code" required>
                <div className="flex gap-2">
                  <Input
                    id="new-bulk-item-qr-code"
                    name="bulkQrCode"
                    value={bulkQrCode}
                    onChange={(event) => setBulkQrCode(event.target.value)}
                    placeholder="Scan, enter, or generate a code"
                    autoComplete="off"
                    required
                    aria-invalid={qrCodeMissing || undefined}
                    aria-describedby={qrCodeMissing ? "new-bulk-item-qr-code-error" : undefined}
                    className="h-10 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-10"
                    title="Generate QR code"
                    aria-label="Generate QR code"
                    onClick={() => {
                      onInteract();
                      setBulkQrCode(generateQrCode());
                    }}
                    disabled={disabled}
                  >
                    <Dices className="size-4" />
                  </Button>
                </div>
                {qrCodeMissing && <FormFieldError id="new-bulk-item-qr-code-error">QR code is required.</FormFieldError>}
              </FormRow>

              <FormRow label={trackingMode === "units" ? "Initial units" : "Initial quantity"} htmlFor="new-bulk-item-initial-quantity">
                <Input
                  id="new-bulk-item-initial-quantity"
                  name="initialQuantity"
                  value={initialQuantity}
                  onChange={(event) => setInitialQuantity(event.target.value)}
                  type="number"
                  min="0"
                  max={initialQuantityMax}
                  step="1"
                  autoComplete="off"
                  aria-invalid={initialQuantityInvalid || undefined}
                  aria-describedby={initialQuantityInvalid ? "new-bulk-item-initial-quantity-error" : undefined}
                  className="h-10"
                />
                {initialQuantityInvalid && (
                  <FormFieldError id="new-bulk-item-initial-quantity-error">
                    {trackingMode === "units"
                      ? `Enter a whole number from 0 to ${MAX_NUMBERED_UNITS_PER_CREATE}.`
                      : `Enter a whole number from 0 to ${MAX_BULK_QUANTITY_PER_LINE.toLocaleString()}.`}
                  </FormFieldError>
                )}
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {trackingMode === "units"
                    ? "Creates permanent unit numbers now; exact units bind during kiosk pickup and return."
                    : "Sets the starting stock count at this location."}
                </p>
              </FormRow>
            </FormSection>

            <FormSection
              title="Product image"
              badge={image ? "Selected" : "Optional"}
              badgeVariant={image ? "blue" : "secondary"}
              description="Search, paste a URL, or upload a file before creating the item."
              collapsible
              open={imageOpen}
              onOpenChange={setImageOpen}
            >
              <ItemImageDraftField
                image={image}
                disabled={disabled}
                onChoose={() => onChooseImage(bulkName)}
                onClear={onClearImage}
                embedded
              />
            </FormSection>
          </>
        ) : (
          <FormSection
            title="Add stock"
            badge="Existing item"
            badgeVariant="orange"
            description="Choose the count-tracked item and record how many units arrived."
          >
            {existingItemsState === "loading" ? (
              <OperationalLoadingState title="Loading count-tracked items" rows={2} className="px-0 py-1" />
            ) : existingItemsState === "error" ? (
              <Alert variant="destructive">
                <AlertCircleIcon className="size-4" />
                <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>{existingItemsError || "Count-tracked items could not load."}</span>
                  <Button
                    id="retry-existing-bulk-items"
                    type="button"
                    variant="outline"
                    className="h-10"
                    onClick={() => setExistingItemsReload((value) => value + 1)}
                  >
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : quantityOnlyBulkSkus.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active count-tracked items are available. Create one instead.</p>
            ) : (
              <>
                <FormRow label="Item" htmlFor="existing-bulk-item" required>
                  <BulkSkuCombobox
                    id="existing-bulk-item"
                    value={selectedBulkSkuId}
                    onValueChange={(value) => {
                      onInteract();
                      setSelectedBulkSkuId(value);
                    }}
                    skus={quantityOnlyBulkSkus}
                    triggerClassName="h-10"
                    ariaInvalid={selectedItemMissing}
                    ariaDescribedBy={selectedItemMissing ? "existing-bulk-item-error" : undefined}
                  />
                  {selectedItemMissing && <FormFieldError id="existing-bulk-item-error">Item is required.</FormFieldError>}
                </FormRow>

                {selectedBulkSkuId && (() => {
                  const sku = quantityOnlyBulkSkus.find((item) => item.id === selectedBulkSkuId);
                  if (!sku) return null;
                  const quantity = sku.balances.reduce((sum, balance) => sum + balance.onHandQuantity, 0);
                  return (
                    <div className="grid gap-2 rounded-md border bg-muted/30 px-4 py-3 text-sm sm:grid-cols-3">
                      <div>
                        <span className="block text-xs text-muted-foreground">Current stock</span>
                        <span className="font-medium tabular-nums">{quantity}</span>
                      </div>
                      <div>
                        <span className="block text-xs text-muted-foreground">Category</span>
                        <span>{sku.categoryRel?.name ?? "—"}</span>
                      </div>
                      <div>
                        <span className="block text-xs text-muted-foreground">Location</span>
                        <span>{sku.location.name}</span>
                      </div>
                    </div>
                  );
                })()}

                <FormRow label="Quantity received" htmlFor="existing-bulk-item-add-quantity" required>
                  <Input
                    id="existing-bulk-item-add-quantity"
                    name="addQuantity"
                    type="number"
                    min="1"
                    max={MAX_BULK_QUANTITY_PER_LINE}
                    step="1"
                    value={addQty}
                    onChange={(event) => setAddQty(event.target.value)}
                    autoComplete="off"
                    required
                    aria-invalid={addQuantityInvalid || undefined}
                    aria-describedby={addQuantityInvalid ? "existing-bulk-item-add-quantity-error" : undefined}
                    className="h-10"
                  />
                  {addQuantityInvalid && (
                    <FormFieldError id="existing-bulk-item-add-quantity-error">
                      Enter a whole number from 1 to {MAX_BULK_QUANTITY_PER_LINE.toLocaleString()}.
                    </FormFieldError>
                  )}
                </FormRow>
              </>
            )}
          </FormSection>
        )}
      </fieldset>
    );
  },
);
