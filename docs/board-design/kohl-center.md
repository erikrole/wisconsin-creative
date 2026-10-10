## What plays where

- Kohl Center hosts men's and women's basketball, men's hockey and some volleyball. Women's hockey is at LaBahn.
- Basketball uses every board. Men's hockey drops the scorer's table, baseline table and stanchion; leave those off hockey projects.
- Special events (Steak Fry and similar) usually run the main, fascia, 300s, tunnels and top ring only. Ask which boards the event's production plan schedules before building the tables or ring sponsor/corner windows.
- Kohl Center boards play in sync with each other: no propagation delays between boards.

## Centerhung main

- One main feed shows on all four sides of the centerhung.
- The template's Kohl Center main comp has an old height. Resize it to {{KC_MAIN}} before you build, and refit anything nested in it.
- HD versions of the main are requested often. Build them as their own comp (duplicate the card, resize, scale positions and sizes to the new width). Don't nest the native main at a scale, and don't use the North Board main as the HD base (its safe area is offset). The {{kohl-center/main-16-9-feed}} board itself is still unconfirmed.
- Turning an existing HD loop into a main file: fill-crop it to the main size and keep the source frame rate and audio.
- The PlayerID intro slot uses footage at native pixels, so stills must be wide HD frames with the subject in the middle band.
- Headshot intros: one strong zoom-parallax on the transition, then hold dead still. No dip from black.
- Roster slides: eyes on the upper third line. Staff slides are a header and a plain list, one column.
- Overlays for the main render as QuickTime with alpha; opaque mains as H.264 (mains often at 40 Mbps).
- In Display Studio, zone names under Main drop their "Main-" prefix (same for "Ring-" and "Fascia-").

## Top ring and the main as one piece

- The main and the top ring can share one background: stack the ring above the main and let each side's gradient flow up from the main into its ring face.
- The ring is four faces and four corners in one loop: {{kohl-center/centerhung-top-ring/ring-gip-fg}}-sized faces with {{kohl-center/centerhung-top-ring/corner-nw-fg}}-sized corners between them. Face centres sit at x 0 (the seam), 1296, 2592 and 3888; corner centres at 648, 1944, 3240 and 4536. The face on the seam needs a wrap twin at the far end.
- Design the ring as one full render of four seamless faces. A tile must be x-independent or carry wrap twins.
- Scroll slowly. Colosseum's spec says the ring scrolls over 15 s; in practice every ring scroll has been called too fast and halved, ending around one face pitch per 30 s (2592 px a minute). Default slow.
- Full systems: no type on the ring unless asked; in highlight sections the ring can carry a sharp slice of the main, one copy per face pair, meeting on the corners.
- Event loops may put a wordmark or text on ring faces (Steak Fry, Garding Against Cancer). Logos on the ring stay static. Faces may stack type; don't put two logos on one face.
- Ring sponsor windows ({{kohl-center/centerhung-top-ring/sponsor-north-fg}} ×4) and corners are separate deliverables; leave them plain red if the request doesn't include them.

## 360 fascia

- Deliver four zone files only: {{kohl-center/360-fascia/sideline-extended-east-fg}}, {{kohl-center/360-fascia/sideline-extended-west-fg}} and {{kohl-center/360-fascia/endzone-gip-fg}} for north and south. Together they cover the whole ring. Don't render the full fascia canvas unless the board operator asks; the zones are what plays. If a full canvas is ever needed, assemble it from the four files.
- Older projects (WBB loops) split the fascia into sideline and endzone pieces instead. That split is retired; don't copy it.
- Build one continuous ring master at the full ring length, then cut the zones from it. Per-zone gradients look broken at the corners.
- Every zone file stands alone: no text or logo crosses a cut, and each zone's layout is centred and balanced inside it. Only the background gradient runs continuously across cuts.
- Anchor sideline content on center court, which sits in the middle of the sideline span of a Sideline Extended file (after the stat window at its start). The end stat windows belong to the Sideline Extended files; keep text clear of them.
- The endzone is one lockup centred on the GIP, never two.
- One line of type on the fascia; never stack. Caps around 40 px on the fascia height read well.
- Never let a stretch go fully black; it reads as the LED being off. Keep a floor (about 45% in light rigs).
- A mirrored copy of one Sideline Extended file for both sides is fine when the design is symmetric.
- Full systems: type lives on the sideline fascia only, small and around 75% opacity, left-justified at its final width so reveals don't shift. East follows the main's left box-light wall, West the right wall (built mirrored). The compass naming of the ring (E-N-W-S order) is assumed, not confirmed.
- Motion Tile can't produce the full sideline width (output width × layer width must stay under 30,000 px) and fails silently. Build light bars as repeated copies instead.
- A fascia "mod map" is a PNG, never a movie.

## 300 level and tunnels

- 300 corners ({{KC_300_LEVEL}}) are a one-line strip: W, message, W. Corner features ({{kohl-center/300-level-tunnels/corner-left-se-fg}}) are odd-width: H.264 drops a column and corrupts the last row, so render lossless and crop one column, or deliver QuickTime Animation at full width. Colosseum expects corner features with alpha; confirm which the operator wants.
- Tunnels ({{KC_TUNNEL}}) may stack two short lines; logos read small here, so give them a bigger slot.
- Full systems: no type on the 300s or tunnels unless asked.

## Tables and stanchion (basketball)

- The scorer's table {{KC_SCORERS_TABLE}}, baseline table {{KC_BASELINE_TABLE}} and stanchion {{KC_STANCHION}} are basketball only.
- Tables cycle one message at a time with the ambient per-letter move; the scorer's table carries a W at each end. Colosseum prefers logos only on the baseline and logo only on the stanchion (text is hard to read there).

## Loops

- Ambient and practice loops run 2:00 (they're on for hours). Event welcome loops run about 60 s; shorten to 30 s when asked. Every loop opens and closes empty.

## Look

- Linear gradients over radial "orbs" on these flat boards.
- Grain: Noise HLS (grain type, lightness about 0.05), static, so loop seams match.
- The project blends in linear sRGB: low opacities and effect amounts read much stronger in dark tones, so judge from a render frame, not from slider values.
- Sponsors: look in the Learfield Box first (Signage > Logos for Main Videoboard), then the share's sponsorship logos. On red, use all-white co-brand logos.

## Rendering template projects

- aerender crashes on the template's `•<Family> - All` sheet. Reduce the project to the comps you need on a temporary copy, then render.
