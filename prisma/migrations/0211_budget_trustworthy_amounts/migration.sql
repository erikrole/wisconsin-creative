-- Preserve the current view as a migration-time baseline. This does not claim to
-- reconstruct a historical submission; later captures are explicit and audited.
ALTER TABLE "budgets"
  ADD COLUMN "submitted_cents" INTEGER,
  ADD COLUMN "submitted_unknown_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "submitted_at" TIMESTAMP(3),
  ADD COLUMN "submitted_source" TEXT;

ALTER TABLE "budget_lines"
  ADD COLUMN "unit_cost_known" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "planned_override_cents" INTEGER,
  ADD COLUMN "planned_total_known" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "status_known" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "submitted_included" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "submitted_amount_cents" INTEGER;

-- Recover the explicitly transcribed price from the import notes only when the
-- note itself says that a zero unit cost was used as a placeholder. Leave all
-- other rows and notes untouched. The original note remains available for audit.
WITH prices AS (
  SELECT id,
    regexp_match(justification, '(?i)(?:listed unit price|price)[[:space:]]*\$([0-9,]+(?:\.[0-9]{1,2})?)') AS amount
  FROM budget_lines
  WHERE unit_cost_cents = 0
    AND justification ~* '(\$0 (entered|cost)|unit cost (set to|\$0 represents)|\$0 and quantity)'
)
UPDATE budget_lines AS line
SET unit_cost_cents = (replace(prices.amount[1], ',', '')::numeric * 100)::integer,
    planned_override_cents = 0
FROM prices
WHERE line.id = prices.id AND prices.amount IS NOT NULL;

-- These exact phrases were written when importing a blank/X total or an
-- unknown unit price. An explicit source $0 remains a known zero.
UPDATE budget_lines
SET planned_total_known = false
WHERE (unit_cost_cents = 0 OR planned_override_cents = 0)
  AND (justification ~* '(source total was blank|budget total (was )?(marked x|and (actual spend|spent) (were|was) (blank|marked x))|budget total,? and (actual )?spend were blank|budget total and actual spend were blank|budget total and spent were marked x|budget total was blank|budget total marked x)'
   OR (justification ~* 'no price, quantity or category recorded' AND justification !~* 'total \$0'));

UPDATE budget_lines
SET unit_cost_known = false
WHERE unit_cost_cents = 0 AND justification ~* 'no price, quantity or category';

UPDATE budget_lines
SET status_known = false
WHERE status = 'PLANNED' AND justification ~* '(source did not record purchase status|no purchase status recorded|purchase status (is )?(not recorded|unknown)|status (is )?unknown|unknown.status)';

UPDATE budget_lines
SET submitted_included = NOT unplanned,
    submitted_amount_cents = CASE
      WHEN unplanned OR NOT planned_total_known THEN NULL
      ELSE COALESCE(planned_override_cents, unit_cost_cents * quantity)
    END;

UPDATE budgets AS b
SET submitted_cents = totals.known_total,
    submitted_unknown_count = totals.unknown_count,
    submitted_at = CURRENT_TIMESTAMP,
    submitted_source = 'upgrade'
FROM (
  SELECT budget_id,
    COALESCE(SUM(submitted_amount_cents), 0)::integer AS known_total,
    COUNT(*) FILTER (WHERE submitted_included AND submitted_amount_cents IS NULL)::integer AS unknown_count
  FROM budget_lines GROUP BY budget_id
) AS totals
WHERE b.id = totals.budget_id;
