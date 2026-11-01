/**
 * One place that says what every audit action means to a person.
 *
 * `AUDIT_ACTION_SENTENCES` gives the plain past-tense sentence (no actor) for
 * actions that `describeAction` has no special wording for. The contract test
 * in `tests/audit-actions-contract.test.ts` fails when code writes an action
 * that is neither here nor handled in `describeAction`, so the log stays
 * complete as features are added.
 */

import type { Prisma } from "@prisma/client";

export const AUDIT_CATEGORIES = [
  "bookings",
  "items",
  "people",
  "schedule",
  "kiosk",
  "settings",
  "security",
  "override",
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  bookings: "Checkouts and reservations",
  items: "Items and inventory",
  people: "People",
  schedule: "Schedule and shifts",
  kiosk: "Kiosk",
  settings: "Settings and content",
  security: "Sign-in and security",
  override: "Admin overrides",
};

/** Actions that are an admin stepping past the normal flow. Always category "override". */
const OVERRIDE_ACTIONS = new Set([
  "admin_override",
  "admin_force_checkout",
  "admin_force_completed_checkout",
  "custody_scope_changed",
  "owner_transferred",
]);

const SECURITY_ACTIONS = new Set([
  "login",
  "logout",
  "registered",
  "passkey_login",
  "passkey_registered",
  "passkey_revoked",
  "password_change",
  "sessions_signed_out",
  "session_signed_out",
  "api_token_created",
  "api_token_revoked",
  "change_password",
  "password_reset",
  "password_reset_self",
  "password_reset_requested",
  "password_reset_completed",
  "reveal_password",
  "ics_token_rotated",
  "role_changed",
  "account_self_deleted",
]);

const ENTITY_CATEGORIES: Record<string, AuditCategory> = {
  booking: "bookings",
  booking_accountability: "bookings",
  asset: "items",
  bulk_sku: "items",
  bulk_sku_unit: "items",
  bulk_sku_product: "items",
  kit: "items",
  label_print_job: "items",
  license_code: "items",
  user: "people",
  user_avatar: "people",
  allowed_email: "people",
  hiring_application: "people",
  hiring_cycle: "people",
  badge_award: "people",
  student_availability_block: "people",
  student_area_assignment: "people",
  student_term_placement: "people",
  gear_pick_cycle: "people",
  gear_pick_student: "people",
  gear_pick_participant: "people",
  gear_pick_receipt: "people",
  gear_pick_submission: "people",
  gear_pick_handout: "people",
  gear_past_cycle: "people",
  shift: "schedule",
  shift_group: "schedule",
  shift_group_working_copy: "schedule",
  shift_assignment: "schedule",
  shift_trade: "schedule",
  shift_backfill: "schedule",
  calendar_event: "schedule",
  CalendarEvent: "schedule",
  calendar_source: "schedule",
  sport_config: "schedule",
  student_sport_assignment: "schedule",
  schedule_bulk_assignment: "schedule",
  location_mapping: "schedule",
  kiosk_device: "kiosk",
  kiosk_operation: "kiosk",
  session: "security",
  api_token: "security",
  passkey_credential: "security",
};

export function auditCategory(action: string, entityType: string | undefined): AuditCategory {
  if (OVERRIDE_ACTIONS.has(action)) return "override";
  if (SECURITY_ACTIONS.has(action)) return "security";
  if (action.startsWith("kiosk_")) return "kiosk";
  return (entityType && ENTITY_CATEGORIES[entityType]) || "settings";
}

