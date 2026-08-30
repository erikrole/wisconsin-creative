import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Add item sheet booking-inspired UI", () => {
  it("keeps one tracking choice surface and a compact repeated-intake handoff", () => {
    const source = readFileSync("src/app/(app)/items/new-item-sheet.tsx", "utf8");

    expect(source).toContain("KIND_OPTIONS");
    expect(source).toContain("Creates one item record that can be reserved, checked out, and found by QR.");
    expect(source).toContain("Creates a family record plus numbered units for kiosk pickup and return.");
    expect(source).toContain("Creates or updates one stock record and tracks the count on hand.");
    expect(source).toContain("SummaryRow label=\"Status\"");
    expect(source).toContain("SummaryRow label=\"Tracking\"");
    expect(source).toContain("SummaryRow label=\"Next\"");
    expect(source).toContain("Add another item");
    expect(source).toContain("Add another like this");
    expect(source).toContain("Add different item");
    expect(source).toContain('loading={submitting}');
    expect(source).not.toContain('id="add-another"');
    expect(source).not.toContain('requirements.map');
  });

  it("reuses stable product defaults while keeping physical-unit fields new", () => {
    const source = readFileSync("src/app/(app)/items/new-item-sheet.tsx", "utf8");
    const standardSource = readFileSync("src/app/(app)/items/new-item-sheet/SerializedItemForm.tsx", "utf8");
    const listSource = readFileSync("src/app/(app)/items/page.tsx", "utf8");
    const columnsSource = readFileSync("src/app/(app)/items/columns.tsx", "utf8");
    const tableSource = readFileSync("src/app/(app)/items/data-table.tsx", "utf8");
    const detailSource = readFileSync("src/app/(app)/items/[id]/page.tsx", "utf8");
    const headerSource = readFileSync("src/app/(app)/items/[id]/_components/ItemHeader.tsx", "utf8");
    const actionsSource = readFileSync("src/app/(app)/items/[id]/_hooks/use-item-actions.ts", "utf8");

    expect(source).toContain("sourceAssetId = null");
    expect(source).toContain("buildSerializedIntakeTemplate(source, relatedAssets)");
    expect(source).toContain("Product details, category, location, image, link, and workflow settings came from");
    expect(source).toContain("Serial, QR, campus tag, purchase, warranty, fiscal year, and notes are new for");
    expect(source).toContain('serializedUnitCount > 1 ? "this shipment" : "this item"');
    expect(source).toContain("batchContinuationTemplate ?? serializedRef.current!.getRepeatTemplate()");
    expect(source).toContain('createdHandoff?.repeatTemplate ? "similar" : "another"');
    expect(standardSource).toContain('title={batchMode ? "Shipment details" : "New unit details"}');
    expect(standardSource).toContain('badge={batchMode ? `Applies to ${units.length} items` : "Different for this item"}');
    expect(standardSource).toContain("setSerialNumber(\"\")");
    expect(standardSource).toContain("setQrCodeValue(generateQrCode())");
    expect(standardSource).toContain("setPurchaseDate(\"\")");
    expect(standardSource).toContain("getRepeatTemplate()");
    expect(listSource).toContain('case "add-another"');
    expect(listSource).toContain("sourceAssetId={createSourceId}");
    expect(columnsSource).toContain('onRowAction?.("add-another", asset)');
    expect(tableSource).toContain('onRowAction?.("add-another", item)');
    expect(detailSource).toContain('if (action === "add-another")');
    expect(headerSource).toContain('onAction("add-another")');
    expect(actionsSource).not.toContain('/duplicate`');
  });

  it("keeps required intake together and collapses optional metadata by default", () => {
    const sectionSource = readFileSync("src/app/(app)/items/new-item-sheet/FormSection.tsx", "utf8");
    const standardSource = readFileSync("src/app/(app)/items/new-item-sheet/SerializedItemForm.tsx", "utf8");
    const bulkSource = readFileSync("src/app/(app)/items/new-item-sheet/BulkItemForm.tsx", "utf8");

    expect(sectionSource).toContain("CollapsibleTrigger asChild");
    expect(sectionSource).toContain("min-h-14 w-full");
    expect(standardSource).toContain('title="Essentials"');
    expect(standardSource).toContain('isAccessory ? "Attachment intake" : batchMode ? `${units.length} physical items` : "Fast intake"');
    expect(standardSource).toContain('title="Product details"');
    expect(standardSource).toContain('title="Purchasing & notes"');
    expect(standardSource).toContain('title="Workflow settings"');
    expect(standardSource).toContain("collapsible");
    expect(standardSource).toContain("open={productDetailsOpen}");
    expect(standardSource).toContain("open={procurementOpen}");
    expect(standardSource).toContain("open={settingsOpen}");
    expect(bulkSource).toContain('title="Stock action"');
    expect(bulkSource).toContain('title="Essentials"');
    expect(bulkSource).toContain('title="Product image"');
    expect(bulkSource).toContain("open={imageOpen}");
  });

  it("keeps Add item form fields label-associated and autofill-quiet", () => {
    const comboboxSource = readFileSync("src/components/FormCombobox.tsx", "utf8");
    const standardSource = readFileSync("src/app/(app)/items/new-item-sheet/SerializedItemForm.tsx", "utf8");
    const bulkSource = readFileSync("src/app/(app)/items/new-item-sheet/BulkItemForm.tsx", "utf8");

    expect(comboboxSource).toContain("id?: string;");
    expect(comboboxSource).toContain("id={id}");
    expect(standardSource).toContain('label="Asset tag" htmlFor="new-item-asset-tag"');
    expect(standardSource).toContain("required={assetTagRequired}");
    expect(standardSource).toContain("Optional for attachments");
    expect(standardSource).toContain("Leave blank for an internal tag");
    expect(standardSource).toContain('label="Category" htmlFor="new-item-category"');
    expect(standardSource).toContain('htmlFor="new-item-is-accessory"');
    expect(standardSource).toContain('id: "new-item-available-for-reservation"');
    expect(standardSource).toContain("<Label htmlFor={setting.id}");
    expect(standardSource).toContain("<ItemImageDraftField");
    expect(standardSource).toContain('Price (USD)');
    expect(standardSource).toContain("assetTagSummary && assetTag.trim()");
    expect(standardSource).toContain("setTimeout(async () =>");
    expect(standardSource).toContain("Suggested next tag");
    expect(standardSource).toContain('aria-invalid={Boolean(assetTagError || assetTagMissing) || undefined}');
    expect(standardSource).toContain("FormFieldError");
    expect(standardSource).toContain('triggerClassName="h-10"');
    expect(standardSource).toContain('autoComplete="off"');
    expect(bulkSource).toContain('label="Item name" htmlFor="new-bulk-item-name"');
    expect(bulkSource).toContain('label="Item" htmlFor="existing-bulk-item"');
    expect(bulkSource).toContain('aria-label="Generate QR code"');
    expect(bulkSource).toContain("<ItemImageDraftField");
    expect(bulkSource).toContain("MAX_NUMBERED_UNITS_PER_CREATE");
  });

  it("excludes unit-tracked families from the Quantity add-to-existing selector", () => {
    const bulkSource = readFileSync("src/app/(app)/items/new-item-sheet/BulkItemForm.tsx", "utf8");

    // The add-to-existing path must only target quantity-tracked families so it never
    // routes unit-tracked stock through /adjust (which skips BulkSkuUnit creation).
    expect(bulkSource).toContain("existingBulkSkus.filter((sku) => !sku.trackByNumber)");
    expect(bulkSource).toContain("skus={quantityOnlyBulkSkus}");
    expect(bulkSource).toContain("quantityOnlyBulkSkus.find((item) => item.id === selectedBulkSkuId)");
    expect(bulkSource).toContain("quantityOnlyBulkSkus.length === 0");
    expect(bulkSource).toContain("createsCatalogRecord: false");
    expect(bulkSource).toContain('if (nextMode === "existing")');
    expect(bulkSource).toContain("onClearImage();");
  });

  it("provides validation recovery, progress, stable action language, and discard protection", () => {
    const source = readFileSync("src/app/(app)/items/new-item-sheet.tsx", "utf8");
    const standardSource = readFileSync("src/app/(app)/items/new-item-sheet/SerializedItemForm.tsx", "utf8");
    const bulkSource = readFileSync("src/app/(app)/items/new-item-sheet/BulkItemForm.tsx", "utf8");

    expect(source).toContain("noValidate");
    expect(source).toContain("focusValidationIssue");
    expect(source).toContain("focusField(issue.fieldId)");
    expect(source).toContain("Required fields complete");
    expect(source).toContain('bulkOperation === "adjust" ? "Add stock" : "Create item"');
    expect(source).toContain(": bulkHandoffHref;");
    expect(source).not.toContain('bulkHandoffHref?.split("/").pop()');
    expect(source).toContain("Discard this item?");
    expect(source).toContain("Keep editing");
    expect(source).toContain("Discard item");
    expect(source).toContain('<SheetFooter className="flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">');
    expect(source).toContain('className="grid grid-cols-2 gap-2 sm:contents"');
    expect(standardSource).toContain("onProgressChange({");
    expect(standardSource).toContain('fieldId: "new-item-category"');
    expect(bulkSource).toContain('fieldId: "new-bulk-item-initial-quantity"');
    expect(bulkSource).toContain('onOperationChange(bulkMode === "existing" ? "adjust" : "create")');
  });

  it("supports bounded serialized batch intake without bypassing the audited asset route", () => {
    const source = readFileSync("src/app/(app)/items/new-item-sheet.tsx", "utf8");
    const standardSource = readFileSync("src/app/(app)/items/new-item-sheet/SerializedItemForm.tsx", "utf8");
    const batchSource = readFileSync("src/app/(app)/items/new-item-sheet/serialized-batch.ts", "utf8");

    expect(standardSource).toContain("getSubmitEntries()");
    expect(standardSource).toContain("retainUnits(unitKeys: string[])");
    expect(standardSource).toContain('title="Unit identities"');
    expect(standardSource).toContain("Paste serials");
    expect(standardSource).toContain("Regenerate tags");
    expect(standardSource).toContain('title={batchMode ? "Shipment details" : "New unit details"}');
    expect(batchSource).toContain("MAX_SERIALIZED_BATCH_SIZE = 25");
    expect(batchSource).toContain("validateSerializedUnitDrafts");
    expect(source).toContain('await fetch("/api/assets"');
    expect(source).toContain("for (let index = 0; index < entries.length; index += 1)");
    expect(source).toContain("serializedRef.current?.retainUnits");
    expect(source).toContain("The items already created will not be submitted again.");
    expect(source).toContain("Fix {createdHandoff.batch.failures.length} remaining");
    expect(source).toContain("Creating item ${submissionProgress.current} of ${submissionProgress.total}");
  });

  it("does not present a failed count-stock lookup as an honest empty state", () => {
    const bulkSource = readFileSync("src/app/(app)/items/new-item-sheet/BulkItemForm.tsx", "utf8");

    expect(bulkSource).toContain('setExistingItemsState("loading")');
    expect(bulkSource).toContain('setExistingItemsState("error")');
    expect(bulkSource).toContain("!json || !Array.isArray(json.data)");
    expect(bulkSource).toContain("returned an unreadable response");
    expect(bulkSource).toContain('title="Loading count-tracked items"');
    expect(bulkSource).toContain('id="retry-existing-bulk-items"');
    expect(bulkSource).toContain("No active count-tracked items are available. Create one instead.");
  });

  it("persists staged images only after a new catalog record returns an id", () => {
    const source = readFileSync("src/app/(app)/items/new-item-sheet.tsx", "utf8");
    const modal = readFileSync("src/components/ChooseImageModal.tsx", "utf8");

    expect(source).toContain("imageDraft && createsCatalogRecord");
    expect(source).toContain("`/api/assets/${createdId}/image`");
    expect(source).toContain("`/api/bulk-skus/${createdId}/image`");
    expect(source).toContain("await persistDraftItemImage(endpoint, imageDraft)");
    expect(source).toContain("Item created, but its image needs attention.");
    expect(source).toContain("Retry image");
    expect(source).toContain("await persistCreatedImage(createdHandoff.imageEndpoint)");
    expect(modal).toContain('mode: "persisted"');
    expect(modal).toContain('mode: "draft"');
    expect(modal).toContain("initialSelection: DraftItemImage | null");
    expect(modal).toContain("onDraftChanged: (selection: DraftItemImage) => void");
  });

  it("fully resets repeated intake to a blank Standard item", () => {
    const source = readFileSync("src/app/(app)/items/new-item-sheet.tsx", "utf8");

    expect(source).toContain('setKind("standard")');
    expect(source).toContain("setImageDraft(null)");
    expect(source).toContain("serializedRef.current?.reset()");
    expect(source).toContain("bulkRef.current?.reset()");
    expect(source).toContain('if (mode === "another")');
    expect(source).toContain("resetAll()");
  });
});
