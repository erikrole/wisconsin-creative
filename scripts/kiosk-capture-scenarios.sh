#!/usr/bin/env bash
# Capture every DEBUG kiosk fixture scenario (KioskFixtureScenario in
# ios/Wisconsin/KioskOnly/KioskOnlyApp.swift) from one built app on one
# simulator, so before/after review pairs share device, runtime, and clock hour.
#
# Usage: scripts/kiosk-capture-scenarios.sh <path/to/Wisconsin Kiosk.app> <out-dir> [scenario...]
# Env:   KIOSK_SIM_UDID  simulator UDID (default: first available "iPad Air 11-inch (M4)"
#                        on iOS 26.5, the closest simulator to the fleet's M2 iPad Air 11-inch)
#        KIOSK_SETTLE    seconds to wait after launch before capture (default 4)
set -euo pipefail

APP="${1:?app path required}"
OUT="${2:?output dir required}"
shift 2

BUNDLE_ID="com.erikrole.WisconsinKiosk"
SETTLE="${KIOSK_SETTLE:-4}"
UDID="${KIOSK_SIM_UDID:-$(xcrun simctl list devices available 'iPad Air 11-inch (M4)' \
  | awk '/-- iOS 26.5 --/{f=1;next} /^--/{f=0} f' \
  | grep -oE '[0-9A-F-]{36}' | head -1)}"
[[ -n "$UDID" ]] || { echo "No iPad Air 11-inch (M4) iOS 26.5 simulator available" >&2; exit 1; }

ALL_SCENARIOS=(
  activation resume idle event-detail sleep identity identity-return-other
  operator-hub checkout-sheet inactivity checkout-details checkout-details-linked
  keyboard-tip scanning scan-accepted scanner-help availability-conflicts
  availability-rejected pickup reservation-battery-pickup return return-accepted
  return-for-other badge
)
if [[ $# -gt 0 ]]; then SCENARIOS=("$@"); else SCENARIOS=("${ALL_SCENARIOS[@]}"); fi

mkdir -p "$OUT"
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl ui "$UDID" appearance dark
xcrun simctl status_bar "$UDID" override --time "9:41" --batteryState charged --batteryLevel 100 >/dev/null 2>&1 || true
xcrun simctl uninstall "$UDID" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$UDID" "$APP"

for scenario in "${SCENARIOS[@]}"; do
  SIMCTL_CHILD_GT_KIOSK_SCENARIO="$scenario" \
    xcrun simctl launch --terminate-running-process "$UDID" "$BUNDLE_ID" >/dev/null
  sleep "$SETTLE"
  xcrun simctl io "$UDID" screenshot --type=png "$OUT/$scenario.png" >/dev/null 2>&1
  # The headless simulator stays portrait, so the landscape-only app is
  # letterboxed. Crop to the 1180x820pt landscape band (1640x1140px on the
  # 11-inch portrait framebuffer) so captures read as the mounted counter iPad.
  # A simulator rotated to landscape already captures 2360x1640; only crop
  # the portrait letterbox.
  width=$(sips -g pixelWidth "$OUT/$scenario.png" | awk '/pixelWidth/{print $2}')
  if [[ "${KIOSK_NO_CROP:-0}" != 1 && "$width" == 1640 ]]; then
    sips --cropToHeightWidth 1140 1640 --cropOffset 610 0 "$OUT/$scenario.png" >/dev/null
  fi
  echo "captured $scenario"
done
xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
