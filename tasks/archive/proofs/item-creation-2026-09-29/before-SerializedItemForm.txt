"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ClipboardPaste, Dices, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import type {
  Department,
  FormValidationIssue,
  Location,
  ParentSearchResult,
  RequiredFieldProgress,
  SerializedIntakeTemplate,
} from "./types";
import type { CategoryOption } from "@/types/category";
import { generateQrCode, useParentSearch, FISCAL_YEARS } from "./helpers";
import { FormFieldError, FormRow, FormRow2Col } from "@/components/form-layout";
import { FormCombobox, CategoryCombobox } from "@/components/FormCombobox";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { buildSerializedItemSubmitBody, isValidUsdPriceInput } from "./serialized-submit";
import { FormSection } from "./FormSection";
import {
  getNextSequentialAssetTag,
  getRepeatTagBase,
  summarizeRepeatTags,
  type RepeatTagSummary,
} from "./repeat-tags";
import { ItemImageDraftField } from "./ItemImageDraftField";
import {
  buildItemImageSearchSeed,
  type DraftItemImage,
} from "@/lib/item-image-draft";
import {
  MAX_SERIALIZED_BATCH_SIZE,
  applyPastedSerialNumbers,
  countReadySerializedUnits,
  getSerializedUnitDraftErrors,
  parsePastedSerialNumbers,
  regenerateSerializedUnitTags,
  resizeSerializedUnitDrafts,
  serializedUnitFieldId,
  updateSerializedUnitAssetTag,
  validateSerializedUnitDrafts,
  type SerializedUnitDraft,
} from "./serialized-batch";

export type SerializedSubmitEntry = {
  unit: SerializedUnitDraft;
  body: Record<string, unknown>;
};

export interface SerializedFormHandle {
  validate(): FormValidationIssue | null;
  getSubmitBody(): Record<string, unknown>;
  getSubmitEntries(): SerializedSubmitEntry[];
  getRepeatTemplate(): SerializedIntakeTemplate;
  retainUnits(unitKeys: string[]): void;
  reset(): void;
  focus(): void;
  focusField(fieldId: string): void;
}

interface Props {
  categories: CategoryOption[];
  departments: Department[];
  locations: Location[];
  image: DraftItemImage | null;
  onChooseImage: (searchQuery: string) => void;
  onClearImage: () => void;
  onProgressChange: (progress: RequiredFieldProgress) => void;
  onUnitCountChange: (count: number) => void;
  onInteract: () => void;
  template?: SerializedIntakeTemplate | null;
  disabled?: boolean;
}

type AssetSearchResponse = {
  data?: Array<{
    assetTag?: string | null;
  }>;
};

const PRODUCT_DETAIL_FIELD_IDS = new Set([
  "new-item-name",
  "new-item-brand",
  "new-item-model",
  "new-item-serial-number",
  "new-item-department",
  "new-item-uw-asset-tag",
]);

const PROCUREMENT_FIELD_IDS = new Set([
  "new-item-purchase-date",
  "new-item-purchase-price",
  "new-item-warranty-date",
  "new-item-residual-value",
  "new-item-fiscal-year",
  "new-item-link-url",
  "new-item-notes",
]);

