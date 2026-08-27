import { Role } from "@prisma/client";

/**
 * Centralized permission policy map.
 * Keyed by resource → action → list of roles allowed.
 *
 * Reference: docs/AREA_USERS.md § Permission Matrix (V1)
 *
 * Booking-specific action permissions (edit own, cancel own, etc.)
 * are handled by booking-rules.ts which does ownership + status checks.
 * This map covers coarse role gating at the API route level.
 */
export const PERMISSIONS: Record<string, Record<string, Role[]>> = {
  role_preview: {
    manage: ["ADMIN"],
  },
  user: {
    view: ["ADMIN", "STAFF", "STUDENT"],
    edit_self: ["ADMIN", "STAFF", "STUDENT", "COLLABORATOR"],
    create: ["ADMIN", "STAFF"],
    edit: ["ADMIN", "STAFF"],
    manage_role: ["ADMIN", "STAFF"],
  },
  asset: {
    view: ["ADMIN", "STAFF", "STUDENT"],
    create: ["ADMIN", "STAFF"],
    edit: ["ADMIN", "STAFF"],
    delete: ["ADMIN"],
    duplicate: ["ADMIN", "STAFF"],
    import: ["ADMIN", "STAFF"],
    maintenance: ["ADMIN", "STAFF"],
    retire: ["ADMIN", "STAFF"],
    favorite: ["ADMIN", "STAFF", "STUDENT"],
    generate_qr: ["ADMIN", "STAFF"],
    export: ["ADMIN", "STAFF"],
    audit: ["ADMIN", "STAFF"],
  },
  category: {
    view: ["ADMIN", "STAFF", "STUDENT"],
    create: ["ADMIN", "STAFF"],
    edit: ["ADMIN", "STAFF"],
    delete: ["ADMIN"],
  },
  booking: {
    view: ["ADMIN", "STAFF", "STUDENT"],
    create: ["ADMIN", "STAFF", "STUDENT"],
    // Fine-grained booking actions (edit, cancel, extend, checkin)
    // are enforced by booking-rules.ts with ownership checks.
  },
  checkout: {
    view: ["ADMIN", "STAFF", "STUDENT"],
    create: ["ADMIN", "STAFF", "STUDENT"],
    scan: ["ADMIN", "STAFF", "STUDENT"],
    complete: ["ADMIN", "STAFF"],
    admin_override: ["ADMIN", "STAFF"],
  },
  bulk_sku: {
    view: ["ADMIN", "STAFF", "STUDENT"],
    create: ["ADMIN", "STAFF"],
    edit: ["ADMIN", "STAFF"],
    adjust: ["ADMIN", "STAFF"],
    delete: ["ADMIN"],
  },
  calendar_source: {
    view: ["ADMIN", "STAFF", "STUDENT"],
    create: ["ADMIN", "STAFF"],
    edit: ["ADMIN", "STAFF"],
    delete: ["ADMIN", "STAFF"],
    sync: ["ADMIN", "STAFF"],
  },
  location: {
    // ADMIN-only per D-027 — locations are an admin-managed catalog driving
    // venue mappings, kiosk binding, and shift scheduling. STAFF cannot edit.
    view: ["ADMIN", "STAFF", "STUDENT"],
    manage: ["ADMIN"],
  },
  location_mapping: {
    // ADMIN-only per D-027 (Venue Mappings is admin configuration of how
    // calendar event venues map to locations — STAFF cannot access or mutate it).
    view: ["ADMIN"],
    create: ["ADMIN"],
    delete: ["ADMIN"],
  },
  report: {
    view: ["ADMIN", "STAFF"],
    // The audit report exposes the full cross-user audit trail; keep it
    // aligned with the admin-only /api/audit browse feed.
    audit: ["ADMIN"],
  },
  accountability: {
    // The named leaderboard is an internal team read. External collaborators
    // remain default-deny under D-041 and never inherit cross-user history.
    view: ["ADMIN", "STAFF", "STUDENT"],
    manage_exclusions: ["ADMIN"],
  },
  scoreboard: {
    // D-056: Scoreboard identity and metrics are shared authenticated team data.
    view: ["ADMIN", "STAFF", "STUDENT", "COLLABORATOR"],
  },
  event_worker: {
    // Workers recorded outside the schedule. Staff can see who was added to an
    // event they are running; adding or removing one rewrites season stats
    // without any schedule or notification trail, so it stays ADMIN-only.
    view: ["ADMIN", "STAFF"],
    manage: ["ADMIN"],
  },
  notification: {
    view: ["ADMIN", "STAFF", "STUDENT"],
    process: ["ADMIN", "STAFF"],
  },
  diagnostics: {
    view: ["ADMIN"],
  },
  shift: {
    view: ["ADMIN", "STAFF", "STUDENT"],
    create: ["ADMIN", "STAFF"],
    edit: ["ADMIN", "STAFF"],
    delete: ["ADMIN", "STAFF"],
    manage: ["ADMIN", "STAFF"],
  },
  shift_assignment: {
    view: ["ADMIN", "STAFF", "STUDENT"],
    assign: ["ADMIN", "STAFF"],
    request: ["ADMIN", "STAFF", "STUDENT"],
    approve: ["ADMIN"],
  },
  sport_config: {
    view: ["ADMIN", "STAFF"],
    manage: ["ADMIN", "STAFF"],
  },
  student_sport: {
    view: ["ADMIN", "STAFF", "STUDENT"],
    manage: ["ADMIN", "STAFF"],
  },
  student_area: {
    view: ["ADMIN", "STAFF", "STUDENT"],
    manage: ["ADMIN", "STAFF"],
  },
  shift_trade: {
    view: ["ADMIN", "STAFF", "STUDENT"],
    post: ["ADMIN", "STAFF", "STUDENT"],
    claim: ["ADMIN", "STAFF", "STUDENT"],
    approve: ["ADMIN"],
  },
  // Sending a blast reaches every targeted phone at once, so authoring stays with
  // ADMIN + STAFF. Receiving needs no permission: the /api/me/blasts routes scope
  // by userId, matching how /api/notifications gates itself.
  blast: {
    view: ["ADMIN", "STAFF"],
    create: ["ADMIN", "STAFF"],
    cancel: ["ADMIN", "STAFF"],
  },
  allowed_email: {
    view: ["ADMIN", "STAFF"],
    create: ["ADMIN", "STAFF"],
    edit: ["ADMIN", "STAFF"],
    delete: ["ADMIN", "STAFF"],
  },
  kit: {
    view: ["ADMIN", "STAFF"],
    create: ["ADMIN", "STAFF"],
    edit: ["ADMIN", "STAFF"],
    delete: ["ADMIN"],
  },
  kiosk_device: {
    view: ["ADMIN"],
    create: ["ADMIN"],
    edit: ["ADMIN"],
    delete: ["ADMIN"],
  },
  collaborator_policy: {
    view: ["ADMIN"],
    manage: ["ADMIN"],
  },
  resource: {
    view: ["ADMIN", "STAFF", "STUDENT"],
    favorite: ["ADMIN", "STAFF", "STUDENT"],
    create: ["ADMIN", "STAFF"],
    edit: ["ADMIN", "STAFF"],
    delete: ["ADMIN"],
  },
  license: {
    view: ["ADMIN", "STAFF", "STUDENT"],
    claim: ["ADMIN", "STAFF", "STUDENT"],
    release: ["ADMIN", "STAFF", "STUDENT"],
    manage: ["ADMIN", "STAFF"],
  },
  software: {
    view: ["ADMIN", "STAFF", "STUDENT"],
    reveal: ["ADMIN", "STAFF", "STUDENT"],
    manage: ["ADMIN", "STAFF"],
  },
  signature: {
    view: ["ADMIN", "STAFF"],
    import: ["ADMIN", "STAFF"],
    reconcile: ["ADMIN", "STAFF"],
    capture: ["ADMIN", "STAFF"],
    download: ["ADMIN", "STAFF"],
    remove: ["ADMIN", "STAFF"],
    settings: ["ADMIN"],
    required: ["ADMIN"],
    archive: ["ADMIN"],
    delete: ["ADMIN"],
    reset: ["ADMIN"],
    cleanup: ["ADMIN"],
  },
};

/**
 * Look up allowed roles for a resource + action from the policy map.
 * Returns the role list, or throws if the combination is not defined.
 */
export function getAllowedRoles(resource: string, action: string): Role[] {
  const actions = PERMISSIONS[resource];
  if (!actions || !actions[action]) {
    throw new Error(`No permission defined for ${resource}.${action}`);
  }
  return actions[action];
}
