import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";
import { apiClientSource } from "./_helpers/ios-api-client-source";

describe("iOS Wi-Fi card", () => {
  it("reads the web route and decodes the same fields", () => {
    expect(apiClientSource()).toContain('request(path: "/api/wifi")');
    const models = source("ios/Wisconsin/Models/SoftwareLoginModels.swift");
    for (const field of ["ssid", "password", "qrPayload"]) expect(models).toContain(`let ${field}: String`);
  });

  it("hides the password until shown, keeps copies on this phone, and clears on leave", () => {
    const view = source("ios/Wisconsin/Views/SharedLoginsView.swift");
    expect(view).toContain("showWifiPassword = false");
    expect(view).toContain("CIFilter.qrCodeGenerator()");
    expect(view).toContain("vm.copyWifi(wifi.password");
    expect(view).not.toContain("print(");
  });
});

describe("iOS admin checkout items", () => {
  it("uses the web items route and is gated on the edit-items action", () => {
    const api = apiClientSource();
    expect(api).toContain('request(path: "/api/bookings/\\(bookingId)/items", method: "POST")');
    expect(api).toContain('request(path: "/api/bookings/\\(bookingId)/items", method: "DELETE")');
    expect(api).toContain('request(path: "/api/assets/picker-search"');
    const detail = source("ios/Wisconsin/Views/BookingDetailView.swift");
    expect(detail).toContain('booking?.allows("edit-items") == true');
    expect(detail).toContain("AddCheckoutItemSheet(bookingId: booking.id)");
  });
});

describe("iOS history and person shifts parity", () => {
  it("names admin item edits, scans and swaps in booking history and folds scan bursts", () => {
    const models = source("ios/Wisconsin/Models/BookingActivityModels.swift");
    for (const action of ["checkout_item_added", "checkout_item_removed", "auto_completed_by_item_removal", "kiosk_checkout_item_swapped", "scan_checkout", "scan_checkin", "admin_override"]) {
      expect(models).toContain(`"${action}"`);
    }
    expect(models).toContain("return foldScanBursts(visible)");
    const item = source("ios/Wisconsin/Models/ItemActivityModels.swift");
    expect(item).toContain('case "checkout_item_added":');
    expect(item).toContain('case "checkout_item_removed":');
  });

  it("lists every shift for staff from the web person-sheet route", () => {
    expect(apiClientSource()).toContain('request(path: "/api/users/\\(userId)/shifts")');
    const detail = source("ios/Wisconsin/Views/UserDetailView.swift");
    expect(detail).toContain('return role == "STAFF" || role == "ADMIN"');
    expect(detail).toContain("PersonShiftsLinkCard(userId: detail.id, name: detail.name)");
  });

  it("measures the Wrapped card instead of the deprecated main screen", () => {
    expect(source("ios/Wisconsin/Views/WrappedView.swift")).not.toContain("UIScreen.main");
  });
});
