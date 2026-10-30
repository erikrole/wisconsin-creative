// Shared department Wi-Fi. Server-only: served by /api/wifi to signed-in users, never bundled into client code.
const WIFI_SSID = "creative";
const WIFI_PASSWORD = "bucky2025";

function escapeWifiField(value: string) {
  return value.replace(/([\;,:"])/g, "\\$1");
}

export function getSharedWifi() {
  return {
    ssid: WIFI_SSID,
    password: WIFI_PASSWORD,
    qrPayload: `WIFI:T:WPA;S:${escapeWifiField(WIFI_SSID)};P:${escapeWifiField(WIFI_PASSWORD)};;`,
  };
}
