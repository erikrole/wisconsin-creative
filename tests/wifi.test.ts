import { afterEach, describe, expect, it, vi } from "vitest";
import { getSharedWifi } from "@/lib/wifi";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("shared Wi-Fi", () => {
  it("builds the standard WPA join payload from the environment", () => {
    vi.stubEnv("WIFI_SSID", "creative");
    vi.stubEnv("WIFI_PASSWORD", "pass;word");
    expect(getSharedWifi()).toEqual({
      ssid: "creative",
      password: "pass;word",
      qrPayload: "WIFI:T:WPA;S:creative;P:pass\\;word;;",
    });
  });

  it("is absent until the password is configured", () => {
    vi.stubEnv("WIFI_PASSWORD", "");
    expect(getSharedWifi()).toBeNull();
  });
});
