-- Six football badges that read the verified UW and ESPN final score
-- (game_result_observations). A game counts only once both sources agree with
-- each other and with the Schedule result, and each game counts once per person.
--
-- Nothing is backfilled here. The nightly shift pass and profile self-repair
-- award anyone who already qualifies once the first football refresh has stored
-- scores for the season's finished games.

INSERT INTO "badge_definitions" (
  "id", "key", "name", "description", "icon",
  "category", "kind", "trigger", "threshold", "rule_key", "active", "sort_order"
)
VALUES
  ('seed_badge_photo_finish', 'photo_finish', 'Photo Finish', 'Worked a football game decided by three points or fewer.', 'Focus', 'MILESTONE'::"BadgeCategory", 'COUNT'::"BadgeKind", 'shift:completed', 1, 'shift_football_one_score', true, 1560),
  ('seed_badge_giant_killer', 'giant_killer', 'Giant Killer', 'Worked a football win over a ranked opponent.', 'Flame', 'MILESTONE'::"BadgeCategory", 'COUNT'::"BadgeKind", 'shift:completed', 1, 'shift_football_ranked_win', true, 1570),
  ('seed_badge_top_25_regular', 'top_25_regular', 'Top 25 Regular', 'Worked three football games against ranked opponents.', 'ScanSearch', 'MILESTONE'::"BadgeCategory", 'COUNT'::"BadgeKind", 'shift:completed', 3, 'shift_football_ranked_games', true, 1580),
  ('seed_badge_bonus_time', 'bonus_time', 'Bonus Time', 'Worked a football game that went to overtime.', 'Clock3', 'MILESTONE'::"BadgeCategory", 'COUNT'::"BadgeKind", 'shift:completed', 1, 'shift_football_overtime', true, 1590),
  ('seed_badge_prime_time', 'prime_time', 'Prime Time', 'Worked a football game that kicked off at 6 p.m. or later on TV.', 'Sunset', 'MILESTONE'::"BadgeCategory", 'COUNT'::"BadgeKind", 'shift:completed', 1, 'shift_football_prime', true, 1600),
  ('seed_badge_clean_sheet', 'clean_sheet', 'Clean Sheet', 'Worked a football win where the opponent never scored.', 'ShieldCheck', 'MILESTONE'::"BadgeCategory", 'COUNT'::"BadgeKind", 'shift:completed', 1, 'shift_football_shutout', true, 1610)
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
