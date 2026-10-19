-- UA gear: pieces physically handed out to each person, one row per assigned piece.
CREATE TABLE "gear_pick_handouts" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "handed_out_at" TIMESTAMP(3) NOT NULL,
    "handed_out_by_id" TEXT,

    CONSTRAINT "gear_pick_handouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gear_pick_handouts_cycle_id_user_id_sku_size_source_key" ON "gear_pick_handouts"("cycle_id", "user_id", "sku", "size", "source");
CREATE INDEX "gear_pick_handouts_user_id_idx" ON "gear_pick_handouts"("user_id");

ALTER TABLE "gear_pick_handouts" ADD CONSTRAINT "gear_pick_handouts_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "gear_pick_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gear_pick_handouts" ADD CONSTRAINT "gear_pick_handouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
