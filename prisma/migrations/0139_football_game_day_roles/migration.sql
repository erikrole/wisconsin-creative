-- CreateEnum
CREATE TYPE "FootballGameDayRole" AS ENUM ('SLOW1', 'SLOW2', 'BENCH', 'ROAM1', 'ROAM2', 'ROAM3', 'ROAM4', 'PHOTO1', 'PHOTO2', 'PHOTO3', 'PHOTO4', 'SOCIAL');

-- AlterTable
ALTER TABLE "shift_assignments" ADD COLUMN "football_roles" "FootballGameDayRole"[] NOT NULL DEFAULT ARRAY[]::"FootballGameDayRole"[];
