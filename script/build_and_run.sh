#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="Wisconsin Creative"
BUNDLE_ID="com.erikrole.GearOps"
PROJECT="macos/GearOps.xcodeproj"
SCHEME="GearOps"
DERIVED_DATA="/private/tmp/wisconsin-creative-gearops-run"
APP_BUNDLE="$DERIVED_DATA/Build/Products/Debug/$APP_NAME.app"

case "$MODE" in
  run|--debug|debug|--logs|logs|--telemetry|telemetry|--verify|verify)
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac

pkill -x "$APP_NAME" >/dev/null 2>&1 || true

xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Debug \
  -destination 'platform=macOS' \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build \
  -quiet

if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "Build completed without producing $APP_BUNDLE" >&2
  exit 1
fi

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
