#!/usr/bin/env bash
#
# ios-audit-inventory.sh — list every iOS surface alongside its focused
# audit doc (or NO AUDIT for unaudited surfaces).
#
# Coverage answers "what's been hardened, and when?" at a glance.
# Run after adding a new view to see if you owe an audit doc; run
# before a release to see what hasn't been touched.
#
# Usage:
#   ./scripts/ios-audit-inventory.sh         # full table + coverage stats
#   ./scripts/ios-audit-inventory.sh --gaps  # only show NO AUDIT rows
#   ./scripts/ios-audit-inventory.sh --csv   # machine-readable CSV
#
# Exit codes: --gaps exits 1 when an audit doc is missing or a Swift surface
# is unregistered. Full-table and CSV modes remain informational.

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IOS_DIR="$REPO_ROOT/ios/Wisconsin"
TASKS_DIR="$REPO_ROOT/tasks"

if [ ! -d "$IOS_DIR" ]; then
  echo "error: $IOS_DIR not found" >&2
  exit 2
fi

MODE="full"
for arg in "$@"; do
  case "$arg" in
    --gaps) MODE="gaps" ;;
    --csv) MODE="csv" ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# //'
      exit 0
      ;;
  esac
done

# ─── Surface registry ───
# Format: "<swift_filename>|<expected_audit_slug>|<status>"
#   <status> one of:
#     audit            — should have a focused audit doc
#     exempt-shared    — shared sub-component, audited via consumers
#     exempt-infra     — non-UI infrastructure (models, stores, API clients)
#     exempt-tiny      — single-purpose primitive, no focused audit needed
#
# When you add a new view, add a row here. When you ship an audit doc, the
# script auto-detects it via `<expected_audit_slug>`.

