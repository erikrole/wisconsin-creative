import { describe, expect, it } from "vitest";
import { getSharedWifi } from "@/lib/wifi";

describe("shared Wi-Fi", () => {
  it("builds the standard WPA join payload", () => {
    expect(getSharedWifi().qrPayload).toBe("WIFI:T:WPA;S:creative;P:bucky2025;;");
  });
});
