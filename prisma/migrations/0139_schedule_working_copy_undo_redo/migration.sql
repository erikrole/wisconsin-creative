-- Keep the private Schedule editor's inverse history beside the optimistic
-- version. Each stack contains validated before/after payload snapshots and
-- actor ids; the service changes them in the same serializable write as the
-- working version, so a stale operator cannot undo a newer edit.
ALTER TABLE "shift_group_working_copies"
    ADD COLUMN "undo_stack" JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN "redo_stack" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "shift_group_working_copies"
    ADD CONSTRAINT "shift_group_working_copies_undo_stack_array_check"
        CHECK (jsonb_typeof("undo_stack") = 'array'),
    ADD CONSTRAINT "shift_group_working_copies_redo_stack_array_check"
        CHECK (jsonb_typeof("redo_stack") = 'array');
