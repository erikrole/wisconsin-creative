-- Pinned and hidden sidebar pages follow a person across browsers and devices.
-- Null until they first customize the sidebar; the browser copy stays the instant cache.
ALTER TABLE "users"
  ADD COLUMN "sidebar_prefs" JSONB;
