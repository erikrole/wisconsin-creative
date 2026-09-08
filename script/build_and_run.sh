#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
APP_NAME="Wisconsin Creative"
BUNDLE_ID="com.erikrole.GearOps"
PROJECT="macos/GearOps.xcodeproj"
SCHEME="GearOps"
DERIVED_DATA="/private/tmp/wisconsin-creative-gearops-run"
APP_BUNDLE="$DERIVED_DATA/Build/Products/Release/$APP_NAME.app"

case "$MODE" in
  run|--debug|debug|--logs|logs|--telemetry|telemetry|--verify|verify)
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac

INJECT_DEBUG_ENTITLEMENTS=NO
if [[ "$MODE" == "--debug" || "$MODE" == "debug" ]]; then
  INJECT_DEBUG_ENTITLEMENTS=YES
fi

xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'platform=macOS' \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_INJECT_BASE_ENTITLEMENTS="$INJECT_DEBUG_ENTITLEMENTS" \
  'CODE_SIGN_IDENTITY=Developer ID Application: Erik Role (T26T3G8C7Q)' \
  'PROVISIONING_PROFILE_SPECIFIER=Wisconsin Creative GearOps Developer ID 2026' \
  build \
  -quiet

if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "Build completed without producing $APP_BUNDLE" >&2
  exit 1
fi

/usr/bin/codesign --verify --deep --strict "$APP_BUNDLE"
# Keep the existing app available if compilation or signing fails.
pkill -x "$APP_NAME" >/dev/null 2>&1 || true

open_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

case "$MODE" in
  run)
    open_app
    ;;
  --debug|debug)
    open_app
    sleep 1
    PID="$(pgrep -x "$APP_NAME" | head -1)"
    exec lldb -p "$PID"
    ;;
  --logs|logs)
    open_app
    exec /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    open_app
    exec /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    sleep 1
    pgrep -x "$APP_NAME" >/dev/null
    ;;
esac
