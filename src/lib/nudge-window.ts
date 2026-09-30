/**
 * The nudge route stores at most one nudge per booking per hour. Clients use
 * this to show a recent nudge as already sent rather than offering a repeat.
 */
export const NUDGE_REPEAT_WINDOW = 60 * 60 * 1000;
