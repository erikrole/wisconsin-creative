-- CreateTable
CREATE TABLE "student_availability_saves" (
    "actor_id" TEXT NOT NULL,
    "request_id" UUID NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "block_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_availability_saves_pkey" PRIMARY KEY ("actor_id","request_id")
);

-- AddForeignKey
ALTER TABLE "student_availability_saves" ADD CONSTRAINT "student_availability_saves_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
