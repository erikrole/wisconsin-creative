-- Six badges built from data the app already stores: two long ladder rungs,
-- a home-football chase, and three hidden game-day and calendar surprises.
--
-- Nothing is backfilled here. The ladder rungs and measured rules are counted
-- from existing rows, so the nightly shift pass, the next checkout or return,
-- and profile self-repair award anyone who already qualifies.

INSERT INTO "badge_definitions" (
  "id", "key", "name", "description", "icon",
  "category", "kind", "trigger", "threshold", "rule_key", "active", "sort_order"
)
VALUES
  ('seed_badge_on_time_100', 'on_time_100', 'Centurion', 'Returned 100 checkouts on time.', 'AlarmClockCheck', 'ON_TIME'::"BadgeCategory", 'COUNT'::"BadgeKind", 'checkout:returned', 100, 'on_time_return', true, 135),
  ('seed_badge_shift_100', 'shift_100', 'Iron Crew', 'Worked 100 event shifts.', 'Dumbbell', 'SHIFT'::"BadgeCategory", 'COUNT'::"BadgeKind", 'shift:completed', 100, NULL, true, 335),
  ('seed_badge_fifth_quarter', 'fifth_quarter', 'Fifth Quarter', 'Worked five home football games.', 'AudioLines', 'MILESTONE'::"BadgeCategory", 'COUNT'::"BadgeKind", 'shift:completed', 5, 'shift_home_football', true, 1520),
  ('seed_badge_axe_crew', 'axe_crew', 'Axe Crew', 'Worked the Minnesota football game, played for Paul Bunyan’s Axe.', 'Trophy', 'MILESTONE'::"BadgeCategory", 'COUNT'::"BadgeKind", 'shift:completed', 1, 'shift_axe_game', true, 1530),
  ('seed_badge_homecoming', 'homecoming', 'Homecoming', 'Worked the Homecoming football game.', 'Ticket', 'MILESTONE'::"BadgeCategory", 'COUNT'::"BadgeKind", 'shift:completed', 1, 'shift_homecoming', true, 1540),
  ('seed_badge_pi_day', 'pi_day', 'Pi Day', 'Opened a gear checkout on March 14.', 'Timer', 'MILESTONE'::"BadgeCategory", 'COUNT'::"BadgeKind", 'checkout:opened', 1, 'checkout_pi_day', true, 1550)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "icon" = EXCLUDED."icon",
  "category" = EXCLUDED."category",
  "kind" = EXCLUDED."kind",
  "trigger" = EXCLUDED."trigger",
  "threshold" = EXCLUDED."threshold",
  "rule_key" = EXCLUDED."rule_key",
  "active" = EXCLUDED."active",
  "sort_order" = EXCLUDED."sort_order";
