/**
 * Resource ceilings for request payloads that fan out into database queries or writes.
 * These are per-request safety limits, not catalog or lifetime inventory limits.
 */
export const MAX_EQUIPMENT_SELECTIONS_PER_REQUEST = 500;
export const MAX_LINKED_EVENTS_PER_BOOKING = 5;
export const MAX_BULK_SKU_LINES_PER_REQUEST = 50;
export const MAX_BULK_QUANTITY_PER_LINE = 1_000_000;
export const MAX_BULK_UNIT_NUMBER = 2_147_483_647;
export const MAX_CHECKOUT_DISTINCT_BULK_SKUS_PER_REQUEST = 10;
export const MAX_CHECKOUT_BULK_LINE_CHANGES_PER_REQUEST = 10;
export const MAX_NUMBERED_UNITS_PER_CREATE = 500;
export const MAX_SPORT_ROSTER_USERS_PER_REQUEST = 200;
export const MAX_SPORT_SHIFT_CONFIGS_PER_REQUEST = 6;
export const MAX_SPORT_CONFIG_GROUP_CODES_PER_REQUEST = 3;