export const SerializedItemForm = forwardRef<SerializedFormHandle, Props>(
  function SerializedItemForm({
    categories,
    departments,
    locations,
    image,
    onChooseImage,
    onClearImage,
    onProgressChange,
    onUnitCountChange,
    onInteract,
    template = null,
    disabled = false,
  }, ref) {
    const [categoryId, setCategoryId] = useState("");
    const [locationId, setLocationId] = useState("");
    const [departmentId, setDepartmentId] = useState("");
    const [fiscalYear, setFiscalYear] = useState("");

    const [assetTag, setAssetTag] = useState("");
    const [itemName, setItemName] = useState("");
    const [brand, setBrand] = useState("");
    const [model, setModel] = useState("");
    const [serialNumber, setSerialNumber] = useState("");
    const [purchaseDate, setPurchaseDate] = useState("");
    const [purchasePrice, setPurchasePrice] = useState("");
    const [warrantyDate, setWarrantyDate] = useState("");
    const [residualValue, setResidualValue] = useState("");
    const [linkUrl, setLinkUrl] = useState("");
    const [uwAssetTag, setUwAssetTag] = useState("");
    const [userNotes, setUserNotes] = useState("");
    const [qrCodeValue, setQrCodeValue] = useState("");
    const [extraUnits, setExtraUnits] = useState<SerializedUnitDraft[]>([]);
    const [showSerialPaste, setShowSerialPaste] = useState(false);
    const [serialPasteValue, setSerialPasteValue] = useState("");
    const unitKeyRef = useRef(1);

    const [productDetailsOpen, setProductDetailsOpen] = useState(false);
    const [procurementOpen, setProcurementOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [validationAttempted, setValidationAttempted] = useState(false);

    const [assetTagError, setAssetTagError] = useState("");
    const [assetTagSummary, setAssetTagSummary] = useState<RepeatTagSummary | null>(null);
    const assetTagCheckRef = useRef(0);
    const assetTagInputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
      const trimmed = assetTag.trim();
      if (!trimmed) {
        setAssetTagError("");
        setAssetTagSummary(null);
        return;
      }

      const id = ++assetTagCheckRef.current;
      const debounce = setTimeout(async () => {
        const repeatBase = getRepeatTagBase(trimmed);
        try {
          const res = await fetch(`/api/assets?q=${encodeURIComponent(repeatBase)}&limit=200&include_accessories=true`);
          if (id !== assetTagCheckRef.current) return;
          if (handleAuthRedirect(res)) return;
          if (!res.ok) return;
          const data = await parseJsonSafely<AssetSearchResponse>(res);
          const match = data?.data?.some((asset) => asset.assetTag === trimmed);
          setAssetTagError(match ? "Asset tag already in use" : "");
          setAssetTagSummary(summarizeRepeatTags(trimmed, data?.data ?? []));
        } catch {
          // The create route remains authoritative when the advisory lookup is unavailable.
        }
      }, 160);

      return () => clearTimeout(debounce);
    }, [assetTag]);

    const [availableForReservation, setAvailableForReservation] = useState(true);
    const [availableForCheckout, setAvailableForCheckout] = useState(true);
    const [availableForCustody, setAvailableForCustody] = useState(true);
    const [isAccessory, setIsAccessory] = useState(false);
    const [parentAsset, setParentAsset] = useState<ParentSearchResult | null>(null);
    const parentSearch = useParentSearch();
    const units = useMemo<SerializedUnitDraft[]>(() => [{
      key: "unit-primary",
      assetTag,
      serialNumber,
      qrCodeValue,
      uwAssetTag,
    }, ...extraUnits], [assetTag, extraUnits, qrCodeValue, serialNumber, uwAssetTag]);

    function unitFactory() {
      return {
        qrCode: generateQrCode,
        key: () => `batch-unit-${unitKeyRef.current++}`,
      };
    }

    function currentUnits(): SerializedUnitDraft[] {
      return units;
    }

    function replaceUnits(nextUnits: SerializedUnitDraft[], resetTagAdvisory = false) {
      const [first, ...rest] = nextUnits;
      if (!first) return;
      setAssetTag(first.assetTag);
      setSerialNumber(first.serialNumber);
      setQrCodeValue(first.qrCodeValue);
      setUwAssetTag(first.uwAssetTag);
      setExtraUnits(rest);
      if (resetTagAdvisory) {
        setAssetTagError("");
        setAssetTagSummary(null);
      }
    }

    function updateUnit(unitKey: string, field: keyof Omit<SerializedUnitDraft, "key">, value: string) {
      if (field === "assetTag") {
        replaceUnits(updateSerializedUnitAssetTag(currentUnits(), unitKey, value), unitKey === "unit-primary");
        return;
      }
      replaceUnits(currentUnits().map((unit) => unit.key === unitKey ? { ...unit, [field]: value } : unit));
    }

    function setUnitCount(value: number) {
      onInteract();
      replaceUnits(resizeSerializedUnitDrafts(currentUnits(), value, unitFactory()));
    }

    useEffect(() => {
      if (!template) return;
      const firstQrCode = generateQrCode();
      setAssetTag(template.assetTag);
      setItemName(template.name);
      setBrand(template.brand);
      setModel(template.model);
      setCategoryId(template.categoryId);
      setLocationId(template.locationId);
      setDepartmentId(template.departmentId);
      setLinkUrl(template.linkUrl);
      setAvailableForReservation(template.availableForReservation);
      setAvailableForCheckout(template.availableForCheckout);
      setAvailableForCustody(template.availableForCustody);

      // These values describe the new physical unit and must never be copied.
      setSerialNumber("");
      setQrCodeValue(firstQrCode);
      setUwAssetTag("");
      setPurchaseDate("");
      setPurchasePrice("");
      setWarrantyDate("");
      setResidualValue("");
      setFiscalYear("");
      setUserNotes("");
      setIsAccessory(false);
      setParentAsset(null);
      setAssetTagError("");
      setAssetTagSummary(null);
      setProductDetailsOpen(false);
      setProcurementOpen(false);
      setSettingsOpen(false);
      setValidationAttempted(false);
      const seededUnits = resizeSerializedUnitDrafts([{
        key: "unit-primary",
        assetTag: template.assetTag,
        serialNumber: "",
        qrCodeValue: firstQrCode,
        uwAssetTag: "",
      }], template.batchSize ?? 1, unitFactory());
      setExtraUnits(seededUnits.slice(1));
      setShowSerialPaste(false);
      setSerialPasteValue("");
    }, [template]);

    const batchMode = units.length > 1;
    const unitDraftErrors = useMemo(() => getSerializedUnitDraftErrors(units), [units]);
    const readyUnitCount = countReadySerializedUnits(units);
    const assetTagRequired = !isAccessory;
    const departmentOptions = departments.map((department) => ({ value: department.id, label: department.name }));
    const locationOptions = locations.map((location) => ({ value: location.id, label: location.name }));
    const fiscalYearOptions = FISCAL_YEARS.map((year) => ({ value: year, label: year }));

    const assetTagMissing = validationAttempted && assetTagRequired && !assetTag.trim();
    const categoryMissing = validationAttempted && !categoryId;
    const locationMissing = validationAttempted && !locationId;
    const qrCodeMissing = validationAttempted && !qrCodeValue.trim();
    const purchasePriceInvalid = validationAttempted && !isValidUsdPriceInput(purchasePrice);
    const parentMissing = validationAttempted && isAccessory && !parentAsset;

    const productDetailCount = [
      itemName.trim(),
      brand.trim(),
      model.trim(),
      !template && !batchMode && serialNumber.trim(),
      departmentId,
      !template && !batchMode && uwAssetTag.trim(),
      (template || batchMode) && linkUrl.trim(),
      image,
    ].filter(Boolean).length;
    const procurementCount = [
      purchaseDate,
      purchasePrice.trim(),
      warrantyDate,
      residualValue,
      fiscalYear,
      linkUrl.trim(),
      userNotes.trim(),
    ].filter(Boolean).length;
    const policyCustomized = isAccessory
      || !availableForReservation
      || !availableForCheckout
      || !availableForCustody;

    useEffect(() => {
      const requiredValues = batchMode
        ? [
            Boolean(categoryId),
            Boolean(locationId),
            ...units.flatMap((unit, index) => [
              Boolean(unit.assetTag.trim()
                && !unitDraftErrors.has(serializedUnitFieldId(unit, "asset-tag"))
                && (index > 0 || !assetTagError)),
              Boolean(unit.qrCodeValue.trim() && !unitDraftErrors.has(serializedUnitFieldId(unit, "qr"))),
            ]),
          ]
        : [
            assetTagRequired ? Boolean(assetTag.trim() && !assetTagError) : Boolean(parentAsset),
            Boolean(categoryId),
            Boolean(locationId),
            Boolean(qrCodeValue.trim()),
          ];
      onProgressChange({
        completed: requiredValues.filter(Boolean).length,
        total: requiredValues.length,
      });
    }, [assetTag, assetTagError, assetTagRequired, batchMode, categoryId, locationId, onProgressChange, parentAsset, qrCodeValue, unitDraftErrors, units]);

    useEffect(() => {
      onUnitCountChange(units.length);
    }, [onUnitCountChange, units.length]);

    function focusField(fieldId: string) {
      if (PRODUCT_DETAIL_FIELD_IDS.has(fieldId)) setProductDetailsOpen(true);
      if (PROCUREMENT_FIELD_IDS.has(fieldId)) setProcurementOpen(true);
      if (fieldId === "new-item-parent-search") setSettingsOpen(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
      });
    }

    useImperativeHandle(ref, () => ({
      validate() {
        setValidationAttempted(true);
        if (batchMode) {
          if (!categoryId) {
            return { message: "Select a category to continue.", fieldId: "new-item-category" };
          }
          if (!locationId) {
            return { message: "Select a location to continue.", fieldId: "new-item-location" };
          }
          const unitIssue = validateSerializedUnitDrafts(units);
          if (unitIssue) return unitIssue;
          if (assetTagError) {
            return { message: assetTagError, fieldId: serializedUnitFieldId(units[0]!, "asset-tag") };
          }
          if (!isValidUsdPriceInput(purchasePrice)) {
            return {
              message: "Enter purchase price as a USD amount, for example 1299.99.",
              fieldId: "new-item-purchase-price",
            };
          }
          return null;
        }
        if (assetTagRequired && !assetTag.trim()) {
          return { message: "Enter an asset tag to continue.", fieldId: "new-item-asset-tag" };
        }
        if (assetTag.trim() && assetTagError) {
          return { message: assetTagError, fieldId: "new-item-asset-tag" };
        }
        if (!categoryId) {
          return { message: "Select a category to continue.", fieldId: "new-item-category" };
        }
        if (!locationId) {
          return { message: "Select a location to continue.", fieldId: "new-item-location" };
        }
        if (!qrCodeValue.trim()) {
          return { message: "Enter or generate a QR code to continue.", fieldId: "new-item-qr-code" };
        }
        if (isAccessory && !parentAsset) {
          return { message: "Select a parent item for this attachment.", fieldId: "new-item-parent-search" };
        }
        if (!isValidUsdPriceInput(purchasePrice)) {
          return {
            message: "Enter purchase price as a USD amount, for example 1299.99.",
            fieldId: "new-item-purchase-price",
          };
        }
        return null;
      },
      getSubmitBody() {
        return buildSubmitBody(units[0]!);
      },
      getSubmitEntries() {
        return units.map((unit) => ({ unit, body: buildSubmitBody(unit) }));
      },
      getRepeatTemplate() {
        const lastUnit = units.at(-1) ?? units[0]!;
        const productLabel = itemName.trim()
          || [brand.trim(), model.trim()].filter(Boolean).join(" ")
          || lastUnit.assetTag.trim();
        return {
          key: `repeat:${lastUnit.assetTag.trim()}:${lastUnit.qrCodeValue.trim()}`,
          sourceLabel: lastUnit.assetTag.trim(),
          productLabel,
          assetTag: getNextSequentialAssetTag(lastUnit.assetTag),
          batchSize: units.length,
          name: itemName.trim(),
          brand: brand.trim(),
          model: model.trim(),
          categoryId,
          locationId,
          departmentId,
          linkUrl: linkUrl.trim(),
          availableForReservation,
          availableForCheckout,
          availableForCustody,
        };
      },
      retainUnits(unitKeys) {
        const keys = new Set(unitKeys);
        const retained = units.filter((unit) => keys.has(unit.key));
        if (retained.length > 0) replaceUnits(retained, true);
        setValidationAttempted(false);
      },
      reset() {
        setCategoryId("");
        setLocationId("");
        setDepartmentId("");
        setFiscalYear("");
        setAssetTag("");
        setAssetTagError("");
        setAssetTagSummary(null);
        setItemName("");
        setBrand("");
        setModel("");
        setSerialNumber("");
        setPurchaseDate("");
        setPurchasePrice("");
        setWarrantyDate("");
        setResidualValue("");
        setLinkUrl("");
        setUwAssetTag("");
        setUserNotes("");
        setQrCodeValue("");
        setExtraUnits([]);
        setShowSerialPaste(false);
        setSerialPasteValue("");
        setAvailableForReservation(true);
        setAvailableForCheckout(true);
        setAvailableForCustody(true);
        setIsAccessory(false);
        setParentAsset(null);
        setProductDetailsOpen(false);
        setProcurementOpen(false);
        setSettingsOpen(false);
        setValidationAttempted(false);
        parentSearch.clear();
      },
      focus() {
        assetTagInputRef.current?.focus();
      },
      focusField,
    }));

    function buildSubmitBody(unit: SerializedUnitDraft) {
      return buildSerializedItemSubmitBody({
          assetTag: unit.assetTag,
          itemName,
          brand,
          model,
          serialNumber: unit.serialNumber,
          qrCodeValue: unit.qrCodeValue,
          locationId,
          categoryId,
          departmentId,
          purchaseDate,
          purchasePrice,
          warrantyDate,
          residualValue,
          linkUrl,
          uwAssetTag: unit.uwAssetTag,
          fiscalYear,
          userNotes,
          availableForReservation,
          availableForCheckout,
          availableForCustody,
          isAccessory,
          parentAssetId: parentAsset?.id,
          parentAsset: parentAsset
            ? {
                assetTag: parentAsset.assetTag,
                name: parentAsset.name,
                brand: parentAsset.brand,
                model: parentAsset.model,
              }
            : undefined,
        });
    }

    return (
      <fieldset disabled={disabled} className="contents" onInputCapture={onInteract}>
        <FormSection
          title="Essentials"
          badge={isAccessory ? "Attachment intake" : batchMode ? `${units.length} physical items` : "Fast intake"}
          badgeVariant="blue"
          description={isAccessory
            ? "Category, location, QR code, and a parent item are required. A blank visible tag becomes a quiet internal attachment tag."
            : batchMode
              ? "Category and location apply to every item. Each physical identity stays editable below."
            : template
              ? `Product defaults came from ${template.sourceLabel}. Confirm the suggested tag, category, location, and generated QR code.`
              : "Fast intake needs the asset tag, category, location, and QR code. Product details can be filled in later."}
        >
          {!isAccessory && (
            <FormRow label="Physical items" htmlFor="new-item-batch-size" required>
              <div className="flex items-center gap-2">
                <Input
                  id="new-item-batch-size"
                  name="batchSize"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_SERIALIZED_BATCH_SIZE}
                  value={units.length}
                  onChange={(event) => setUnitCount(Number(event.target.value))}
                  className="h-10 w-24"
                  aria-describedby="new-item-batch-size-help"
                />
                <span id="new-item-batch-size-help" className="text-xs text-muted-foreground">
                  One record per physical item, up to {MAX_SERIALIZED_BATCH_SIZE}.
                </span>
              </div>
            </FormRow>
          )}

          {!batchMode && (
            <FormRow label="Asset tag" htmlFor="new-item-asset-tag" required={assetTagRequired}>
              <Input
                id="new-item-asset-tag"
                name="assetTag"
                ref={assetTagInputRef}
                value={assetTag}
                onChange={(event) => {
                  setAssetTag(event.target.value);
                  setAssetTagError("");
                  setAssetTagSummary(null);
                }}
                placeholder={isAccessory ? "Optional for attachments" : "Unique tag name"}
                autoComplete="off"
                required={assetTagRequired}
                aria-invalid={Boolean(assetTagError || assetTagMissing) || undefined}
                aria-describedby={assetTagError || assetTagMissing ? "new-item-asset-tag-error" : undefined}
                className="h-10"
              />
              {(assetTagError || assetTagMissing) && (
                <FormFieldError id="new-item-asset-tag-error">
                  {assetTagError || "Asset tag is required."}
                </FormFieldError>
              )}
              {isAccessory && !assetTag.trim() && (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Leave blank for an internal tag; the physical label can stay QR-only.
                </p>
              )}
              {!assetTagError && assetTagSummary && assetTag.trim() && (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {`${assetTagSummary.existingCount} existing ${assetTagSummary.base} ${assetTagSummary.existingCount === 1 ? "item" : "items"}. Suggested next tag: ${assetTagSummary.nextTag}.`}
                </p>
              )}
            </FormRow>
          )}

          <FormRow label="Category" htmlFor="new-item-category" required>
            <CategoryCombobox
              id="new-item-category"
              value={categoryId}
              onValueChange={(value) => {
                onInteract();
                setCategoryId(value);
              }}
              categories={categories}
              triggerClassName="h-10"
              ariaInvalid={categoryMissing}
              ariaDescribedBy={categoryMissing ? "new-item-category-error" : undefined}
            />
            {categoryMissing && <FormFieldError id="new-item-category-error">Category is required.</FormFieldError>}
          </FormRow>

          <FormRow label="Location" htmlFor="new-item-location" required>
            <FormCombobox
              id="new-item-location"
              value={locationId}
              onValueChange={(value) => {
                onInteract();
                setLocationId(value);
              }}
              options={locationOptions}
              placeholder="Select a location"
              searchPlaceholder="Search locations..."
              emptyLabel="No location found."
              triggerClassName="h-10"
              ariaInvalid={locationMissing}
              ariaDescribedBy={locationMissing ? "new-item-location-error" : undefined}
            />
            {locationMissing && <FormFieldError id="new-item-location-error">Location is required.</FormFieldError>}
          </FormRow>

          {!batchMode && (
            <FormRow label="QR code" htmlFor="new-item-qr-code" required>
              <div className="flex gap-2">
                <Input
                  id="new-item-qr-code"
                  name="qrCodeValue"
                  value={qrCodeValue}
                  onChange={(event) => setQrCodeValue(event.target.value)}
                  placeholder="Scan, enter, or generate a code"
                  autoComplete="off"
                  required
                  aria-invalid={qrCodeMissing || undefined}
                  aria-describedby={qrCodeMissing ? "new-item-qr-code-error" : undefined}
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
                    setQrCodeValue(generateQrCode());
                  }}
                >
                  <Dices className="size-4" />
                </Button>
              </div>
              {qrCodeMissing && <FormFieldError id="new-item-qr-code-error">QR code is required.</FormFieldError>}
            </FormRow>
          )}
        </FormSection>

        {batchMode && (
          <FormSection
            title="Unit identities"
            badge={`${readyUnitCount} of ${units.length} ready`}
            badgeVariant={readyUnitCount === units.length ? "blue" : "orange"}
            description="Tags and QR codes are required per item. Serial and UW tags stay optional but unique to the physical unit."
          >
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-10"
                onClick={() => setShowSerialPaste((visible) => !visible)}
              >
                <ClipboardPaste className="size-4" />
                Paste serials
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10"
                onClick={() => {
                  onInteract();
                  replaceUnits(regenerateSerializedUnitTags(units), true);
                }}
              >
                <RefreshCw className="size-4" />
                Regenerate tags
              </Button>
            </div>

            {showSerialPaste && (
              <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-3">
                <Label htmlFor="new-item-batch-serial-paste">Serial-number column</Label>
                <Textarea
                  id="new-item-batch-serial-paste"
                  value={serialPasteValue}
                  onChange={(event) => setSerialPasteValue(event.target.value)}
                  placeholder={"S001\nS002\nS003"}
                  rows={4}
                  autoComplete="off"
                  className="resize-y font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Paste a spreadsheet column, tab-separated cells, or comma-separated serials. Extra values add rows, up to {MAX_SERIALIZED_BATCH_SIZE}.
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-10"
                    onClick={() => {
                      setShowSerialPaste(false);
                      setSerialPasteValue("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="h-10"
                    disabled={parsePastedSerialNumbers(serialPasteValue).length === 0}
                    onClick={() => {
                      const serials = parsePastedSerialNumbers(serialPasteValue);
                      if (serials.length === 0) return;
                      onInteract();
                      replaceUnits(applyPastedSerialNumbers(units, serials, unitFactory()));
                      setShowSerialPaste(false);
                      setSerialPasteValue("");
                    }}
                  >
                    Apply {parsePastedSerialNumbers(serialPasteValue).length || ""} serials
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3">
              {units.map((unit, index) => {
                const tagFieldId = serializedUnitFieldId(unit, "asset-tag");
                const serialFieldId = serializedUnitFieldId(unit, "serial");
                const qrFieldId = serializedUnitFieldId(unit, "qr");
                const uwTagFieldId = serializedUnitFieldId(unit, "uw-tag");
                const rawTagError = index === 0 && assetTagError
                  ? assetTagError
                  : unitDraftErrors.get(tagFieldId) ?? "";
                const rawSerialError = unitDraftErrors.get(serialFieldId) ?? "";
                const rawQrError = unitDraftErrors.get(qrFieldId) ?? "";
                const tagError = rawTagError === "Asset tag is required." && !validationAttempted ? "" : rawTagError;
                const qrError = rawQrError === "QR code is required." && !validationAttempted ? "" : rawQrError;
                const rowReady = !rawTagError && !rawSerialError && !rawQrError;
                const nextSerialFieldId = units[index + 1]
                  ? serializedUnitFieldId(units[index + 1]!, "serial")
                  : qrFieldId;

                return (
                  <div key={unit.key} className="rounded-lg border border-border/60 bg-background p-3 shadow-xs">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">Item {index + 1}</span>
                        <Badge variant={rowReady ? "gray" : "orange"} size="sm">
                          {rowReady ? "Identity ready" : "Needs attention"}
                        </Badge>
                      </div>
                      {index > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-10"
                          aria-label={`Remove item ${index + 1}`}
                          onClick={() => {
                            onInteract();
                            replaceUnits(units.filter((candidate) => candidate.key !== unit.key));
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={tagFieldId}>Asset tag <span className="text-destructive">*</span></Label>
                        <Input
                          id={tagFieldId}
                          ref={index === 0 ? assetTagInputRef : undefined}
                          value={unit.assetTag}
                          onChange={(event) => updateUnit(unit.key, "assetTag", event.target.value)}
                          autoComplete="off"
                          aria-invalid={Boolean(tagError) || undefined}
                          aria-describedby={tagError ? `${tagFieldId}-error` : undefined}
                          className="h-10"
                        />
                        {tagError && <FormFieldError id={`${tagFieldId}-error`}>{tagError}</FormFieldError>}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={serialFieldId}>Serial number</Label>
                        <Input
                          id={serialFieldId}
                          value={unit.serialNumber}
                          onChange={(event) => updateUnit(unit.key, "serialNumber", event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            document.getElementById(nextSerialFieldId)?.focus();
                          }}
                          placeholder="Scan or enter serial"
                          autoComplete="off"
                          aria-invalid={Boolean(rawSerialError) || undefined}
                          aria-describedby={rawSerialError ? `${serialFieldId}-error` : undefined}
                          className="h-10"
                        />
                        {rawSerialError && <FormFieldError id={`${serialFieldId}-error`}>{rawSerialError}</FormFieldError>}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={qrFieldId}>QR code <span className="text-destructive">*</span></Label>
                        <div className="flex gap-2">
                          <Input
                            id={qrFieldId}
                            value={unit.qrCodeValue}
                            onChange={(event) => updateUnit(unit.key, "qrCodeValue", event.target.value)}
                            placeholder="Scan, enter, or generate"
                            autoComplete="off"
                            aria-invalid={Boolean(qrError) || undefined}
                            aria-describedby={qrError ? `${qrFieldId}-error` : undefined}
                            className="h-10 flex-1"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-10"
                            aria-label={`Generate QR code for item ${index + 1}`}
                            onClick={() => {
                              onInteract();
                              updateUnit(unit.key, "qrCodeValue", generateQrCode());
                            }}
                          >
                            <Dices className="size-4" />
                          </Button>
                        </div>
                        {qrError && <FormFieldError id={`${qrFieldId}-error`}>{qrError}</FormFieldError>}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={uwTagFieldId}>UW Asset Tag</Label>
                        <Input
                          id={uwTagFieldId}
                          value={unit.uwAssetTag}
                          onChange={(event) => updateUnit(unit.key, "uwAssetTag", event.target.value)}
                          placeholder="Campus asset tag"
                          autoComplete="off"
                          className="h-10"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <Button
              type="button"
              variant="outline"
              className="h-10 self-start"
              disabled={units.length >= MAX_SERIALIZED_BATCH_SIZE}
              onClick={() => setUnitCount(units.length + 1)}
            >
              <Plus className="size-4" />
              Add item row
            </Button>
          </FormSection>
        )}

        {(template || batchMode) && (
          <FormSection
            title={batchMode ? "Shipment details" : "New unit details"}
            badge={batchMode ? `Applies to ${units.length} items` : "Different for this item"}
            badgeVariant="orange"
            description={batchMode
              ? "Purchase, warranty, fiscal year, and notes apply to every item in this new shipment."
              : "Serial, campus tag, purchase, warranty, and notes were intentionally left blank for this physical item."}
          >
            {!batchMode && (
              <>
                <FormRow label="Serial number" htmlFor="new-item-serial-number">
                  <Input id="new-item-serial-number" name="serialNumber" value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} placeholder="Manufacturer serial" autoComplete="off" className="h-10" />
                </FormRow>

                <FormRow label="UW Asset Tag" htmlFor="new-item-uw-asset-tag">
                  <Input id="new-item-uw-asset-tag" name="uwAssetTag" value={uwAssetTag} onChange={(event) => setUwAssetTag(event.target.value)} placeholder="Campus asset tag number" autoComplete="off" className="h-10" />
                </FormRow>
              </>
            )}

            <FormRow2Col label="Purchase">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-item-purchase-date" className="text-xs text-muted-foreground">Date</Label>
                <Input id="new-item-purchase-date" name="purchaseDate" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} type="date" autoComplete="off" className="h-10" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-item-purchase-price" className="text-xs text-muted-foreground">Price (USD)</Label>
                <div className="flex h-10 rounded-md border border-input bg-background shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 has-[input[aria-invalid=true]]:border-destructive has-[input[aria-invalid=true]]:ring-[3px] has-[input[aria-invalid=true]]:ring-destructive/20">
                  <span className="flex items-center border-r px-3 text-sm text-muted-foreground">$</span>
                  <Input
                    id="new-item-purchase-price"
                    name="purchasePrice"
                    value={purchasePrice}
                    onChange={(event) => setPurchasePrice(event.target.value)}
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    autoComplete="off"
                    aria-label="Purchase price in US dollars"
                    aria-invalid={purchasePriceInvalid || undefined}
                    aria-describedby={purchasePriceInvalid ? "new-item-purchase-price-error" : undefined}
                    className="h-full border-0 shadow-none focus-visible:ring-0"
                  />
                </div>
                {purchasePriceInvalid && (
                  <FormFieldError id="new-item-purchase-price-error">Use a USD amount such as 1299.99.</FormFieldError>
                )}
              </div>
            </FormRow2Col>

            <FormRow2Col label="Warranty">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-item-warranty-date" className="text-xs text-muted-foreground">Date</Label>
                <Input id="new-item-warranty-date" name="warrantyDate" value={warrantyDate} onChange={(event) => setWarrantyDate(event.target.value)} type="date" autoComplete="off" className="h-10" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-item-residual-value" className="text-xs text-muted-foreground">Residual value</Label>
                <Input id="new-item-residual-value" name="residualValue" value={residualValue} onChange={(event) => setResidualValue(event.target.value)} type="number" min="0" step="0.01" placeholder="0" autoComplete="off" className="h-10" />
              </div>
            </FormRow2Col>

            <FormRow label="Fiscal year" htmlFor="new-item-fiscal-year">
              <FormCombobox
                id="new-item-fiscal-year"
                value={fiscalYear}
                onValueChange={(value) => {
                  onInteract();
                  setFiscalYear(value);
                }}
                options={fiscalYearOptions}
                placeholder="Select fiscal year"
                searchPlaceholder="Search..."
                emptyLabel="No match."
                allowClear
                triggerClassName="h-10"
              />
            </FormRow>

            <FormRow label="Notes" htmlFor="new-item-notes">
              <Textarea
                id="new-item-notes"
                name="notes"
                value={userNotes}
                onChange={(event) => setUserNotes(event.target.value)}
                placeholder="Condition, included parts, or intake context"
                autoComplete="off"
                rows={3}
                className="resize-none"
              />
            </FormRow>
          </FormSection>
        )}

        <FormSection
          title="Product details"
          badge={productDetailCount > 0 ? `${productDetailCount} added` : "Optional"}
          badgeVariant={productDetailCount > 0 ? "blue" : "secondary"}
          description={batchMode
            ? "Shared name, brand, model, department, product link, and image."
            : template
              ? "Copied name, brand, model, department, product link, and image."
              : "Name, brand, model, serial, department, campus tag, and image."}
          collapsible
          open={productDetailsOpen}
          onOpenChange={setProductDetailsOpen}
        >
          <FormRow label="Name" htmlFor="new-item-name">
            <Input id="new-item-name" name="name" value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="e.g. Sony A7III Camera" autoComplete="off" className="h-10" />
          </FormRow>

          <FormRow2Col label="Brand / Model">
            <Input id="new-item-brand" name="brand" value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="e.g. Sony" aria-label="Brand" autoComplete="off" className="h-10" />
            <Input id="new-item-model" name="model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="e.g. A7III" aria-label="Model" autoComplete="off" className="h-10" />
          </FormRow2Col>

          {!template && !batchMode && (
            <FormRow label="Serial number" htmlFor="new-item-serial-number">
              <Input id="new-item-serial-number" name="serialNumber" value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} placeholder="Manufacturer serial" autoComplete="off" className="h-10" />
            </FormRow>
          )}

          <FormRow label="Department" htmlFor="new-item-department">
            <FormCombobox
              id="new-item-department"
              value={departmentId}
              onValueChange={(value) => {
                onInteract();
                setDepartmentId(value);
              }}
              options={departmentOptions}
              placeholder="Select a department"
              searchPlaceholder="Search departments..."
              emptyLabel="No department found."
              triggerClassName="h-10"
            />
          </FormRow>

          {!template && !batchMode && (
            <FormRow label="UW Asset Tag" htmlFor="new-item-uw-asset-tag">
              <Input id="new-item-uw-asset-tag" name="uwAssetTag" value={uwAssetTag} onChange={(event) => setUwAssetTag(event.target.value)} placeholder="Campus asset tag number" autoComplete="off" className="h-10" />
            </FormRow>
          )}

          {(template || batchMode) && (
            <FormRow label="Product link" htmlFor="new-item-link-url">
              <Input id="new-item-link-url" name="linkUrl" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} type="url" placeholder="https://..." autoComplete="off" className="h-10" />
            </FormRow>
          )}

          <ItemImageDraftField
            image={image}
            disabled={disabled}
            onChoose={() => onChooseImage(buildItemImageSearchSeed(itemName, brand, model, assetTag))}
            onClear={onClearImage}
            embedded
          />
        </FormSection>

        {!template && !batchMode && <FormSection
          title="Purchasing & notes"
          badge={procurementCount > 0 ? `${procurementCount} added` : "Optional"}
          badgeVariant={procurementCount > 0 ? "blue" : "secondary"}
          description="Purchase, warranty, fiscal year, product link, and operator notes."
          collapsible
          open={procurementOpen}
          onOpenChange={setProcurementOpen}
        >
          <FormRow2Col label="Purchase">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-item-purchase-date" className="text-xs text-muted-foreground">Date</Label>
              <Input id="new-item-purchase-date" name="purchaseDate" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} type="date" autoComplete="off" className="h-10" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-item-purchase-price" className="text-xs text-muted-foreground">Price (USD)</Label>
              <div className="flex h-10 rounded-md border border-input bg-background shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 has-[input[aria-invalid=true]]:border-destructive has-[input[aria-invalid=true]]:ring-[3px] has-[input[aria-invalid=true]]:ring-destructive/20">
                <span className="flex items-center border-r px-3 text-sm text-muted-foreground">$</span>
                <Input
                  id="new-item-purchase-price"
                  name="purchasePrice"
                  value={purchasePrice}
                  onChange={(event) => setPurchasePrice(event.target.value)}
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  autoComplete="off"
                  aria-label="Purchase price in US dollars"
                  aria-invalid={purchasePriceInvalid || undefined}
                  aria-describedby={purchasePriceInvalid ? "new-item-purchase-price-error" : undefined}
                  className="h-full border-0 shadow-none focus-visible:ring-0"
                />
              </div>
              {purchasePriceInvalid && (
                <FormFieldError id="new-item-purchase-price-error">Use a USD amount such as 1299.99.</FormFieldError>
              )}
            </div>
          </FormRow2Col>

          <FormRow2Col label="Warranty">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-item-warranty-date" className="text-xs text-muted-foreground">Date</Label>
              <Input id="new-item-warranty-date" name="warrantyDate" value={warrantyDate} onChange={(event) => setWarrantyDate(event.target.value)} type="date" autoComplete="off" className="h-10" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-item-residual-value" className="text-xs text-muted-foreground">Residual value</Label>
              <Input id="new-item-residual-value" name="residualValue" value={residualValue} onChange={(event) => setResidualValue(event.target.value)} type="number" min="0" step="0.01" placeholder="0" autoComplete="off" className="h-10" />
            </div>
          </FormRow2Col>

          <FormRow label="Fiscal year" htmlFor="new-item-fiscal-year">
            <FormCombobox
              id="new-item-fiscal-year"
              value={fiscalYear}
              onValueChange={(value) => {
                onInteract();
                setFiscalYear(value);
              }}
              options={fiscalYearOptions}
              placeholder="Select fiscal year"
              searchPlaceholder="Search..."
              emptyLabel="No match."
              allowClear
              triggerClassName="h-10"
            />
          </FormRow>

          <FormRow label="Link" htmlFor="new-item-link-url">
            <Input id="new-item-link-url" name="linkUrl" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} type="url" placeholder="https://..." autoComplete="off" className="h-10" />
          </FormRow>

          <FormRow label="Notes" htmlFor="new-item-notes">
            <Textarea
              id="new-item-notes"
              name="notes"
              value={userNotes}
              onChange={(event) => setUserNotes(event.target.value)}
              placeholder="Condition, included parts, or intake context"
              autoComplete="off"
              rows={3}
              className="resize-none"
            />
          </FormRow>
        </FormSection>}

        <FormSection
          title="Workflow settings"
          badge={isAccessory ? "Attachment" : policyCustomized ? "Customized" : "Defaults on"}
          badgeVariant={isAccessory ? "orange" : policyCustomized ? "blue" : "gray"}
          description="Attachment relationship and future reservation, checkout, and custody eligibility."
          collapsible
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        >
          <div className="flex min-h-11 items-center justify-between gap-4">
            <div>
              <Label htmlFor="new-item-is-accessory" className="text-sm font-medium">Item is an attachment</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {batchMode ? "Batch intake creates standalone items. Switch back to one item to create an attachment." : "Tie this part to a parent camera or other item."}
              </p>
            </div>
            <Switch
              id="new-item-is-accessory"
              name="isAccessory"
              checked={isAccessory}
              disabled={batchMode}
              onCheckedChange={(value) => {
                onInteract();
                setIsAccessory(value);
                if (value) {
                  setAvailableForReservation(false);
                  setAvailableForCheckout(false);
                  setAvailableForCustody(false);
                } else {
                  setParentAsset(null);
                  parentSearch.clear();
                  setAvailableForReservation(true);
                  setAvailableForCheckout(true);
                  setAvailableForCustody(true);
                }
              }}
            />
          </div>

          {isAccessory && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-item-parent-search">Parent item <span className="text-destructive">*</span></Label>
              {parentAsset ? (
                <div className="flex min-h-10 items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{parentAsset.assetTag}</span>
                    {" — "}
                    {parentAsset.name || `${parentAsset.brand} ${parentAsset.model}`}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-10"
                    aria-label="Clear parent item"
                    onClick={() => {
                      onInteract();
                      setParentAsset(null);
                      parentSearch.clear();
                    }}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    id="new-item-parent-search"
                    name="parentAssetSearch"
                    value={parentSearch.query}
                    onChange={(event) => parentSearch.setQuery(event.target.value)}
                    placeholder="Search by parent tag, brand, or model"
                    autoComplete="off"
                    aria-invalid={parentMissing || undefined}
                    aria-describedby={parentMissing ? "new-item-parent-search-error" : undefined}
                    className="h-10"
                  />
                  {parentMissing && <FormFieldError id="new-item-parent-search-error">Parent item is required.</FormFieldError>}
                  {parentSearch.searching && <p className="px-1 text-xs text-muted-foreground">Searching...</p>}
                  {parentSearch.results.length > 0 && (
                    <div className="divide-y rounded-md border text-sm">
                      {parentSearch.results.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="min-h-10 w-full px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          onClick={() => {
                            onInteract();
                            setParentAsset(item);
                            parentSearch.clear();
                          }}
                        >
                          <span className="font-medium">{item.assetTag}</span>
                          {" — "}
                          {item.name || `${item.brand} ${item.model}`}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              <p className="text-xs text-muted-foreground">
                Attachments remain findable but cannot be reserved or checked out independently.
              </p>
            </div>
          )}

          {!isAccessory && (
            <div className="flex flex-col divide-y divide-border/60">
              {[
                {
                  id: "new-item-available-for-reservation",
                  label: "Available for reservation",
                  description: "May be selected for future reservations.",
                  checked: availableForReservation,
                  onCheckedChange: setAvailableForReservation,
                },
                {
                  id: "new-item-available-for-checkout",
                  label: "Available for check out",
                  description: "May be selected for immediate kiosk checkout.",
                  checked: availableForCheckout,
                  onCheckedChange: setAvailableForCheckout,
                },
                {
                  id: "new-item-available-for-custody",
                  label: "Available for custody",
                  description: "May be taken into custody by a user.",
                  checked: availableForCustody,
                  onCheckedChange: setAvailableForCustody,
                },
              ].map((setting) => (
                <div key={setting.id} className="flex min-h-14 items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
                  <div>
                    <Label htmlFor={setting.id} className="text-sm font-medium">{setting.label}</Label>
                    <p className="mt-1 text-xs text-muted-foreground">{setting.description}</p>
                  </div>
                  <Switch
                    id={setting.id}
                    name={setting.id.replace("new-item-", "")}
                    checked={setting.checked}
                    onCheckedChange={(value) => {
                      onInteract();
                      setting.onCheckedChange(value);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </FormSection>
      </fieldset>
    );
  },
);
