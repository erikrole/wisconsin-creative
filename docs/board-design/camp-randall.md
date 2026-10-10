## Frame rates

- Camp Randall boards run at 60 fps. Only the 16:9 feed variants (the North Board HD feed and the IPTV full screen) are 59.94. When a ported project mixes 59.94 and 60, fix it to 60.
- The template runs 60 fps, 896 frames (14.933 s). Aux boards in a full system loop on that length while the main plays its video; keep that one loop constant even inside longer comps.
- Tempos: pick a BPM that lands beats on whole frames at 60 fps (128.571 BPM = 28 frames a beat; exactly 128 drifts). Never round a measured tempo.

## North Board: build as one, render as parts

- The North Board is built as one board and rendered as its parts (main, frames, wings, stat windows). Build one full-board background and nest it into every part at its own offset, so wings and frames register exactly. A wing background fitted to the wing instead of registered to the board shows a visible rectangle.
- Each wing keeps its own animated W. Takeover type must not bleed into wings or stat windows.
- Pops bleed onto every part (wings, stats, scrims, Kellner wing wrappers) so separately rendered files read as one board. Kellner and the Daily Driver get the pop through nesting; adding it there again doubles it.
- Show end slates board by board on the Daily Driver sheet, never as one big image.
- Mockup setting: `North Board - Main Options` stays at 1 (Main_Standalone + short wings). Check it by render.

## North Board: GIP and safe areas

- The GIP is an in-game scoreboard composited OVER the bottom of the main video. It is an overlay, not a crop: background can run behind it to the bottom edge, but lockups and important content must clear it.
- Its height is not settled. The manifest's {{north-board/gip}} is marked TBD, but on 09-29 the band was confirmed as the bottom 140 px of the main. Until boards.json changes, keep lockups clear of the larger value (bottom 155 px) and flag the open issue.
- The main video deliverable is `Main_Standalone` at {{MAIN_VIDEO}}. It cover-fits HD media (161.25%).
- The HD feed is a different crop. The board shows only {{north-board-hd-feed/visible-on-the-board}} of {{MAIN_HD}}, but concourse and suite TVs show the full frame, so finish the cropped bands too. Centre feed content on the visible band, not the frame.
- The North Board main design sits off-centre on purpose to suit that crop. Don't re-centre it, and don't use it as the base for other venues' HD mains.
- Photo windows crop tighter than 16:9: bias portraits high and keep helmets low. No red showing through photo dissolves.
- Burned-in captions on the feed use the Camp Randall caption preset (snapped to 59.94) and the Camp Randall safe guide in `RESOURCES/GUIDES/Camp Randall Videoboard/`.

## North Board: frames, wings, scrims and ads

- The speaker scrims cover the inner top corner of each frame ({{north-board/frame-left}}, {{north-board/frame-right}}); leave that area blank. Over a lifted background they read as hard black rectangles. The Daily Driver scrim art is Target (left) and UW Health (right); the mockups mask those panels as static signs.
- Stat windows ({{STAT_LEFT}}, {{STAT_RIGHT}}) are stills by spec and show real game stats in-game; the template hides them. Projects sometimes animate them anyway; confirm before delivering motion there.
- The bottom ad windows ({{BOTTOM_AD_LEFT}}) are the largest unused area in a takeover, and stills by spec.
- Middle ads and fascia ads take different art per side: end file names in `_left` or `_right`.
- Wing logos sit centred on the short wing, not aligned to the main lockup's axis. A throwback wing W is an accent rising from the bottom edge, not the main event.
- Bucky belongs on the main boards (North main, Kellner, Kohl Center main), not the wings.

## Kellner

- Kellner is one full board: build {{KELLNER}} and window the main ({{KELLNER_MAIN}}) out of it, the same way as the North Board. Colosseum's rule is main or wings, one or the other.
- It usually mirrors the main's centre picture, and stays out of fascia lighting rigs.
- Overlays on Kellner render as QuickTime with alpha.
- The four Kellner ad stills have never been filled by a project.

## East and West fascias

