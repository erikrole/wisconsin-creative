import { z } from "zod";

/**
 * Remote control for the out-of-town scoreboard at /ots (public/ots/).
 * Stored as one SystemConfig row; the board polls GET /api/ots/control and
 * staff change it from /ots/control.html.
 */
export const OTS_CONTROL_KEY = "ots_control";

/** Scenario names the board understands (DEMO and GAMES in public/ots/board.js). */
export const OTS_SCENARIOS = [
  "cycle",
  "pre-tbd",
  "pre-cle",
  "live",
  "mid",
  "top9",
  "final",
  "final-10",
  "game",
  "walkoff",
  "slam",
  "comeback",
  "extras",
  "sim",
] as const;

export const otsControlInputSchema = z.object({
  // live: follow the MLB feed. demo: play a scenario. hold: freeze the frame on screen.
  mode: z.enum(["live", "demo", "hold"]),
  scenario: z.enum(OTS_SCENARIOS).default("cycle"),
  // MLB gamePk to follow in live mode; null means the board's built-in game.
  gamePk: z
    .string()
    .trim()
    .regex(/^\d{4,9}$/, "Game ID must be MLB's numeric gamePk")
    .nullable()
    .default(null),
});

export type OtsControlInput = z.infer<typeof otsControlInputSchema>;

export type OtsControl = OtsControlInput & {
  updatedAt: string | null;
  updatedBy: string | null;
};

export const DEFAULT_OTS_CONTROL: OtsControl = {
  mode: "live",
  scenario: "cycle",
  gamePk: null,
  updatedAt: null,
  updatedBy: null,
};

/** Read a stored row defensively: anything malformed falls back to live, so the board never goes dark. */
export function normalizeOtsControl(value: unknown): OtsControl {
  const parsed = otsControlInputSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_OTS_CONTROL;
  const meta = (value ?? {}) as { updatedAt?: unknown; updatedBy?: unknown };
  return {
    ...parsed.data,
    updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : null,
    updatedBy: typeof meta.updatedBy === "string" ? meta.updatedBy : null,
  };
}
