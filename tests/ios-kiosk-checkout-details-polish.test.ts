import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS kiosk checkout details polish", () => {
  it("models checkout setup as either ad hoc or linked to an event", () => {
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");

    expect(checkout).toContain("@State private var isLinkedToEvent = false");
    // Linking happens by tapping an event in the list, not by flipping a
    // toggle that hid the entire calendar behind a switch.
    expect(checkout).not.toContain('Toggle("Link to event"');
    expect(checkout).toContain("private func toggle(_ event: KioskCheckoutEvent)");
    expect(checkout).toContain("isLinkedToEvent ? selectedEvent != nil : !trimmedCustomPurpose.isEmpty");
    expect(checkout).toContain("let eventId = isLinkedToEvent ? selectedEvent?.id : nil");
    expect(checkout).toContain("let purpose = !isLinkedToEvent && !trimmedCustomPurpose.isEmpty ? trimmedCustomPurpose : nil");
    expect(checkout).toContain("eventId: eventId");
    expect(checkout).toContain("customPurpose: purpose");
    expect(checkout).toContain(".onChange(of: isLinkedToEvent)");
    expect(checkout).toContain("customPurpose = \"\"");
    expect(checkout).not.toContain("person.crop.circle.badge.checkmark");
  });

  it("puts booking name in context and return time in its own window before scanning", () => {
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");

    expect(checkout).toContain("private var checkoutLayout: some View");
    expect(checkout).toContain("activeScanZone");
    expect(checkout).toContain("KioskCheckoutContextSummary(");
    expect(checkout).toContain("KioskAdaptiveSplit { _ in");
    expect(checkout).toContain("KioskSideRail(isCompact: isCompact)");
    expect(checkout).toContain("checkoutContextSetupZone");
    expect(checkout).toContain("KioskCheckoutSetupPanel(");
    expect(checkout).toContain("private struct KioskCheckoutSetupPanel");
    expect(checkout).toContain("KioskCheckoutSetupHero");
    expect(checkout).toContain("private struct KioskCheckoutWindow");
    expect(checkout).toContain("static let maxWidth: CGFloat = 1048");
    // Columns split the bounded width evenly. The old fixed 376/648 pair
    // sized the return column for a month calendar that no longer exists.
    expect(checkout).not.toContain("contextColumnWidth");
    expect(checkout).not.toContain("returnColumnWidth");
    expect(checkout).not.toContain("returnDateWidth");
    expect(checkout).toContain("ViewThatFits(in: .vertical)");
    expect(checkout).toContain("ViewThatFits(in: .horizontal)");
    expect(checkout).toContain("HStack(alignment: .top, spacing: KioskSpacing.lg) {");
    expect(checkout).toContain("KioskCheckoutContextWindow(");
    expect(checkout).toContain("KioskCheckoutReturnWindow(dueBackAt: $dueBackAt");
    // Setup headings ask the question the step answers.
    expect(checkout).toContain(`title: "What's this for?"`);
    expect(checkout).toContain(`KioskCheckoutWindow(title: "When's it back?")`);
    expect(checkout).toContain("KioskCheckoutEventRow(");
    // The requester's own published shifts lead; the rest of the calendar
    // follows in the same column. No "All Events" popover menu.
    expect(checkout).toContain("private struct KioskCheckoutEventPicker");
    expect(checkout).toContain('group("Your shifts", events: myShifts)');
    expect(checkout).toContain('group("All events", events: otherEvents)');
    expect(checkout).not.toContain('"All Events"');
    expect(checkout).toContain('"Booking name"');
    expect(checkout).toContain("KioskNativeTextField(");
    expect(checkout).toContain('"Return time"');
    expect(checkout).toContain(".contentShape(Rectangle())");
    expect(checkout).toContain(".buttonStyle(.plain)");
    expect(checkout).toContain(".frame(maxWidth: .infinity, maxHeight: .infinity)");
    expect(checkout).not.toContain('KioskCheckoutWindow(title: "Details")');
    expect(checkout).not.toContain("KioskCheckoutDetailsWindow");
    expect(checkout).not.toContain('"Ad hoc checkout"');
    expect(checkout).not.toContain('"No event linked"');
    expect(checkout).not.toContain("setupStep(");
    expect(checkout).not.toContain("returnColumnMinWidth");
    expect(checkout).toContain("VStack(alignment: .leading, spacing: KioskSpacing.lg) {");
    expect(checkout).not.toContain("KioskCheckoutPurposeSection");
    expect(checkout).not.toContain("KioskCheckoutEventChoiceButton(");
    expect(checkout).not.toContain(".buttonStyle(KioskPressStyle())");
  });

  it("surfaces return date and time as deliberate, separate native pickers", () => {
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");

    expect(checkout).toContain("private struct KioskCheckoutReturnDatePicker");
    // No one-tap presets. An easy default is the one people press to get past
    // the screen, and a due date nobody chose is a due date nobody honours --
    // both fields are always visible and always require a deliberate choice.
    expect(checkout).not.toContain("KioskReturnPreset");
    expect(checkout).not.toContain("KioskChoiceChip(");

    // Custom reveals two separate native compact pickers -- one for the date,
    // one for the time. The time bridge exposes UIDatePicker's real 15-minute
    // interval instead of making staff scroll minute by minute.
    // The previous inline UICalendarView (300pt) and wheel
    // (180pt) were both `.clipped()` inside a card too short to hold them and
    // visibly overlapped on device.
    expect(checkout).toContain("displayedComponents: .date");
    expect(checkout).toContain("KioskQuarterHourTimePicker(");
    expect(checkout).toContain(".datePickerStyle(.compact)");
    expect(checkout).not.toContain("KioskUICalendarPicker");
    expect(checkout).not.toContain("KioskUIDatePicker");
    expect(checkout).not.toContain("UICalendarView()");
    expect(checkout).not.toContain(".datePickerStyle(.graphical)");
    expect(checkout).not.toContain(".datePickerStyle(.wheel)");

    // Linked-event defaults land 90 minutes after the schedule end so tear-down
    // time is not identical to the time people glance past and ignore.
    expect(checkout).toContain("static let linkedEventReturnBuffer: TimeInterval = 90 * 60");
    expect(checkout).toContain("dueBackDate(afterEventEndsAt:");
    expect(checkout).toContain("return KioskQuarterHour.roundedUp(proposed)");
    expect(checkout).toContain('"90 minutes after the linked event ends"');
    expect(checkout).not.toContain('"Matches the linked event\'s end time"');

    // Checkout is a stepped flow: details, then scanning. The details step is a
    // screen, not a sheet floating over a scan screen you cannot use yet.
    expect(checkout).toContain("@State private var checkoutContextReady = false");
    expect(checkout).toContain(`title: "Continue to Scan"`);
    expect(checkout).toContain("STEP 1 OF 2");
    expect(checkout).not.toContain("showDetailsSheet");
  });

  it("uses the same quarter-hour return-time control for active checkout edits", () => {
    const components = source("ios/Wisconsin/Kiosk/KioskComponents.swift");
    const detail = source("ios/Wisconsin/Kiosk/KioskCheckoutDetailSheet.swift");

    expect(components).toContain("enum KioskQuarterHour");
    expect(components).toContain("static let minuteInterval = 15");
    expect(components).toContain("picker.minuteInterval = KioskQuarterHour.minuteInterval");
    expect(components).toContain("struct KioskQuarterHourTimePicker: UIViewRepresentable");
    expect(detail).toContain("KioskQuarterHourTimePicker(");
    expect(detail).toContain("selection: clampedEditEndsAt");
    expect(detail).toContain("displayedComponents: .date");
  });
});
