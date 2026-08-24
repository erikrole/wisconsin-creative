-- Preserve source-derived tie outcomes separately from wins and losses.
-- The raw source marker is the only evidence used for this additive backfill.

ALTER TYPE "CalendarEventResult" ADD VALUE IF NOT EXISTS 'TIE';
