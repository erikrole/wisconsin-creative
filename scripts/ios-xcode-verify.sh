#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SCHEME="${IOS_SCHEME:-Wisconsin}"
CONFIGURATION="${IOS_CONFIGURATION:-Debug}"
DERIVED_DATA_PATH="${IOS_DERIVED_DATA_PATH:-${TMPDIR:-/tmp}/gear-tracker-xcode-derived-data}"
PROJECT_PATH="ios/Wisconsin.xcodeproj"
XCODEBUILD_FLAGS=()

if [[ "$SCHEME" == "WisconsinKiosk" ]]; then
  SIMULATOR_NAME="${IOS_SIMULATOR_NAME:-iPad (A16)}"
else
  SIMULATOR_NAME="${IOS_SIMULATOR_NAME:-iPhone 16 Pro}"
fi

# Resolve a simulator UDID by exact device name.
#
# `platform=iOS Simulator,name=<device>,OS=latest` resolves the name against the
# newest installed runtime only, so a device that exists solely under an older
# runtime never matches — the iPhone 16 Pro required by AGENTS.md is installed
# on iOS 26.5 while iOS 27.0 is also present, and the `name=` form fails with
# "Unable to find a device matching the provided destination specifier".
# Matching UDIDs out of `xcrun simctl list devices available` avoids that:
# prefer a booted device, otherwise the newest runtime that has one.
resolve_simulator_udid() {
  local device_name="$1"
  xcrun simctl list devices available 2>/dev/null | awk -v name="$device_name" '
    function vercmp(a, b,   as, bs, na, nb, i, x, y, n) {
      na = split(a, as, ".")
      nb = split(b, bs, ".")
      n = (na > nb) ? na : nb
      for (i = 1; i <= n; i++) {
        x = (i <= na) ? as[i] + 0 : 0
        y = (i <= nb) ? bs[i] + 0 : 0
        if (x > y) return 1
        if (x < y) return -1
      }
      return 0
    }
    /^-- .* --$/ {
      header = $0
      sub(/^-- /, "", header)
      sub(/ --$/, "", header)
      split(header, parts, " ")
      runtime_os = parts[1]
      runtime_version = parts[2]
      next
    }
    runtime_os == "iOS" {
      line = $0
      sub(/^[ \t]+/, "", line)
      sub(/[ \t]+$/, "", line)
      # Device names can contain parentheses ("iPad (A16)"), so anchor on the
      # exact name followed by the UDID group rather than splitting on "(".
      prefix = name " ("
      if (index(line, prefix) != 1) next
      rest = substr(line, length(prefix) + 1)
      close_at = index(rest, ")")
      if (close_at == 0) next
      udid = substr(rest, 1, close_at - 1)
      if (index(substr(rest, close_at + 1), "(Booted)") > 0) {
        if (booted_udid == "" || vercmp(runtime_version, booted_version) > 0) {
          booted_udid = udid
          booted_version = runtime_version
        }
      } else if (any_udid == "" || vercmp(runtime_version, any_version) > 0) {
        any_udid = udid
        any_version = runtime_version
      }
    }
    END { print (booted_udid != "") ? booted_udid : any_udid }
  '
}

if [[ -n "${IOS_TEST_DESTINATION:-}" ]]; then
  TEST_DESTINATION="$IOS_TEST_DESTINATION"
  TEST_DESTINATION_LABEL="$TEST_DESTINATION (IOS_TEST_DESTINATION)"
else
  SIMULATOR_UDID="$(resolve_simulator_udid "$SIMULATOR_NAME")" || SIMULATOR_UDID=""
  if [[ -z "$SIMULATOR_UDID" ]]; then
    printf '\nFAIL: no available "%s" simulator found.\n' "$SIMULATOR_NAME" >&2
    printf 'AGENTS.md fixes this destination. Install the missing device/runtime rather\n' >&2
    printf 'than substituting another simulator, or set IOS_SIMULATOR_NAME /\n' >&2
    printf 'IOS_TEST_DESTINATION deliberately.\n\n' >&2
    xcrun simctl list devices available >&2 || true
    exit 1
  fi
  TEST_DESTINATION="platform=iOS Simulator,id=$SIMULATOR_UDID"
  TEST_DESTINATION_LABEL="$TEST_DESTINATION ($SIMULATOR_NAME)"
fi

if [[ "${IOS_XCODEBUILD_VERBOSE:-0}" != "1" ]]; then
  XCODEBUILD_FLAGS+=("-quiet")
fi

# Expansions below use ${ARR[@]+"${ARR[@]}"}: under `set -u`, bash 3.2 — the
# system bash this runs on — treats "${ARR[@]}" as an unbound variable when the
# array is empty, which is exactly the IOS_XCODEBUILD_VERBOSE=1 case.

# Every gate runs through run_step, which checks the child status explicitly and
# aborts. Do not rely on `set -e` alone here: it is silently suppressed whenever
# a call lands in a condition, `&&`/`||` chain, or pipeline, which is how a
# failing gate can otherwise be reported as a passing run.
run_step() {
  local label="$1"
  shift
  printf '\n== %s ==\n' "$label"
  local status=0
  "$@" || status=$?
  if [[ "$status" -ne 0 ]]; then
    printf '\nFAIL: %s exited with status %d.\n' "$label" "$status" >&2
    exit "$status"
  fi
}

printf 'iOS Xcode verification\n'
printf 'Project: %s\n' "$PROJECT_PATH"
printf 'Scheme: %s\n' "$SCHEME"
printf 'Configuration: %s\n' "$CONFIGURATION"
printf 'DerivedData: %s\n' "$DERIVED_DATA_PATH"
printf 'Test destination: %s\n' "$TEST_DESTINATION_LABEL"

if [[ "${IOS_SKIP_PROJECT_CHECK:-0}" != "1" ]]; then
  run_step "XcodeGen project drift" npm run ios:project:check
fi

if [[ "${IOS_SKIP_STATIC_GATES:-0}" != "1" ]]; then
  run_step "iOS drift check" npm run drift:ios
  run_step "iOS gap audit" npm run audit:ios:gaps
fi

run_step "Xcode simulator build" \
  xcodebuild \
    ${XCODEBUILD_FLAGS[@]+"${XCODEBUILD_FLAGS[@]}"} \
    -project "$PROJECT_PATH" \
    -scheme "$SCHEME" \
    -destination "generic/platform=iOS Simulator" \
    -configuration "$CONFIGURATION" \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    build

if [[ "${IOS_SKIP_TESTS:-0}" != "1" ]]; then
  run_step "XCTest simulator suite" \
    xcodebuild \
      ${XCODEBUILD_FLAGS[@]+"${XCODEBUILD_FLAGS[@]}"} \
      -project "$PROJECT_PATH" \
      -scheme "$SCHEME" \
      -destination "$TEST_DESTINATION" \
      -configuration "$CONFIGURATION" \
      -derivedDataPath "$DERIVED_DATA_PATH" \
      test
fi

if [[ "${IOS_SKIP_DEVICE_BUILD:-0}" != "1" ]]; then
  run_step "Xcode generic iOS build" \
    xcodebuild \
      ${XCODEBUILD_FLAGS[@]+"${XCODEBUILD_FLAGS[@]}"} \
      -project "$PROJECT_PATH" \
      -scheme "$SCHEME" \
      -destination "generic/platform=iOS" \
      -configuration "$CONFIGURATION" \
      -derivedDataPath "$DERIVED_DATA_PATH" \
      build
fi

printf '\nOK: iOS Xcode verification passed for %s.\n' "$SCHEME"