read -r -d '' REGISTRY <<'EOF' || true
# View / sheet                         | audit slug                  | status
HomeView.swift                         | dashboard                   | audit
BookingsView.swift                     | bookings                    | audit
BookingDetailView.swift                | booking-detail              | audit
CreateBookingSheet.swift               | create-booking              | audit
ExtendBookingSheet.swift               | extend-booking              | audit
BrowseView.swift                       | browse                      | audit
ItemsView.swift                        | items                       | audit
ItemDetailView.swift                   | item-detail                 | audit
ScheduleView.swift                     | schedule                    | audit
EventDetailSheet.swift                 | event-detail                | audit
NotificationsSheet.swift               | notifications-sheet         | audit
OverdueReportView.swift                | overdue-report              | audit
ReportsView.swift                      | reports                     | audit
LoginView.swift                        | login                       | audit
NativeAuthViews.swift                  | login                       | audit
PasswordSetupView.swift                | login                       | audit
LaunchView.swift                       |                             | exempt-tiny
Welcome/ProfileCompletionWelcomeView.swift | welcome                  | audit
Welcome/ProfilePhotoCropView.swift     | welcome                     | audit
Welcome/ProfileCompletionDraft.swift   |                             | exempt-infra
Welcome/ProfileCompletionWelcomeComponents.swift |                   | exempt-shared
UsersView.swift                        | users                       | audit
UserDetailView.swift                   | users                       | audit
AppTabView.swift                       | profile                     | audit
ProfileView.swift                      | profile                     | audit
ProfileNextUp.swift                    | profile                     | audit
ScoreboardView.swift                   | profile                     | audit
TeamScoreboardView.swift               | team-scoreboard              | audit
SettingsView.swift                     | profile                     | audit
LicensesView.swift                     | licenses                    | audit
GuidesView.swift                       | resources                   | audit
GuideMarkdown.swift                    |                             | exempt-infra
SidebarWebDestinationView.swift        |                             | exempt-tiny
NotificationSettingsView.swift         | profile                     | audit
AccountSecuritySettingsView.swift      | profile                     | audit
AvailabilityView.swift                 | schedule                    | audit
AccountAvatar.swift                    |                             | exempt-shared
ScanPrePromptView.swift                | scan                        | audit
PushPrePromptView.swift                | profile                     | audit
CreateBooking/CreateBookingEventViews.swift  | create-booking              | audit
CreateBooking/CreateBookingEquipmentPicker.swift  | create-booking         | audit
CreateBooking/CreateBookingEquipmentRows.swift  |                            | exempt-shared
CreateBooking/CreateBookingFormRows.swift  |                                | exempt-shared
CreateBooking/CreateBookingPickers.swift  |                                 | exempt-shared
CreateBooking/CreateBookingViewModel.swift  |                               | exempt-infra
DevTools/LinkStickerWizard.swift       | link-sticker-wizard         | audit
DevTools/ScannerDebuggerView.swift     | scanner-debugger            | audit
Schedule/PostTradeSheet.swift          | post-trade                  | audit
Schedule/TradeBoardSheet.swift         | trade-board                 | audit
Schedule/AddShiftSheet.swift           | add-shift                   | audit
Schedule/AssignStudentSheet.swift      | assign-student              | audit
Search/GlobalSearchSheet.swift         | global-search               | audit
Search/QRScannerSheet.swift            | scan                        | audit
Kiosk/KioskActivationView.swift        | kiosk-activation            | audit
Kiosk/KioskIdleView.swift              | kiosk-idle                  | audit
Kiosk/KioskOperatorHubView.swift       | kiosk-operator-hub          | audit
Kiosk/KioskIdentityView.swift          | kiosk-flow-routing          | audit
Kiosk/KioskCheckoutView.swift          | kiosk-checkout              | audit
Kiosk/KioskPickupView.swift            | kiosk-pickup                | audit
Kiosk/KioskReturnView.swift            | kiosk-return                | audit
Kiosk/KioskSuccessView.swift           | kiosk-success               | audit
Kiosk/KioskShellView.swift             | kiosk                       | audit
Kiosk/KioskBarcodeCameraView.swift     | kiosk-checkout              | audit
Kiosk/KioskCheckoutDetailSheet.swift   | kiosk-idle                  | audit
Kiosk/KioskEventDetailSheet.swift      | kiosk-idle                  | audit
Kiosk/KioskSleepModeView.swift         | kiosk-idle                  | audit
Kiosk/KioskChrome.swift                |                             | exempt-shared
Kiosk/KioskIdleRoster.swift            |                             | exempt-shared
Kiosk/KioskDateFormatting.swift        |                             | exempt-infra
Components/BannerView.swift            |                             | exempt-shared
Components/BlastBanner.swift           |                             | exempt-shared
Components/CrewRow.swift               |                             | exempt-shared
Components/ReservationDraftCard.swift  |                             | exempt-shared
Components/Skeleton.swift              |                             | exempt-shared
Components/StatusPill.swift            |                             | exempt-shared
Components/Toast.swift                 |                             | exempt-shared
Components/UserAvatarView.swift        |                             | exempt-shared
Search/FloatingSearchButton.swift      |                             | exempt-tiny
Search/ScanResultHeroCard.swift        |                             | exempt-shared
Search/SearchResultRow.swift           |                             | exempt-shared
Shared/HIDScannerField.swift           |                             | exempt-shared
Kiosk/KioskNativeTextField.swift       |                             | exempt-shared
Kiosk/KioskAPIClient.swift             |                             | exempt-infra
Kiosk/KioskColors.swift                |                             | exempt-infra
Kiosk/KioskDesign.swift                |                             | exempt-infra
Kiosk/KioskComponents.swift            |                             | exempt-shared
Kiosk/KioskModels.swift                |                             | exempt-infra
Kiosk/KioskStore.swift                 |                             | exempt-infra
Kiosk/KioskFlowRouting.swift           |                             | exempt-infra
EOF

# ─── Discover Swift files actually present ───
PRESENT_LIST=$(mktemp "${TMPDIR:-/tmp}/ios-audit-inv-present.XXXXXX")
trap 'rm -f "$PRESENT_LIST"' EXIT
( cd "$IOS_DIR" && find Views Kiosk -type f -name '*.swift' -print 2>/dev/null \
    | sed 's|^Views/||' \
    | sed 's|^Kiosk/|Kiosk/|' \
    | LC_ALL=C sort ) > "$PRESENT_LIST"

# Pull out comment + blank lines from REGISTRY.
REGISTRY_BODY=$(printf '%s\n' "$REGISTRY" \
  | grep -v '^[[:space:]]*#' \
  | grep -v '^[[:space:]]*$' \
  | sed 's/[[:space:]]*|[[:space:]]*/|/g')

audit_total=0
audit_have=0
audit_missing=0
exempt_total=0
unknown_total=0

declare_row() {
  printf '%s\n' "$1"
}

# Find the most recent dated entry inside an audit doc. Looks for "— YYYY-MM-DD" on the H1.
audit_date_for() {
  local slug="$1"
  local doc="$TASKS_DIR/audit-${slug}-ios.md"
  if [ ! -f "$doc" ]; then
    echo ""
    return
  fi
  # Try the H1 first, then anywhere in the file as fallback.
  local d
  d=$(head -1 "$doc" | grep -oE '20[0-9]{2}-[0-9]{2}-[0-9]{2}' | head -1)
  if [ -z "$d" ]; then
    d=$(grep -oE '20[0-9]{2}-[0-9]{2}-[0-9]{2}' "$doc" | head -1)
  fi
  echo "$d"
}

