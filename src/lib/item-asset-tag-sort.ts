const assetTagCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const TEAM_PREFIXES = new Set([
  "BASE",
  "BB",
  "FB",
  "GOLF",
  "HKY",
  "MBB",
  "MSOC",
  "ROW",
  "SB",
  "SOC",
  "SWIM",
  "TENNIS",
  "TRACK",
  "VB",
  "WBB",
  "WHKY",
  "WRE",
  "WRESTLING",
  "WSOC",
  "XC",
]);

const DEPARTMENT_PREFIXES = new Set(["CREATIVE", "PHOTO", "VIDEO"]);

const EQUIPMENT_STARTERS = new Set([
  "A1",
  "A7",
  "A9",
  "ANTON",
  "ANTON/BAUER",
  "APUTURE",
  "CANON",
  "DELL",
  "DJI",
  "FX3",
  "FX30",
  "FX6",
  "GODOX",
  "GOPRO",
  "IMPACT",
  "INSTA360",
  "JUPIO",
  "JVC",
  "LAOWA",
  "LOGITECH",
  "MONITOR",
  "PANASONIC",
  "PROGRADE",
  "SANDISK",
  "SIGMA",
  "SMALLRIG",
  "SONY",
  "TAMRON",
  "WATSON",
]);

function normalizeAssetTag(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function readOperationalPrefix(value: string) {
  const normalized = normalizeAssetTag(value);
  const [firstToken, ...rest] = normalized.split(" ");
  if (!firstToken || rest.length === 0) {
    return { prefix: null, value: normalized };
  }

  const prefix = firstToken.toUpperCase();
  const restValue = rest.join(" ");
  if (TEAM_PREFIXES.has(prefix) && looksLikeTeamScopedAssetTag(rest)) {
    return { prefix, value: restValue };
  }
  if (DEPARTMENT_PREFIXES.has(prefix) && looksLikeKnownEquipmentTag(rest)) {
    return { prefix, value: restValue };
  }
  return { prefix: null, value: normalized };
}

function looksLikeTeamScopedAssetTag(tokens: string[]) {
  const value = tokens.join(" ");
  if (looksLikeKnownEquipmentTag(tokens)) return true;
  if (/^\d/.test(value)) return true;
  return tokens.length > 1;
}

function looksLikeKnownEquipmentTag(tokens: string[]) {
  const value = tokens.join(" ");
  const first = tokens[0]?.toUpperCase();
  if (!first) return false;

  return (
    /^\d/.test(value) ||
    /^(?:A\d|FX\d|FX\d{2}|FS\d)\b/i.test(value) ||
    EQUIPMENT_STARTERS.has(first)
  );
}

function normalizeFamilyToken(token: string) {
  if (!/^\d{4,6}$/.test(token)) return token;
  if (token.length === 4) return `${token.slice(0, 2)}-${token.slice(2)}`;
  if (token.length === 5) return `${token.slice(0, 2)}-${token.slice(2)}`;
  return `${token.slice(0, 3)}-${token.slice(3)}`;
}

function compactFamilyToken(token: string) {
  return token.replace(/(\d)-(\d)/g, "$1$2");
}

export function getAssetTagSearchAliases(query: string) {
  const normalized = normalizeAssetTag(query);
  if (!normalized) return [];

  const aliases = new Set([normalized]);
  const tokens = normalized.split(" ").filter(Boolean);

  for (const token of tokens) {
    const hyphenated = normalizeFamilyToken(token);
    if (hyphenated !== token) {
      aliases.add(normalized.replace(token, hyphenated));
    }

    const compact = compactFamilyToken(token);
    if (compact !== token && /^\d{4,6}$/.test(compact)) {
      aliases.add(normalized.replace(token, compact));
    }
  }

  return [...aliases];
}

function getItemAssetTagSortParts(assetTag: string) {
  const { prefix, value } = readOperationalPrefix(assetTag);
  const key = value
    .replace(/-(\d+)$/, " $1")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = key.split(" ").filter(Boolean);
  const trailingUnit = tokens.at(-1);
  const unitNumber = trailingUnit && /^\d+$/.test(trailingUnit)
    ? Number(trailingUnit)
    : null;
  const familyTokens = unitNumber === null ? tokens : tokens.slice(0, -1);
  const familyKey = familyTokens
    .map((token, index) => index === 0 ? normalizeFamilyToken(token) : token)
    .join(" ")
    .trim();

  return {
    familyKey: familyKey || key,
    prefixRank: prefix === null ? 0 : 1,
    prefix: prefix ?? "",
    unitNumber,
    key,
    normalized: normalizeAssetTag(assetTag),
  };
}

/**
 * Persisted sort-key support for `assets.asset_tag_sort_key`.
 *
 * `compareItemAssetTags` is a six-level comparison (family key, prefix rank,
 * unit number, prefix, key, normalized tag) driven by an `Intl.Collator` with
 * `numeric: true` / `sensitivity: "base"`. To let Postgres do the
 * `ORDER BY ... LIMIT ... OFFSET` we flatten those six levels into a single
 * byte-comparable string:
 *
 *   collation(familyKey) SEP prefixRank SEP unit SEP collation(prefix)
 *     SEP collation(key) SEP collation(normalized)
 *
 * where SEP is U+0001 (sorts before every character a tag can contain).
 * `collationKey` upper-cases (emulating `sensitivity: "base"`) and zero-pads
 * every digit run (emulating `numeric: true`). The column is declared
 * `COLLATE "C"` in migration 0151 so Postgres compares the key byte-wise
 * instead of folding away separators and punctuation the way a libc/ICU
 * collation would.
 *
 * `prisma/migrations/0151_asset_tag_sort_key/migration.sql` holds a PL/pgSQL
 * mirror of this function (`bg_asset_tag_sort_key`) used for the backfill and
 * for a BEFORE INSERT/UPDATE trigger, so non-TypeScript writers (seed and
 * import `.mjs` scripts, raw SQL) stay in sync as well.
 */
export const ASSET_TAG_SORT_KEY_SEPARATOR = "";
export const ASSET_TAG_SORT_KEY_NUMERIC_WIDTH = 12;

function padNumericRun(run: string) {
  return run.length >= ASSET_TAG_SORT_KEY_NUMERIC_WIDTH
    ? run
    : run.padStart(ASSET_TAG_SORT_KEY_NUMERIC_WIDTH, "0");
}

function collationKey(value: string) {
  return value.toUpperCase().replace(/\d+/g, padNumericRun);
}

/** Build the persisted, byte-comparable sort key for an asset tag. */
export function buildItemAssetTagSortKey(assetTag: string) {
  const parts = getItemAssetTagSortParts(assetTag);
  const unit = parts.unitNumber === null
    ? "0".repeat(ASSET_TAG_SORT_KEY_NUMERIC_WIDTH)
    : padNumericRun(String(parts.unitNumber));

  return [
    collationKey(parts.familyKey),
    String(parts.prefixRank),
    unit,
    collationKey(parts.prefix),
    collationKey(parts.key),
    collationKey(parts.normalized),
  ].join(ASSET_TAG_SORT_KEY_SEPARATOR);
}

/**
 * The single place every asset create/update that writes an asset tag goes
 * through, so `assetTagSortKey` can never drift from `assetTag`.
 */
export function buildAssetTagSortFields(assetTag: string) {
  return { assetTag, assetTagSortKey: buildItemAssetTagSortKey(assetTag) };
}

export function compareItemAssetTags(a: string, b: string) {
  const aParts = getItemAssetTagSortParts(a);
  const bParts = getItemAssetTagSortParts(b);

  const familyComparison = assetTagCollator.compare(aParts.familyKey, bParts.familyKey);
  if (familyComparison !== 0) return familyComparison;

  if (aParts.prefixRank !== bParts.prefixRank) return aParts.prefixRank - bParts.prefixRank;

  if (aParts.unitNumber !== null && bParts.unitNumber !== null && aParts.unitNumber !== bParts.unitNumber) {
    return aParts.unitNumber - bParts.unitNumber;
  }

  const prefixComparison = assetTagCollator.compare(aParts.prefix, bParts.prefix);
  if (prefixComparison !== 0) return prefixComparison;

  const keyComparison = assetTagCollator.compare(aParts.key, bParts.key);
  if (keyComparison !== 0) return keyComparison;

  return assetTagCollator.compare(aParts.normalized, bParts.normalized);
}
