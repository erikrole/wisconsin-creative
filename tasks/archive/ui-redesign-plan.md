# UI Redesign Plan — Clean Editorial + Gotham + Wisconsin Red

**Date**: 2026-03-25
**Aesthetic**: Clean Editorial — refined typography, deliberate spacing, brand-forward color
**Font**: Gotham (heading/display) + Geist Sans (body/UI) — Gotham infrastructure with system fallback until .woff2 files are added
**Primary color**: Wisconsin Red (#c5050c) for actions, active states, brand moments
**Philosophy**: Intentional, not intense. Every element earns its place.

## Design Direction

**What "Clean Editorial" means for Wisconsin Creative:**
- Gotham headings with tight tracking create authority and sports-brand feel
- Wisconsin Red as primary action color (buttons, links, active sidebar) — not just a decoration
- Warm neutral backgrounds with subtle texture — not flat white
- Clear typographic hierarchy: bold Gotham headings vs refined Geist body text
- Generous whitespace in content areas, tighter density in data tables
- Subtle depth through refined shadows and border treatments
- Motion: purposeful staggered reveals, smooth state transitions, no gratuitous animation

## Slices

### Slice 1: Design Tokens (globals.css)
- [ ] Set up Gotham @font-face with fallback stack (Barlow, system)
- [ ] Update --font-heading to use Gotham
- [ ] Promote --wi-red to --accent / --primary (buttons, links, active states)
- [ ] Update dark mode red variants for proper contrast
- [ ] Refine background colors: warmer tone, subtle surface differentiation
- [ ] Add subtle background texture utility class
- [ ] Update button tokens: Wisconsin Red primary buttons
- [ ] Refine focus ring to use brand red
- [ ] Update shadcn semantic token mappings

### Slice 2: Sidebar
- [ ] Wisconsin Red accent on active nav item
- [ ] Gotham font for nav labels
- [ ] Refined hover/active states with red accent
- [ ] Brand mark/logo area treatment

### Slice 3: Login Page
- [ ] Gotham headline treatment
- [ ] Wisconsin Red gradient (red → dark) replacing current gradient
- [ ] Refined card with subtle shadow and border
- [ ] Brand typography hierarchy

### Slice 4: Dashboard
- [ ] Gotham headings throughout
- [ ] Stat cards with brand color accents
- [ ] Refined card borders and shadows
- [ ] Enhanced staggered reveal animations

### Slice 5: Items Page
- [ ] Heading typography update
- [ ] Table refinements (row hover, header weight)
- [ ] Action button color update

### Slice 6: Events & Scan
- [ ] Consistent heading treatment
- [ ] Badge and status color refinements
- [ ] Scan page brand consistency

### Slice 7: Global Components
- [ ] Button variants: red primary, refined secondary
- [ ] Card border/shadow refinement
- [ ] Badge typography tightening
- [ ] Input focus states with brand red ring

## Font Strategy

Gotham is a commercial font. Infrastructure is set up to load from `/public/fonts/`:
- `Gotham-Bold.woff2` → weight 700 (headings)
- `Gotham-Medium.woff2` → weight 500 (subheadings, nav)
- `Gotham-Book.woff2` → weight 400 (body fallback)

Until font files are added, the stack falls through to:
`"Gotham", "Barlow", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

Barlow is a close open-source match for Gotham's geometric character.
