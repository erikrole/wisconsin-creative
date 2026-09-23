import { neon } from "@neondatabase/serverless";

function rewriteGearTracker(url) {
  const parsed = new URL(url);
  parsed.pathname = "/gear-tracker";
  return parsed.toString();
}

const sql = neon(rewriteGearTracker(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL));
const rows = await sql`
  SELECT
    u.id,
    split_part(u.email, '@', 1) AS email_local,
    u.role,
    u.hidden_from_roster,
    d.key,
    COUNT(*)::int AS n
  FROM student_badges s
  JOIN users u ON u.id = s.user_id
  JOIN badge_definitions d ON d.id = s.definition_id
  WHERE d.key IN ('plan_ahead', 'crew_checkout', 'category_collector')
    AND u.active = true
  GROUP BY u.id, email_local, u.role, u.hidden_from_roster, d.key
  ORDER BY u.hidden_from_roster DESC, n DESC
  LIMIT 12
`;
console.log(JSON.stringify(rows, null, 2));
