-- Persisted operational asset-tag sort key.
--
-- The Items list default sort ("assetTag") used to load every matching asset
-- and sort it in Node with compareItemAssetTags() before slicing a page. This
-- migration adds assets.asset_tag_sort_key so Postgres can do
-- ORDER BY ... LIMIT ... OFFSET on an index instead.
--
-- The key flattens the six comparison levels of compareItemAssetTags() into one
-- byte-comparable string, separated by U+0001 (chr(1), which sorts before every
-- character an asset tag can contain):
--
--   collation(familyKey) | prefixRank | unitNumber | collation(prefix)
--     | collation(key) | collation(normalized)
--
-- collation() upper-cases (emulating Intl.Collator sensitivity:"base") and
-- zero-pads every digit run to 12 characters (emulating numeric:true).
--
-- The column is declared COLLATE "C" so Postgres compares it byte-wise. Without
-- that, a libc/ICU collation would treat the U+0001 separators and punctuation
-- as ignorable at the primary level and the field boundaries would collapse.
-- Prisma cannot express a column collation, so it only exists here; prisma
-- migrate diff does not inspect collation, so this does not read as drift.
--
-- KNOWN DIVERGENCES from src/lib/item-asset-tag-sort.ts (accepted):
--   1. sensitivity:"base" also folds accents (é == e). This SQL only folds case
--      (upper()); adding unaccent() would require the unaccent extension. Asset
--      tags in this inventory are ASCII, so this has no practical effect.
--   2. Intl.Collator orders punctuation by ICU weights; COLLATE "C" orders by
--      byte. For the characters that actually occur in asset tags (space,
--      hyphen, slash, digits, letters) the relative order is the same.
--   3. Digit runs longer than 12 characters are left unpadded by both sides, so
--      two such runs of different lengths compare by first digit, not by value.
--   4. compareItemAssetTags() skips the unit-number level when either side has
--      no trailing unit; the flattened key encodes "no unit" as twelve zeros,
--      which places unit-less tags first inside a family. That matches what the
--      JS comparator produces for every fixture below.
--   5. JS uses Number() for the unit; this SQL strips leading zeros textually,
--      which avoids the bigint/float precision limit but is identical for any
--      realistic unit number.
--
-- FIXTURES: tests/item-asset-tag-sort.test.ts asserts the TypeScript helper
-- against exactly this list, and tests/asset-tag-sort-key-migration.test.ts
-- asserts that this comment block and that list stay in sync. Any change to the
-- normalization must update all three.
--
-- SORT_KEY_FIXTURES_BEGIN
--   FB 70-200 1
--   MBB 28-75 1
--   FB A7 V 1
--   FB Wireless Flash
--   FX6 2
--   70200 4
--   100400 2
--   Video Assist 1
--   Photo Printer 1
--   Video FX6 1
--   Creative 70-200 1
--   70-200 10
--   70-200 2
--   SONY FX3
--   Monitor Battery
--   DEMO-CAM-001
-- SORT_KEY_FIXTURES_END

