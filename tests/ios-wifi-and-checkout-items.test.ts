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
