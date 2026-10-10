## What plays where

- Field House hosts volleyball and wrestling. The boards are the main {{FH_MAIN}}, the top ring {{FH_TOP_RING}} and the scorer's table {{field-house/table}}.
- The Board Builder builds the main and the top ring only. The table has no canvas key or frame rate in the manifest yet, and its zone names will change once it is plugged in, so check the open issues before building for it.

## Main

- The main is small. Most main content is built as an HD overlay with alpha and scaled down by playback (Xpression-style key), not at native size. Treat the main as an overlay: render it as QuickTime with alpha while the other boards render as H.264.
- When a piece is built at native size (matchups, for example), check type at 100% on the native comp; it reads far smaller than on a Camp Randall or Kohl Center main.
- Field House, Goodman and LaBahn mains nest the Kohl Center main card, so a change to that card reaches all four venues.

## Top ring

- The ring is one thin loop. Its content repeats every 864 strip px (the ring shape in the mockups is solved from that), and where the loop starts relative to the stat panels is still unknown. Ask for the ring content spec before relying on a phase.
- Use {{field-house/top-ring/ring-gip-fg}} and the four corners as the fixed pieces; the full ring carries the moving content.
- At full scale a jersey last name nearly fills the ring height, and accents (carons) clip at the top edge. Keep a scale ceiling on ring type.
- In shared PlayerID-style rigs the ring and table are fed by the same ribbon tile as the Kohl Center ribbons: edit the tile once, and check every board it lands on.
- Light rigs: the ring follows the main 3 frames late.

## Full systems

- The volleyball full system is an UHD master with the main, ring and table cut from it, left with an empty render queue so the operator picks the venue codec. It is not a light rig; don't reuse its scripts for one.

## Mockups

- Mask the board, never cut around people. The side main screen is convex, and a facet window comp must never be resized in place (build a new comp).
