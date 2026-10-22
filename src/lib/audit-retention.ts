/**
 * Audit log retention policy. Single source of truth — referenced by the
 * weekly retention cron and by the audit report page banner so they can
 * never drift. Kept free of server imports so the client page can use it
 * without pulling the database adapter into the browser bundle.
 */
export const AUDIT_RETENTION_DAYS = 90;
