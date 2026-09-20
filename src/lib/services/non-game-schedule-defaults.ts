import { Prisma, ShiftArea } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

export const NON_GAME_SCHEDULE_DEFAULTS_KEY = "schedule_non_game_defaults";

const rowSchema = z.object({
  area: z.nativeEnum(ShiftArea),
  staffCount: z.number().int().min(0).max(20),
  studentCount: z.number().int().min(0).max(20),
});

export const nonGameScheduleDefaultsSchema = z.object({
  shiftStartOffset: z.number().int().min(0).max(480),
  shiftEndOffset: z.number().int().min(0).max(480),
  shiftConfigs: z.array(rowSchema).max(Object.values(ShiftArea).length).superRefine((rows, ctx) => {
    const seen = new Set<ShiftArea>();
    rows.forEach((row, index) => {
      if (seen.has(row.area)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "area"], message: "Areas must be unique" });
      }
      seen.add(row.area);
    });
  }),
});

export type NonGameScheduleDefaults = z.infer<typeof nonGameScheduleDefaultsSchema>;

const DEFAULT_NON_GAME_SCHEDULE_DEFAULTS: NonGameScheduleDefaults = {
  shiftStartOffset: 60,
  shiftEndOffset: 60,
  shiftConfigs: Object.values(ShiftArea).map((area) => ({ area, staffCount: 0, studentCount: 0 })),
};

function normalizeNonGameScheduleDefaults(value: Prisma.JsonValue | null | undefined): NonGameScheduleDefaults {
  const parsed = nonGameScheduleDefaultsSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_NON_GAME_SCHEDULE_DEFAULTS;
  const byArea = new Map(parsed.data.shiftConfigs.map((row) => [row.area, row]));
  return {
    ...parsed.data,
    shiftConfigs: Object.values(ShiftArea).map((area) => byArea.get(area) ?? { area, staffCount: 0, studentCount: 0 }),
  };
}

export async function getNonGameScheduleDefaults(tx: Prisma.TransactionClient | typeof db = db) {
  const row = await tx.systemConfig.findUnique({ where: { key: NON_GAME_SCHEDULE_DEFAULTS_KEY } });
  return normalizeNonGameScheduleDefaults(row?.value);
}