# ─── Header / output prep ───
if [ "$MODE" = "csv" ]; then
  echo "file,audit_slug,status,audit_date"
elif [ "$MODE" = "full" ]; then
  printf "%-44s  %-22s  %-10s  %s\n" "FILE" "AUDIT" "STATUS" "DATE"
  printf "%-44s  %-22s  %-10s  %s\n" "──────────────────────────────" "─────────────────" "──────────" "──────────"
fi

# ─── Walk the registry; emit a row per entry. ───
while IFS='|' read -r file slug status; do
  [ -z "$file" ] && continue

  # Confirm the file actually exists.
  rel_path="$file"
  full="$IOS_DIR/Views/$rel_path"
  if [ ! -f "$full" ]; then
    full="$IOS_DIR/$rel_path"
  fi
  if [ ! -f "$full" ]; then
    # Registry has a stale entry — flag.
    if [ "$MODE" = "csv" ]; then
      echo "$file,$slug,registry-stale,"
    elif [ "$MODE" = "full" ] || [ "$MODE" = "gaps" ]; then
      printf "%-44s  %-22s  %-10s  %s\n" "$file" "$slug" "STALE" "registry entry without file"
    fi
    continue
  fi

  case "$status" in
    audit)
      audit_total=$((audit_total + 1))
      d=$(audit_date_for "$slug")
      if [ -n "$d" ]; then
        audit_have=$((audit_have + 1))
        if [ "$MODE" = "csv" ]; then
          echo "$file,$slug,covered,$d"
        elif [ "$MODE" = "full" ]; then
          printf "%-44s  %-22s  %-10s  %s\n" "$file" "$slug" "✓" "$d"
        fi
      else
        audit_missing=$((audit_missing + 1))
        if [ "$MODE" = "csv" ]; then
          echo "$file,$slug,no-audit,"
        elif [ "$MODE" = "full" ] || [ "$MODE" = "gaps" ]; then
          printf "%-44s  %-22s  %-10s  %s\n" "$file" "$slug" "✗" "NO AUDIT DOC"
        fi
      fi
      ;;
    exempt-*)
      exempt_total=$((exempt_total + 1))
      if [ "$MODE" = "csv" ]; then
        echo "$file,,$status,"
      elif [ "$MODE" = "full" ]; then
        printf "%-44s  %-22s  %-10s  %s\n" "$file" "—" "$status" "—"
      fi
      ;;
    *)
      unknown_total=$((unknown_total + 1))
      if [ "$MODE" = "csv" ]; then
        echo "$file,$slug,unknown-status,"
      elif [ "$MODE" = "full" ] || [ "$MODE" = "gaps" ]; then
        printf "%-44s  %-22s  %-10s  %s\n" "$file" "$slug" "?" "unknown status"
      fi
      ;;
  esac
done <<EOF
$REGISTRY_BODY
EOF

# ─── Find files NOT in the registry (new surfaces that need a row) ───
unregistered_total=0
while IFS= read -r f; do
  if ! printf '%s\n' "$REGISTRY_BODY" | cut -d'|' -f1 | grep -Fxq "$f"; then
    unregistered_total=$((unregistered_total + 1))
    if [ "$MODE" = "csv" ]; then
      echo "$f,,unregistered,"
    elif [ "$MODE" = "full" ] || [ "$MODE" = "gaps" ]; then
      printf "%-44s  %-22s  %-10s  %s\n" "$f" "?" "NEW" "add to registry in $0"
    fi
  fi
done < "$PRESENT_LIST"

# ─── Summary ───
if [ "$MODE" = "csv" ]; then
  exit 0
fi

echo
if [ "$audit_total" -gt 0 ]; then
  pct=$(( audit_have * 100 / audit_total ))
else
  pct=0
fi

echo "═══════════════════════════════════════════════════════════════"
printf "Audit-worthy surfaces:    %d\n" "$audit_total"
printf "  ✓ Covered:              %d  (%d%%)\n" "$audit_have" "$pct"
printf "  ✗ Missing audit:        %d\n" "$audit_missing"
printf "Exempt (shared/infra):    %d\n" "$exempt_total"
if [ "$unregistered_total" -gt 0 ]; then
  printf "⚠ Unregistered (NEW):     %d  (add to %s)\n" "$unregistered_total" "$(basename "$0")"
fi
echo "═══════════════════════════════════════════════════════════════"

if [ "$MODE" = "gaps" ] && [ "$audit_missing" = "0" ] && [ "$unregistered_total" = "0" ]; then
  echo "✓ no audit gaps"
elif [ "$MODE" = "gaps" ]; then
  exit 1
fi