/** Sentence for actions without bespoke wording. Past tense, no actor. */
export const AUDIT_ACTION_SENTENCES: Record<string, string> = {
  capture_plan: "Saved a budget plan",
  adopted_for_hire: "Brought an applicant on as a hire",
  bulk_marked_maintenance: "Marked several items as needing maintenance",
  bulk_cleared_maintenance: "Cleared maintenance on several items",
  kiosk_pickup_appended: "Added gear to an existing pickup at a kiosk",
  move_location: "Moved items to another location",
  profile_completion_snoozed: "Put off finishing their profile",
  qr_changed: "Changed the QR code",
  show_again: "Showed an announcement again",
  stage_change: "Moved an applicant to another stage",
  account_self_deleted: "Deleted their own account",
  accountability_excluded: "Excluded this checkout from accountability",
  accountability_restored: "Put this checkout back in accountability",
  add_members: "Added items to the kit",
  add_receipt: "Added a receipt",
  add_student: "Added a student",
  archive_cycle: "Archived the gear pick cycle",
  archived: "Archived this",
  area_assigned: "Assigned a work area",
  area_removed: "Removed a work area",
  assign_product: "Assigned a product",
  attendance_updated: "Updated attendance",
  badge_awarded_manually: "Awarded a badge",
  badge_revoked_manually: "Took back a badge",
  bulk_change_category: "Changed the category of several items",
  bulk_create: "Created several records at once",
  bulk_deleted: "Deleted several records at once",
  bulk_member_added: "Added several items to the kit",
  bulk_member_removed: "Removed several items from the kit",
  bulk_renew: "Renewed several records at once",
  bulk_retired: "Retired several items at once",
  bulk_unretired: "Brought several retired items back",
  calendar_event_created: "Added a calendar event",
  calendar_event_deleted: "Deleted a calendar event",
  calendar_event_schedule_shifted: "Moved the schedule for an event",
  calendar_event_updated: "Updated a calendar event",
  calendar_event_visibility_updated: "Changed who can see an event",
  calendar_events_combined: "Combined calendar events",
  calendar_events_uncombined: "Split combined calendar events",
  change_password: "Changed their password",
  checkin_report_unit_damaged: "Reported a unit damaged at return",
  checkin_report_unit_lost: "Reported a unit lost at return",
  checkout_policies_updated: "Updated checkout rules",
  checkouts_merged: "Merged checkouts",
  cleanup_wizard_attach: "Attached an item in the cleanup wizard",
  cleanup_wizard_deferred: "Skipped an item in the cleanup wizard",
  cleanup_wizard_qr: "Set a QR code in the cleanup wizard",
  cleanup_wizard_serial: "Set a serial number in the cleanup wizard",
  cloned: "Copied this",
  continue_remaining_labels: "Continued printing the remaining labels",
  custody_scope_changed: "Changed who can hold this gear",
  deactivation_cleanup: "Cleaned up after deactivating an account",
  dismissed_checkin_report: "Dismissed a return report",
  document_add: "Added a document",
  document_delete: "Deleted a document",
  document_view: "Viewed a document",
  draft_consumed: "Turned a draft into a booking",
  draft_created: "Started a draft",
  draft_updated: "Updated a draft",
  duplicate_in_file: "Skipped a duplicate row in the import file",
  event_travel_defaults_added: "Added default travel for an event",
  event_travel_member_added: "Added someone to event travel",
  event_travel_member_removed: "Removed someone from event travel",
  event_worker_added: "Added someone to an event",
  event_worker_removed: "Removed someone from an event",
  extend_presets_updated: "Updated the extend-time options",
  fill_from_order: "Filled quantities from the order",
  football_result_refresh: "Refreshed football results",
  getting_started_updated: "Updated the getting started guide",
  hidden_smoke_user_cleanup_deactivated: "Deactivated a hidden test account",
  hire_invited: "Invited a new hire",
  hire_linked: "Linked a new hire to their account",
  ics_token_rotated: "Reset the calendar feed link",
  invite_link_requested: "Requested an invite link",
  invite_resent: "Resent an invite",
  invite_sent: "Sent an invite",
  kiosk_checkin_scan_undone: "Undid a return scan at a kiosk",
  kiosk_checkout_item_swapped: "Swapped an item at a kiosk",
  kiosk_crew_requested: "Asked to join the crew from a kiosk",
  kiosk_operation_receipt: "Finished a kiosk step",
  kiosk_overdue_nudge_sent: "Sent an overdue reminder from a kiosk",
  kiosk_pickup_item_added: "Added an item at kiosk pickup",
  kiosk_pickup_scan_removed: "Removed a scan at kiosk pickup",
  kiosk_quantity_returned: "Returned a quantity at a kiosk",
  kiosk_staff_verified: "Verified a staff member at a kiosk",
  kiosk_staff_verify_refused: "Was refused staff verification at a kiosk",
  mark_all_read: "Marked all notifications read",
  mark_read: "Marked a notification read",
  marked_missing: "Marked an item missing",
  merged_into_checkout: "Merged into another checkout",
  merged_into_reservation: "Merged into another reservation",
  needs_review: "Flagged for review",
  non_game_schedule_defaults_updated: "Updated default times for non-game events",
  note_add: "Added a note",
  notification_marked_read: "Marked a notification read",
  notifications_marked_all_read: "Marked all notifications read",
  notifications_marked_unread: "Marked notifications unread",
  numbered_unit_balance_reconciled: "Corrected the numbered unit count",
  onboarding_check_updated: "Updated a student onboarding step",
  onboarding_guide_updated: "Updated the onboarding contacts and notes",
  onboarding_completed: "Finished onboarding",
  overdue_responders_updated: "Updated who answers overdue alerts",
  packing_item_checked: "Checked off a packing list item",
  packing_item_unchecked: "Unchecked a packing list item",
  passkey_login: "Signed in with a passkey",
  passkey_registered: "Added a passkey",
  passkey_revoked: "Removed a passkey",
  password_change: "Changed their password",
  password_reset: "Reset a password",
  api_token_created: "Created an API token",
  api_token_revoked: "Revoked an API token",
  session_signed_out: "Signed out one of their devices",
  sessions_signed_out: "Signed out their other devices",
  shared_case_checklist_updated: "Updated the shared case checklist",
  pending_profile_updated: "Updated a pending profile",
  processed: "Processed this",
  profile_completion_updated: "Updated profile completion",
  regenerate_activation_code: "Made a new kiosk activation code",
  remove_member: "Removed an item from the kit",
  remove_receipt: "Removed a receipt",
  remove_student: "Removed a student",
  reordered: "Changed the order",
  report_broken: "Reported a license as broken",
  reservation_consolidated: "Combined reservations",
  reservation_leftover_expired: "Released gear that was never picked up",
  reservation_picked_items_moved_to_checkout: "Moved picked-up gear into a checkout",
  reservation_rules_updated: "Updated reservation rules",
  reservations_merged: "Merged reservations",
  resource_asset_favorite_added: "Favorited a resource file",
  resource_asset_favorite_removed: "Unfavorited a resource file",
  resource_asset_folder_created: "Created a resource folder",
  resource_asset_upload_prepared: "Started uploading a resource file",
  resource_asset_version_restored: "Restored an earlier version of a resource file",
  resource_asset_version_uploaded: "Uploaded a new version of a resource file",
  resource_created: "Added a resource",
  resource_deleted: "Deleted a resource",
  resource_updated: "Updated a resource",
  restored: "Restored this",
  reveal_password: "Revealed a saved password",
  roster_added: "Added someone to the roster",
  roster_bulk_added: "Added several people to the roster",
  roster_removed: "Removed someone from the roster",
  roster_travel_set: "Set roster travel",
  schedule_assignment_review_needed: "Flagged a schedule assignment for review",
  schedule_bulk_assignment_staged: "Staged bulk schedule assignments",
  sent: "Sent this",
  serialized_item_transferred_in: "Received an item by transfer",
  serialized_item_transferred_out: "Handed off an item by transfer",
  set_budget: "Set the budget",
  set_deadline: "Set the deadline",
  set_order: "Set the order",
  set_qr: "Set the QR code",
  set_serial: "Set the serial number",
  set_student_sizes: "Set student sizes",
  setup_reminder_sent: "Sent a setup reminder",
  shift_assigned: "Assigned someone to a shift",
  shift_assignment_acknowledged: "Acknowledged a shift assignment",
  shift_assignment_removed: "Removed someone from a shift",
  shift_assignment_role_slot_repaired: "Repaired a shift role slot",
  shift_backfill_executed: "Filled past shifts",
  shift_created: "Added a shift",
  shift_group_archived: "Archived a shift group",
  shift_group_copy_forward_applied: "Copied a shift group forward",
  shift_group_created: "Created a shift group",
  shift_group_regenerated: "Rebuilt a shift group",
  shift_group_updated: "Updated a shift group",
  shift_pickup_requested: "Asked to pick up a shift",
  shift_request_declined: "Declined a shift request",
  shift_request_withdrawn: "Withdrew a shift request",
  shift_swapped: "Swapped shifts",
  sport_auto_assign_policy_set: "Changed the auto-assign rule for a sport",
  sport_config_group_updated: "Updated a sport's shift groups",
  sport_config_updated: "Updated a sport's setup",
  sport_config_upserted: "Saved a sport's setup",
  sport_setup_matched: "Matched events to a sport setup",
  start_label_print: "Started printing labels",
  start_term_update: "Started a term update",
  student_availability_created: "Added an availability block",
  student_availability_deleted: "Removed an availability block",
  student_availability_updated: "Updated an availability block",
  trade_cancelled: "Cancelled a shift trade",
  trade_claim_withdrawn: "Withdrew a claim on a shift trade",
  trade_claimed: "Claimed a shift trade",
  trade_declined: "Declined a shift trade",
  trade_posted: "Posted a shift trade",
  unmatched: "Unmatched events from a sport setup",
  update_status: "Changed the status",
  working_schedule_discarded: "Discarded the working schedule",
  working_schedule_rebased: "Refreshed the working schedule from the live one",
};

