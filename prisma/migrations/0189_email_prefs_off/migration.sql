-- Email notifications became opt-in. Turn off the email channel for everyone who
-- had saved it on; invites and password resets bypass preferences and are unaffected.
UPDATE "users"
SET "notification_prefs" = jsonb_set("notification_prefs", '{channels,email}', 'false'::jsonb)
WHERE "notification_prefs" #>> '{channels,email}' = 'true';
