import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  encodeLicenseExpiryDate,
  formatLicenseExpiryDate,
  isLicenseExpired,
  licenseDaysUntilExpiry,
  licenseExpiryInputValue,
  localDateKey,
} from "@/lib/license-dates";

describe("license expiry date-only handling", () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = "America/Chicago";
  });

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  const encodedExpiry = "2027-08-18T00:00:00.000Z";

  it("shows the encoded calendar date instead of the prior Central day", () => {
    expect(formatLicenseExpiryDate(encodedExpiry)).toBe("Aug 18, 2027");
    expect(licenseExpiryInputValue(encodedExpiry)).toBe("2027-08-18");
  });

  it("compares expiry against the local calendar day, including the expiry day", () => {
    expect(licenseDaysUntilExpiry(encodedExpiry, new Date("2027-08-17T18:00:00.000Z"))).toBe(1);
    expect(licenseDaysUntilExpiry(encodedExpiry, new Date("2027-08-18T18:00:00.000Z"))).toBe(0);
    expect(isLicenseExpired(encodedExpiry, new Date("2027-08-18T18:00:00.000Z"))).toBe(false);
    expect(isLicenseExpired(encodedExpiry, new Date("2027-08-19T18:00:00.000Z"))).toBe(true);
  });

  it("keeps the 30-day renewal boundary stable", () => {
    expect(licenseDaysUntilExpiry(encodedExpiry, new Date("2027-07-19T18:00:00.000Z"))).toBe(30);
    expect(licenseDaysUntilExpiry(encodedExpiry, new Date("2027-07-18T18:00:00.000Z"))).toBe(31);
  });

  it("keeps date-input encoding explicit and export filenames local", () => {
    expect(encodeLicenseExpiryDate("2027-08-18")).toBe(encodedExpiry);
    expect(localDateKey(new Date("2026-08-19T01:00:00.000Z"))).toBe("2026-08-18");
  });
});