/** Old rows hold `SAVE`, `setBudget` and `set_budget` side by side; read them all as `set_budget`. */
export function normalizeAction(action: string): string {
  return action
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toLowerCase();
}

/** Wording for actions that are only unique per entity (`release` means different things). Key: `entityType:action`. */
const ENTITY_ACTION_SENTENCES: Record<string, string> = {
  "SignatureCollection:archive": "Archived a signature collection",
  "SignatureCollection:delete": "Deleted a signature collection",
  "SignatureCollection:delete_requested": "Asked to delete a signature collection",
  "SignatureCollection:restore": "Restored a signature collection",
  "SignatureCollection:reset": "Reset a signature collection",
  "SignatureCapture:save": "Saved a signature",
  "SignatureCapture:save_failed": "A signature failed to save",
  "SignatureCapture:remove": "Removed a signature",
  "SignatureRosterSnapshot:preview": "Previewed a roster update",
  "SignatureRosterSnapshot:apply": "Applied a roster update",
  "YouTubeLibrary:refresh": "Refreshed the YouTube library",
  "announcement:publish": "Published an announcement",
  "kiosk_device:deactivate": "Deactivated a kiosk",
  "announcement:delete": "Deleted an announcement",
  "budget:import": "Imported a budget",
  "budget_line_item:link": "Linked an expense to a budget line",
  "budget_line_item:unlink": "Unlinked an expense from a budget line",
  "gear_pick_participant:add": "Added a participant to the gear picks",
  "gear_pick_participant:remove": "Removed a participant from the gear picks",
  "gear_pick_cycle:export": "Exported the gear picks",
  "hiring_cycle:import": "Imported applicants",
  "hiring_cycle:export": "Exported applicants",
  "license_code:claim": "Claimed a license",
  "license_code:release": "Released a license",
  "license_code:occupy": "Marked a license in use",
  "role_preview:start": "Started previewing another role",
  "role_preview:stop": "Stopped previewing another role",
  "student_term_placement:upsert": "Saved a student's term placement",
  "wish_item:promote": "Promoted a wishlist item",
};

