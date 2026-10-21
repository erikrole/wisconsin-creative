-- Grant BTN and Learfield access to the read-only brand asset library.
-- The data migration is additive and idempotent. Policies only receive a new
-- immutable revision when the grant did not already exist.
WITH target_policies AS (
  SELECT p.id
  FROM collaborator_policies p
  INNER JOIN collaborator_affiliations a ON a.id = p.affiliation_id
  WHERE a.key IN ('BIG_TEN_NETWORK', 'LEARFIELD')
),
inserted_grants AS (
  INSERT INTO collaborator_policy_grants (id, policy_id, capability_key)
  SELECT
    CONCAT('grant_brandassets_', SUBSTRING(MD5(p.id), 1, 20)),
    p.id,
    'BRAND_ASSETS_VIEW'
  FROM target_policies p
  ON CONFLICT (policy_id, capability_key) DO NOTHING
  RETURNING policy_id
),
updated_policies AS (
  UPDATE collaborator_policies p
  SET version = p.version + 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE p.id IN (SELECT policy_id FROM inserted_grants)
  RETURNING p.id, p.version, p.status
)
INSERT INTO collaborator_policy_revisions (
  id,
  policy_id,
  version,
  status,
  capabilities,
  actor_user_id,
  created_at
)
SELECT
  CONCAT('revision_brandassets_', SUBSTRING(MD5(u.id || ':' || u.version::TEXT), 1, 18)),
  u.id,
  u.version,
  u.status,
  (
    SELECT JSONB_AGG(c.capability_key ORDER BY c.capability_key)
    FROM (
      SELECT g.capability_key
      FROM collaborator_policy_grants g
      WHERE g.policy_id = u.id
      UNION
      SELECT 'BRAND_ASSETS_VIEW'
    ) c
  ),
  NULL,
  CURRENT_TIMESTAMP
FROM updated_policies u
ON CONFLICT (policy_id, version) DO NOTHING;
