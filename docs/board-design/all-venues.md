## Starting a project

- Start every multi-board project from the Wisconsin Board Template (`Wisconsin Board Template.aet`): copy it to `<Project>.aep`, then run `instantiate-family.jsx` with the family name. It renames comps, the folder, labels and expression bodies together. Never rename by hand; a renamed comp does not rewrite the expressions that point at it, and a broken expression silently falls back to its static value.
- Add boards the template lacks with the Board Builder. It reads the pinned manifest, never saves, and is safe to rerun.
- Every board comp starts as a `BOARD BASE` solid in athletics red sized to the comp. Build the look once in `01 - Inputs` and nest it, so one edit reaches every board.
- Name comps `<Family> - <Board> - <Variant>`; prefix output comps with `•`. Inputs are `<Family> - Logo - <Which>` and `Util - <What>`. Spell it LaBahn, not Labahn.
- Control or settings comps referenced only by expression report `usedIn 0`. Never delete them as unused.
- Put operator instructions in guide-layer text inside the comp, not in a README or script.

## Motion

- Hits land exactly on the audio. Every board goes black on the same frame.
- Aux boards follow the main: same brightness, colour and strobes, frame for frame. No travelling light sweeps or wipes across the aux boards.
- No scale breathing on type, logos or groups, on any board. Remove any you find. (The 2026 Steak Fry main is the one kept exception; ask before adding it anywhere.)
- Constantly looping boards use the quiet ambient move: a per-letter opacity cascade with a small drop (about 10 px), ease-out in and ease-in out. No tracking, motion blur or sheen. Each loop opens and closes empty.
- Carry impact with motion and blur, not with rings, sweeps or added graphic devices. When asked for "no effects", strip it back to clean type and timing.
- Keep flashes at or under 3 per second. "Make the peak harder" means more motion, not more flashes.
- Use the plate's own light; don't re-grade or dim real plates.
- Signature write-ons are linear, no easing, 1.0 to 2.0 s.

## Type

- Aux type is quiet: small, around 75% opacity, and on the fascias only. No type on top rings, 300-level corners or tunnels unless asked.
- Headlines: Wisconsin or Aeternus Tall (Heavy/ExtraBold, Height axis 800 or more; PostScript names `AeternusHeavy-Height…`). Sub-heads Gotham Ultra. Gotham weights in use: Ultra, Black, Bold, Medium, Book; no Light, no italics. Dharma is retired.
- Preflight fonts by PostScript name: the share's `GothamHTF-Ultra` is not `Gotham-Ultra`.
- PlayerID uses the original jersey font, never the normalised Jersey Font Cleanup builds (they shrink and lift last names).

## Colour and logos

- Athletics red is #A00000, never campus #C5050C. Red and white lead; black, dark red #900000 and greys stay under about 20% of a graphic.
- Use logos exactly as supplied. The only allowed change is red fill to white on the plain Block W. Block W + Bucky is never modified. No keylines, strokes, outlines or new colours.
- Full-colour Motion W (with stroke) is the default; the white no-stroke W is for solid red only. Full-colour logo on white, white logo on red. Don't stack two logos.

## Sizes and frame rates

- Every size comes from the manifest (this file's Boards section). Never from last season's render, an old project or a vendor file.
- Build each board at its native size. If someone asks for an HD master instead, that's their call; note it and keep the native comp as well.
- Frame rate: use the board's `fps`. When it is null or in conflict, ask; the house default for AE work is 59.94.
- Vendor (196_WISC) comps often arrive at 30 or 29.97. Conform on purpose; don't let them set the project rate.
- Known exception: the 2026 PlayerID master runs at 29.97 on every board by choice. Don't "fix" it.

## Render and delivery

- No proof renders unless asked. Verify by read-back, save, and tell the person what to scrub to.
- Before any aerender run, find comps using the Cinema 4D renderer and fix them (delete junk comps, or switch to Classic 3D / Advanced 3D).
- Render the work area, not the comp length. Purge all caches before judging frames on ribbon and fascia comps; they serve stale frames.
- Opaque boards: H.264 .mp4 at 20 Mbps, no audio unless the board takes audio. Overlays: QuickTime with alpha. H.264 needs even widths.
- Full-size stills: JPG at native size, quality 95, under about 10 MB. PNG only for flat or alpha graphics.
- Name renders after their comp. Version masters `_v01`, `_v02`. Superseded files move to `_superseded/` with a date, never overwritten in place.
- The share holds only the .aep in `_PROJECT/`, linked media in `_ASSETS/` and renders in `_EXPORTS/`. Never scripts or READMEs.
- Render locally first; copy to the share's `_EXPORTS` once approved, and verify the copy byte for byte.
- Every Badger 5 (What Year Was It) render is also copied to Box `Footage Requests/Badger 5/`.