- East and West are two separate boards, each {{FASCIA_FULL}}: ad left, GIP in the middle ({{west-fascia/gip-west}}), ad right. The usual "Fascia" deliverable is the ad window ({{FASCIA_AD_LEFT}}), used on both sides.
- Lighting one fascia as a single unit fires both sidelines at once and nothing reads as travelling; split it into segments.
- Run the two sideline fascias opposite each other. To mirror a fascia, mirror positions and flip the background, never the artwork, so letters stay readable.
- Flow: the grass flows away from the North Board, letters flow toward it. When asked to "reverse direction", ask which element.
- One centred message with a Motion W each side reads best. Repeated stats: three per side at most.
- No ticker drift on the fascias.

## South end zone fascias (SEZ)

- Upper: the left board is {{SEZ_UPPER_LEFT}}. The right board is {{SEZ_UPPER_RIGHT}}, but its last part, the angle ({{south-upper-fascia/angle}}), is the kickout covered by out-of-town scores. Treat only its first stretch (the same width as the left board) as playable: reuse the left comp on the right, left-aligned, and leave the angle bare. The right board is usually switched off and the left file delivered as "SEZ Upper".
- H.264 writes the upper-left file one pixel narrower (odd width); that's expected.
- Lower: two ad windows either side of a GIP ({{south-lower-fascia/gip}}). "SEZ Lower" is one file, {{SEZ_LOWER_LEFT}}, used on both sides. Keep content out of the GIP.
- On 60 px ribbons, cap Ws at 80% of board height (a Block W height-matched to a Motion W overflows). Size logos by their ink, not the file box.
- Boards of the same size start with the same number of logos: derive the count from width divided by one shared pitch, and space marks evenly.
- Sheen, keylines and hairline motion don't survive on boards under about 500 px on their short side (fascias, Kellner wings, Section A); judge them at full resolution, 1:1.
- Aeternus is too small for names on aux boards; use Gotham Ultra.

## Section A

- The GIP is at the top ({{SECTION_A_GIP}}, stills); the main video is below it ({{SECTION_A_MAIN}}). Fill both; the contact sheet shows the full board.
- Its physical position isn't in either mockup. Ask before power-pinning it.
- It usually mirrors the main's centre picture and stays out of fascia lighting rigs.

## Captioning and IPTV

- The captioning board ({{CLOSED_CAPTION}}) takes stills; it is not the same thing as burned-in captions on the HD feed.
- IPTV full screens ({{IPTV_FULL_SCREEN}}) run exactly 15 s with a 100 px title safe. The video wall full ({{IPTV_VIDEO_WALL_FULL}}) is for special events only and isn't sold to sponsors.

## Seams and the 360 lap

- A lap is boards lighting in sequence, not comets or sliding light. Ring order: North, East, South lefts, South rights, Section A, West.
- Any wrap needs three copies (x − width, x, x + width); two copies drop part of the element for a frame every lap. Count laps by accumulation from the downbeat.
- Ribbon tiles split their lockup across the tile edges so it reassembles at the seam. Doubling a tile halves the loop; check the loop still closes.
- LED pixel pitch isn't written down anywhere, and the fascias differ in height, so don't assume boards share a pitch.

## Timing across boards

- Audio-synced shows (Kickoff, Run Out) play once, with every board going black on the same frame and identical pop frames everywhere.
- Light rigs that propagate from the main use these delays in frames: wings 2, stats 3, E/W fascias 5 to 7, Kellner 12, SEZ upper 16, SEZ lower 18. Only use them when the piece is meant to travel; recognition entrances stay in sync.
- Kick Cover plays during field goals: logos animate in and never out, and the background doesn't move.
- Stadium audio ceiling: -6 dBTP.

## Delivery

- Recognition families (Honorary Captain, Internal Recognition) deliver Fascia, SEZ Upper, SEZ Lower, Short Wing Left/Right, Main and Full System (the rendered `CR - All` sheet), named `<Piece> - <Name> - <Board>.mp4`.
- Deliver final files 2 weeks before the season opener, or 1 week before an event in season.
