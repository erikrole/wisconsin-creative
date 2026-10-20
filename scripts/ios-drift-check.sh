#!/usr/bin/env bash
#
# ios-drift-check.sh — flag regressions of the cross-cutting iOS patterns
# shipped during the 2026-05-08 audit sprint.
#
# Reads `docs/IOS_PATTERNS.md` for context. Each rule maps to a specific
# anti-pattern that we eliminated and don't want creeping back.
#
# Usage:
#   ./scripts/ios-drift-check.sh             # scan everything, exit non-zero on findings
#   ./scripts/ios-drift-check.sh --warn      # report findings but always exit 0
#   ./scripts/ios-drift-check.sh -v          # verbose
#
# Designed for cheap CI use: portable POSIX grep + find, no Xcode dependency.

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IOS_DIR="$REPO_ROOT/ios/Wisconsin"

if [ ! -d "$IOS_DIR" ]; then
  echo "error: $IOS_DIR not found" >&2
  exit 2
fi

WARN_ONLY=0
VERBOSE=0
for arg in "$@"; do
  case "$arg" in
    --warn) WARN_ONLY=1 ;;
    -v) VERBOSE=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# //'
      exit 0
      ;;
  esac
done

VIEWS_DIR="$IOS_DIR/Views"
KIOSK_DIR="$IOS_DIR/Kiosk"
TOTAL_FILES=$(find "$VIEWS_DIR" "$KIOSK_DIR" -type f -name '*.swift' | wc -l | tr -d ' ')

if [ "$TOTAL_FILES" = "0" ]; then
  echo "error: no .swift files found under Views/ or Kiosk/" >&2
  exit 2
fi

violations=0
report_file=$(mktemp "${TMPDIR:-/tmp}/ios-drift-check.XXXXXX")
trap 'rm -f "$report_file"' EXIT

# rule(<id>, <description>, <ERE pattern>, [exclude_path_substr…])
# Excludes are matched as suffix substrings against each file path.
rule() {
  id="$1"; shift
  desc="$1"; shift
  pat="$1"; shift

  # Build the find expression to filter excludes.
  excludes_args=""
  for ex in "$@"; do
    excludes_args="$excludes_args ! -path '*$ex'"
  done

  if [ "$VERBOSE" = "1" ]; then
    echo "→ $id" >&2
  fi

  # eval is needed to expand the dynamically built path-exclusion args.
  hits=$(eval "find '$VIEWS_DIR' '$KIOSK_DIR' -type f -name '*.swift'$excludes_args -print0" \
    | xargs -0 grep -E -n -H "$pat" 2>/dev/null || true)

  if [ -n "$hits" ]; then
    hits=$(printf '%s\n' "$hits" | sed "s|^$REPO_ROOT/||")
    count=$(printf '%s\n' "$hits" | grep -c . || true)
    violations=$((violations + count))
    {
      printf '──── %s  (%d hit%s) ────\n' "$id" "$count" "$([ "$count" = "1" ] || echo s)"
      printf '%s\n' "$desc"
      printf '%s\n' "$hits"
      echo
    } >> "$report_file"
  fi
}

# ─── R1. Raw status colors in Views ───
# The status taxonomy colors (.red / .green / .blue / .orange / .purple) used
# directly are the regression target. Use Color.statusText/.statusBackground.
# `.yellow` is allowed — torch + favorite star both use it iconically.
# AddShiftSheet's picker enums are paired with title-case labels (no colored
# text directly), so it's exempted.
rule R1-status-color-literal \
  "Raw status color literal in Views (use Color.statusText/.statusBackground instead)" \
  '\.(foregroundStyle|fill|tint|background)\(\.(red|green|blue|orange|purple)\)' \
  AddShiftSheet.swift

# ─── R2. UIKit notification haptic bypassing centralized Haptics enum ───
rule R2-direct-uikit-haptic \
  "Direct UINotificationFeedbackGenerator() call (use Haptics.success/.error/.warning/.tap)" \
  'UINotificationFeedbackGenerator[[:space:]]*\([[:space:]]*\)'

# ─── R3. Silent server-error swallow in API helpers ───
# Both kiosk pickup-confirm and checkin-complete had this P0 phantom-success bug.
rule R3-tryq-session-data \
  "try? await session.data(...) silently drops API failures (route through perform)" \
  'try\?[[:space:]]+await[[:space:]]+session\.data'

# ─── R4. .onTapGesture on a row that triggers state mutation ───
# Heuristic: an onTapGesture closure containing an `=` (assignment).
# Buttons are preferred for VoiceOver actionable role + press feedback.
rule R4-ontapgesture-on-row \
  ".onTapGesture { …assignment } in lieu of a Button (VoiceOver may miss the actionable role)" \
  '\.onTapGesture[[:space:]]*\{[^}]*=[[:space:]]*'

# ─── R5. UIImpactFeedbackGenerator outside Core/Haptics.swift ───
rule R5-uikit-haptic-impact \
  "UIImpactFeedbackGenerator() outside Core/Haptics.swift (Haptics.tap covers this)" \
  'UIImpactFeedbackGenerator[[:space:]]*\(' \
  Core/Haptics.swift

# ─── R6. Server-typed shift area used in user-visible Text without .shiftAreaLabel ───
# After today's title-case sweep, every user-visible call uses .shiftAreaLabel.
# Models/ + AddShiftSheet picker enums are exempt.
rule R6-bare-shift-area \
  "Text(...area...) without .shiftAreaLabel — server tokens shouldn't render shouty" \
  'Text\([^)]*\.area([[:space:]]|\))' \
  AddShiftSheet.swift

# ─── R7. Switch arm raw status colors (R1's blind spot) ───
# R1 catches `.foregroundStyle(.red)` but misses the SwiftUI implicit-return
# pattern: `private var color: Color { switch x { case .a: .green … } }` —
# the `.green` there isn't on a modifier expression, so R1 doesn't see it.
# Today's items-list audit caught this in AssetListBadge + AssetStatusBadge.
#
# Limited to the *implicit-return* form (`case .foo: .green` without the
# `return` keyword) because the `return .green` form is ambiguous — it
# could be `return Color.green` (drift) or `return StatusTone.green`
# (legitimate; e.g. NotificationsSheet.notifTone returns StatusTone?).
# `Color.statusText(.green)` doesn't match because `Color` separates the
# case-arm from the `.green`.
rule R7-switch-arm-status-color \
  "switch arm immediately followed by raw status color — wrap in Color.statusText/.statusBackground" \
  'case[[:space:]]+\.[a-zA-Z_]+:[[:space:]]+\.(red|green|blue|orange|purple)([[:space:]]|$)'

# ─── Output ───
if [ "$violations" = "0" ]; then
  printf '✓ ios-drift-check: no anti-patterns found across %d swift files\n' "$TOTAL_FILES"
  exit 0
fi

printf '\n✗ ios-drift-check: %d anti-pattern hit%s across %d swift files\n' \
  "$violations" "$([ "$violations" = "1" ] || echo s)" "$TOTAL_FILES"
echo "  See docs/IOS_PATTERNS.md for the full reference. Each rule is listed below."
echo
cat "$report_file"

if [ "$WARN_ONLY" = "1" ]; then
  echo "(--warn supplied; exiting 0 anyway)"
  exit 0
fi
exit 1
