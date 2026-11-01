import { env } from "@/lib/env";

// Shared department Wi-Fi. Server-only: served by /api/wifi to signed-in users, never bundled into client code.
function escapeWifiField(value: string) {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

/** Null until WIFI_PASSWORD is set in the environment. */
export function getSharedWifi() {
  const ssid = env.wifiSsid;
  const password = env.wifiPassword;
  if (!password) return null;
  return {
    ssid,
    password,
    qrPayload: `WIFI:T:WPA;S:${escapeWifiField(ssid)};P:${escapeWifiField(password)};;`,
  };
}
