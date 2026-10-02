import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS kiosk checkout details polish", () => {
  it("models checkout setup as either ad hoc or linked to an event", () => {
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");

    expect(checkout).toContain("@State private var isLinkedToEvent = false");
    // Linking happens by tapping an event in the list, not by flipping a
    // toggle that hid the entire calendar behind a switch.
    expect(checkout).not.toContain('Toggle("Link to event"');
    expect(checkout).toContain("isLinkedToEvent ? selectedEvent != nil : !trimmedCustomPurpose.isEmpty");
    expect(checkout).toContain("let eventId = isLinkedToEvent ? selectedEvent?.id : nil");
    expect(checkout).toContain("let purpose = !isLinkedToEvent && !trimmedCustomPurpose.isEmpty ? trimmedCustomPurpose : nil");
    expect(checkout).toContain("eventId: eventId");
    expect(checkout).toContain("customPurpose: purpose");
    expect(checkout).toContain(".onChange(of: isLinkedToEvent)");
    expect(checkout).toContain("customPurpose = \"\"");
    expect(checkout).not.toContain("person.crop.circle.badge.checkmark");
  });

  it("asks what it's for and when it's back before scanning (redesign D2)", () => {
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");
    const details = source("ios/Wisconsin/Kiosk/KioskCheckoutDetailsStep.swift");

    expect(checkout).toContain("private var checkoutLayout: some View");
    expect(checkout).toContain("KioskCheckoutDetailsStep(");
    expect(checkout).toContain('title: "New checkout"');
    expect(checkout).toContain("step \\(step) of 2");
    expect(details).toContain('Text("What\'s this for?")');
    expect(details).toContain('Text("When\'s it back?")');
    expect(details).toContain('KioskSectionHeader(title: "Your shifts")');
    expect(details).toContain('KioskSectionHeader(title: "Something else")');
    expect(details).toContain("KioskNativeTextField(");
    // Selection is a white outline on list rows.
    expect(details).toContain("stroke: isSelected ? KioskStroke.selected : KioskStroke.standard");
    // Kits are not on the details screen.
    expect(details).not.toMatch(/kit/i);
  });

  it("offers day and time choices with a Back by summary (redesign D2, D3)", () => {
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");
    const details = source("ios/Wisconsin/Kiosk/KioskCheckoutDetailsStep.swift");

    // The 2026-09 removal of one-tap presets is reversed by the approved
    // redesign: day and time chips, with the linked event's suggestion marked.
    // A linked event leads with "After the game"/"After the event"; fixed
    // times stay as alternatives.
    expect(details).toContain('title: Self.isSport(event) ? "After the game" : "After the event"');
    expect(details).toContain("return [after] + fixed.prefix(7)");
    // No event is chosen for the person: only a deep link preselects one (Erik, 2026-10-01).
    expect(details).not.toContain("preselectNextShift");
    expect(details).toContain("Text(Self.displayTitle(event))");
    expect(details).toContain('Text("Something else…")');
    expect(details).toContain("private var choiceName: String?");
    expect(details).toContain("fixed.removeAll { $0.date <= eventEnd }");
    expect(details).toContain('Text("BACK BY")');
    expect(details).toContain('Button("Other date")');
    expect(details).toContain("struct KioskOtherDateSheet");
    expect(details).toContain('var continueTitle: String = "Continue to scan"');
    expect(details).toContain("KioskPrimaryPill(title: continueTitle");
    expect(checkout).toContain("static let linkedEventReturnBuffer: TimeInterval = 90 * 60");
    expect(checkout).toContain("return KioskQuarterHour.roundedUp(proposed)");
    expect(checkout).toContain("@State private var checkoutContextReady = false");
    expect(checkout).not.toContain("showDetailsSheet");
  });

  it("uses the same quarter-hour return-time control for active checkout edits", () => {
    const components = source("ios/Wisconsin/Kiosk/KioskComponents.swift");
    const detail = source("ios/Wisconsin/Kiosk/KioskCheckoutDetailSheet.swift");

    const shared = source("ios/Wisconsin/Shared/QuarterHourTimePicker.swift");

    expect(shared).toContain("enum QuarterHour");
    expect(shared).toContain("static let minuteInterval = 15");
    expect(shared).toContain("picker.minuteInterval = QuarterHour.minuteInterval");
    expect(shared).toContain("struct QuarterHourTimePicker: UIViewRepresentable");
    expect(components).toContain("typealias KioskQuarterHour = QuarterHour");
    expect(components).toContain("struct KioskQuarterHourTimePicker: View");
    expect(detail).toContain("KioskQuarterHourTimePicker(");
    expect(detail).toContain("selection: clampedEditEndsAt");
    expect(detail).toContain("displayedComponents: .date");
  });
});