-- Upper-case + numeric-run padding, mirroring collationKey() in
-- src/lib/item-asset-tag-sort.ts.
CREATE OR REPLACE FUNCTION bg_asset_tag_collation_key(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(
    string_agg(
      CASE
        WHEN m[1] IS NOT NULL THEN
          CASE WHEN length(m[1]) >= 12 THEN m[1] ELSE lpad(m[1], 12, '0') END
        ELSE upper(m[2])
      END,
      '' ORDER BY ord
    ),
    ''
  )
  FROM regexp_matches(COALESCE(value, ''), '([0-9]+)|([^0-9]+)', 'g')
    WITH ORDINALITY AS t(m, ord);
$fn$;

-- Mirrors normalizeFamilyToken(): 70200 -> 70-200, 100400 -> 100-400.
CREATE OR REPLACE FUNCTION bg_asset_tag_family_token(token text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN token !~ '^[0-9]{4,6}$' THEN token
    WHEN length(token) = 4 THEN substr(token, 1, 2) || '-' || substr(token, 3)
    WHEN length(token) = 5 THEN substr(token, 1, 2) || '-' || substr(token, 3)
    ELSE substr(token, 1, 3) || '-' || substr(token, 4)
  END;
$fn$;

-- Mirrors getItemAssetTagSortParts() + buildItemAssetTagSortKey().
CREATE OR REPLACE FUNCTION bg_asset_tag_sort_key(asset_tag text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  team_prefixes text[] := ARRAY[
    'BASE', 'BB', 'FB', 'GOLF', 'HKY', 'MBB', 'MSOC', 'ROW', 'SB', 'SOC',
    'SWIM', 'TENNIS', 'TRACK', 'VB', 'WBB', 'WHKY', 'WRE', 'WRESTLING',
    'WSOC', 'XC'
  ];
  department_prefixes text[] := ARRAY['CREATIVE', 'PHOTO', 'VIDEO'];
  equipment_starters text[] := ARRAY[
    'A1', 'A7', 'A9', 'ANTON', 'ANTON/BAUER', 'APUTURE', 'CANON', 'DELL',
    'DJI', 'FX3', 'FX30', 'FX6', 'GODOX', 'GOPRO', 'IMPACT', 'INSTA360',
    'JUPIO', 'JVC', 'LAOWA', 'LOGITECH', 'MONITOR', 'PANASONIC', 'PROGRADE',
    'SANDISK', 'SIGMA', 'SMALLRIG', 'SONY', 'TAMRON', 'WATSON'
  ];
  normalized text;
  tokens text[];
  rest_tokens text[];
  rest_value text;
  prefix text := NULL;
  prefix_rank int := 0;
  prefix_value text := '';
  value text;
  key_value text;
  key_tokens text[];
  key_count int;
  trailing_unit text;
  unit_text text := NULL;
  family_tokens text[];
  family_key text;
  known_equipment boolean;
  team_scoped boolean;
BEGIN
  -- normalizeAssetTag(): trim, then collapse internal whitespace.
  normalized := btrim(regexp_replace(btrim(COALESCE(asset_tag, '')), '\s+', ' ', 'g'));

  -- readOperationalPrefix().
  tokens := string_to_array(normalized, ' ');
  rest_tokens := tokens[2:];
  IF COALESCE(tokens[1], '') = '' OR COALESCE(array_length(rest_tokens, 1), 0) = 0 THEN
    prefix := NULL;
    value := normalized;
  ELSE
    prefix := upper(tokens[1]);
    rest_value := array_to_string(rest_tokens, ' ');

    -- looksLikeKnownEquipmentTag().
    known_equipment := (rest_value ~ '^[0-9]')
      OR (rest_value ~* '^(A[0-9]|FX[0-9]|FX[0-9]{2}|FS[0-9])\y')
      OR (upper(rest_tokens[1]) = ANY(equipment_starters));

    -- looksLikeTeamScopedAssetTag().
    team_scoped := known_equipment
      OR (rest_value ~ '^[0-9]')
      OR (array_length(rest_tokens, 1) > 1);

    IF prefix = ANY(team_prefixes) AND team_scoped THEN
      value := rest_value;
    ELSIF prefix = ANY(department_prefixes) AND known_equipment THEN
      value := rest_value;
    ELSE
      prefix := NULL;
      value := normalized;
    END IF;
  END IF;

  IF prefix IS NOT NULL THEN
    prefix_rank := 1;
    prefix_value := prefix;
  END IF;

  -- key: trailing "-<digits>" becomes a separate unit token.
  key_value := btrim(regexp_replace(regexp_replace(value, '-([0-9]+)$', ' \1'), '\s+', ' ', 'g'));

  SELECT COALESCE(array_agg(t ORDER BY ord), ARRAY[]::text[])
    INTO key_tokens
    FROM unnest(string_to_array(key_value, ' ')) WITH ORDINALITY AS u(t, ord)
   WHERE t <> '';
  key_count := COALESCE(array_length(key_tokens, 1), 0);

  IF key_count > 0 THEN
    trailing_unit := key_tokens[key_count];
    IF trailing_unit ~ '^[0-9]+$' THEN
      unit_text := COALESCE(NULLIF(ltrim(trailing_unit, '0'), ''), '0');
    END IF;
  END IF;

  IF unit_text IS NULL THEN
    family_tokens := key_tokens;
  ELSE
    family_tokens := key_tokens[1:key_count - 1];
  END IF;

  SELECT btrim(COALESCE(
    string_agg(
      CASE WHEN ord = 1 THEN bg_asset_tag_family_token(t) ELSE t END,
      ' ' ORDER BY ord
    ),
    ''
  ))
    INTO family_key
    FROM unnest(family_tokens) WITH ORDINALITY AS f(t, ord);

  IF COALESCE(family_key, '') = '' THEN
    family_key := key_value;
  END IF;

  RETURN bg_asset_tag_collation_key(family_key)
    || chr(1) || prefix_rank::text
    || chr(1) || CASE
         WHEN unit_text IS NULL THEN repeat('0', 12)
         WHEN length(unit_text) >= 12 THEN unit_text
         ELSE lpad(unit_text, 12, '0')
       END
    || chr(1) || bg_asset_tag_collation_key(prefix_value)
    || chr(1) || bg_asset_tag_collation_key(key_value)
    || chr(1) || bg_asset_tag_collation_key(normalized);
END;
$fn$;

ALTER TABLE "assets"
  ADD COLUMN IF NOT EXISTS "asset_tag_sort_key" TEXT COLLATE "C" NOT NULL DEFAULT '';

UPDATE "assets" SET "asset_tag_sort_key" = bg_asset_tag_sort_key("asset_tag");

-- Keep the column correct for writers that do not go through
-- buildAssetTagSortFields() (seed/import .mjs scripts, manual SQL). The trigger
-- is authoritative, so the JS helper and this function can never produce a
-- table that is ordered by two different algorithms.
CREATE OR REPLACE FUNCTION bg_assets_asset_tag_sort_key_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW."asset_tag_sort_key" := bg_asset_tag_sort_key(NEW."asset_tag");
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS "assets_asset_tag_sort_key" ON "assets";
CREATE TRIGGER "assets_asset_tag_sort_key"
  BEFORE INSERT OR UPDATE OF "asset_tag" ON "assets"
  FOR EACH ROW
  EXECUTE FUNCTION bg_assets_asset_tag_sort_key_trigger();

CREATE INDEX IF NOT EXISTS "assets_asset_tag_sort_key_idx" ON "assets"("asset_tag_sort_key");
