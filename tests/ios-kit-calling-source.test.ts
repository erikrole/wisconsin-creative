import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("native reservation kit calling", () => {
  it("lets the composer fetch, expand, and submit a kit without renaming the event", () => {
    const api = source("ios/Wisconsin/Core/APIClient.swift");
    const composer = source("ios/Wisconsin/Views/CreateBooking/CreateBookingViewModel.swift");
    const sheet = source("ios/Wisconsin/Views/CreateBookingSheet.swift");
    const protocol = source("ios/Wisconsin/Models/DraftModels.swift");
    const wizard = source("src/components/booking-wizard/BookingWizard.tsx");

    expect(api).toContain("func reservationKits(locationId: String");
    expect(api).toContain("requester_user_id");
    expect(api).toContain("suggestedKitId");
    expect(api).toContain('request(path: "/api/kits"');
    expect(api).toContain("func reservationKitDetail(id: String)");
    expect(api).toContain("let kitId: String?");
    expect(protocol).toContain("kitId: String?");
    expect(composer).toContain("func selectKit(_ id: String)");
    expect(composer).toContain("didApplySuggestedKit");
    expect(composer).toContain("callingKitLabel");
    expect(composer).toContain("kitId: selectedKitId.isEmpty ? nil : selectedKitId");
    expect(composer).toContain("camp randall stadium");
    expect(composer).not.toContain("title = detail.name");
    expect(sheet).toContain("Gameday Kit");
    expect(sheet).toContain("The reservation keeps the event name.");
    expect(wizard).not.toContain("value: selectedKit");
  });
});

describe("kiosk kit calling", () => {
  it("loads kits for the kiosk pickup and records kit provenance without filling the cart", () => {
    const list = source("src/app/api/kiosk/kits/route.ts");
    const detail = source("src/app/api/kiosk/kits/[id]/route.ts");
    const complete = source("src/app/api/kiosk/checkout/complete/route.ts");
    const client = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");

    expect(list).toContain("withKiosk");
    expect(list).toContain("listKits({");
    expect(list).toContain("gamedayRole");
    expect(list).toContain("suggestedKitId");
    expect(detail).toContain("locationsShareKitPickup");
    expect(complete).toContain("if (body.kitId)");
    expect(complete).toContain("loadKitEquipmentPlan");
    expect(client).toContain("func kioskKits(");
    expect(client).toContain("requester_user_id");
    expect(client).toContain("suggestedKitId");
    expect(checkout).toContain("KioskCheckoutKitPicker");
    expect(checkout).toContain("A kit is the scan list");
    expect(checkout).not.toContain("store.setCart(kitMembers");
  });
});