const SIGNATURE_AND_YOUTUBE: Record<string, string> = {
  add_to_playlists: "Added a video to playlists",
  add_unofficial_player: "Added an unofficial player to the roster",
  check_playlists: "Checked a video's playlists",
  check_publish: "Checked a video before publishing",
  create_ad_hoc: "Added a signer who is not on the roster",
  disconnect: "Disconnected YouTube",
  make_public: "Made a video public",
  merge_roster_member: "Merged two roster members",
  move_signature: "Moved a signature",
  publish_metadata: "Published video details",
  remove_from_roster: "Removed someone from the signature roster",
  sync_creative_staff: "Synced Creative staff into the roster",
  update_pen_settings: "Changed signature pen settings",
  update_required: "Changed who must sign",
};

const GEAR_PICK_VERBS: Record<string, string> = {
  add_participant: "Added a participant to the gear picks",
  remove_participant: "Removed a participant from the gear picks",
  update_participant: "Updated a gear picks participant",
  set_handout: "Set the gear handout",
  set_launched: "Launched the gear picks",
};

/** Sentence for an audit row, or null if nothing is registered. */
export function auditSentence(action: string, entityType: string | undefined): string | null {
  const key = normalizeAction(action);
  return (
    (entityType && ENTITY_ACTION_SENTENCES[`${entityType}:${key}`]) ||
    AUDIT_ACTION_SENTENCES[key] ||
    SIGNATURE_AND_YOUTUBE[key] ||
    GEAR_PICK_VERBS[key] ||
    null
  );
}

/** Every action string the registry can word. Used by the contract test. */
export function isWordedAction(action: string): boolean {
  const key = normalizeAction(action);
  return (
    key in AUDIT_ACTION_SENTENCES ||
    key in SIGNATURE_AND_YOUTUBE ||
    key in GEAR_PICK_VERBS ||
    Object.keys(ENTITY_ACTION_SENTENCES).some((k) => k.endsWith(`:${key}`))
  );
}

/** Prisma filter that matches exactly the rows `auditCategory` files under `category`. */
export function auditCategoryWhere(category: AuditCategory): Prisma.AuditLogWhereInput {
  const entitiesIn = (wanted: AuditCategory) =>
    Object.entries(ENTITY_CATEGORIES).filter(([, c]) => c === wanted).map(([entity]) => entity);
  const overrides = [...OVERRIDE_ACTIONS];
  const claimed = [...OVERRIDE_ACTIONS, ...SECURITY_ACTIONS];

  if (category === "override") return { action: { in: overrides } };
  if (category === "security") {
    return {
      OR: [{ action: { in: [...SECURITY_ACTIONS] } }, { entityType: { in: entitiesIn("security") } }],
      NOT: { action: { in: overrides } },
    };
  }
  if (category === "kiosk") {
    return {
      OR: [{ action: { startsWith: "kiosk_" } }, { entityType: { in: entitiesIn("kiosk") } }],
      NOT: { action: { in: claimed } },
    };
  }
  return {
    entityType: category === "settings" ? { notIn: Object.keys(ENTITY_CATEGORIES) } : { in: entitiesIn(category) },
    NOT: [{ action: { in: claimed } }, { action: { startsWith: "kiosk_" } }],
  };
}
