import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const replacedProgressLabels = [
  "Saving...",
  "Uploading...",
  "Cancelling...",
  "Sending...",
  "Closing...",
  "Duplicating...",
];

describe("pending action feedback", () => {
  it("keeps booking actions on stable labels with shadcn loading affordances", () => {
    const wizard = source("src/components/booking-wizard/BookingWizard.tsx");
    const header = source("src/components/booking-details/BookingHeader.tsx");
    const editForm = source("src/components/booking-details/BookingEditForm.tsx");

    expect(wizard).toContain("loading={savingDraft}");
    expect(wizard).toContain("loading={submitting}");
    expect(wizard).toContain("Save draft & exit");
    expect(wizard).toContain("{config.actionLabel}");

    expect(header).toContain("function PendingDropdownMenuItem");
    expect(header).toContain("<DropdownMenuGroup>");
    expect(header).toContain("aria-busy={active || undefined}");
    expect(header).toContain("{active ? <Spinner aria-hidden=\"true\" /> : null}");

    expect(editForm).toContain("loading={saving}");
    expect(editForm).toContain("Save changes");

    for (const label of replacedProgressLabels) {
      expect(wizard).not.toContain(label);
      expect(header).not.toContain(label);
      expect(editForm).not.toContain(label);
    }
  });

  it("uses action-specific pending state for image modal mutations", () => {
    const modal = source("src/components/ChooseImageModal.tsx");

    expect(modal).toContain('type ImageSavingAction = "search" | "url" | "upload" | "remove"');
    expect(modal).toContain("const saving = savingAction !== null");
    expect(modal).toContain('setSavingAction("search")');
    expect(modal).toContain('setSavingAction("url")');
    expect(modal).toContain('setSavingAction("upload")');
    expect(modal).toContain('setSavingAction("remove")');
    expect(modal).toContain('loading={savingAction === "search"}');
    expect(modal).toContain('loading={savingAction === "url"}');
    expect(modal).toContain('loading={savingAction === "upload"}');
    expect(modal).toContain('loading={savingAction === "remove"}');

    for (const label of replacedProgressLabels) {
      expect(modal).not.toContain(label);
    }
  });
});
