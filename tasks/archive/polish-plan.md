# Wisconsin Creative — Polish & Enhancement Plan

## Context
The core mobile responsive pass is complete (app shell, dashboard, booking lists, forms, calendar/reports, scan page, creation flows). This plan covers the remaining 10 areas of polish: item detail mobile, notifications mobile, settings/profile mobile, search UX, empty states, dark mode, accessibility, performance, and PWA/offline support.

Ordered by **user impact** — student-facing features first, then infrastructure.

---

## Slice 1: Item Detail Page — Mobile Fix

**Priority:** High (students view item details constantly)
**Files:** `src/app/(app)/items/[id]/page.tsx`, `src/app/globals.css`

1. **Action buttons row** — Three buttons (Reserve, Check out, Actions) with 100px min each overflow 375px. At 768px: stack vertically or use icon-only compact buttons. Replace inline `minWidth` with CSS class
2. **Tab navigation** — 6 tabs don't fit horizontally. At 768px: make `.item-tabs` horizontally scrollable with `overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none` and hide scrollbar
3. **Data tables** — Booking/reservation history tables force 500px min-width scroll. Add mobile card layout alternative at 768px similar to BookingListPage
4. **Calendar month label** — Inline `minWidth: 160px` blocks responsive. Replace with CSS class
5. **Data grid** — Already has `data-list-2col` → 1col override. Verify label widths (90px fixed) don't cramp values on mobile
6. **Booking card metadata** — `justify-content: space-between` breaks on narrow screens. Stack vertically at 768px

**Verification:** Build passes, test at 375px/390px/430px

---

## Slice 2: Notifications Page — Mobile Fix

**Priority:** High (students check notifications frequently)
**Files:** `src/app/(app)/notifications/page.tsx`, `src/app/globals.css`

1. **Extract inline styles to CSS classes** — 20+ inline style declarations on notification cards. Create `.notification-card`, `.notification-dot`, `.notification-title`, `.notification-body`, `.notification-actions`, `.notification-meta` classes
2. **Action buttons** — Two buttons ("View reservation" + "Mark read") overflow at 375px. Add `flex-wrap: wrap` and stack vertically at 768px
3. **Page header** — Title + badge + buttons squeeze at 375px. Stack header actions below title at 768px
4. **Touch targets** — Action buttons use `btn-sm` (36px). Increase to 44px on mobile
5. **Pagination** — "Showing X-Y of Z" text and buttons squeeze. Stack vertically at 768px

**Verification:** Build passes, test at 375px

---

## Slice 3: Settings & Profile Pages — Mobile Fix

**Priority:** Medium (admins use settings, students use profile)
**Files:** `src/app/(app)/settings/categories/page.tsx`, `src/app/(app)/settings/database/page.tsx`, `src/app/(app)/profile/page.tsx`, `src/app/globals.css`

### Categories page:
1. **Hardcoded input widths** — `width: 200` and `width: 260` overflow 375px. Replace with `min(200px, 100%)` or CSS classes
2. **Nested category padding** — `paddingLeft: 24 + depth * 24` causes deep items to overflow. Cap max indent on mobile
3. **Search input** — `width: 260` hardcoded. Make responsive

### Database page:
4. **Table padding** — Inline `padding: "8px 16px"` per cell is wide at 375px. Reduce on mobile
5. **Status badges** — `fontSize: 11, padding: "2px 8px"` are tiny touch targets. Increase on mobile

### Profile page:
6. **Form maxWidth** — `maxWidth: 520` is wider than 375px viewport. Replace with `min(520px, 100%)`
7. **Input touch targets** — `.form-input` / `.form-select` at 36px min-height. Increase to 44px on mobile with `font-size: 16px`
8. **User roles table** — 4-column table is unreadable at 375px. Add horizontal scroll or mobile card layout

**Verification:** Build passes, test at 375px

---

## Slice 4: Search Experience

**Priority:** Medium-High (core navigation feature)
**Files:** `src/components/AppShell.tsx`, `src/app/globals.css`, possibly new `src/app/(app)/search/page.tsx`

1. **Mobile search icon** — At 768px, replace the topbar search input with a search icon button. Tapping it expands a full-width search overlay or navigates to a dedicated search page
2. **Search page** — Create `/search` page with autofocus input, recent searches, and results grouped by type (items, checkouts, reservations, users). Hit `/api/items?search=`, `/api/checkouts?search=` etc.
3. **Search input iOS zoom prevention** — Ensure `font-size: 16px` on search inputs
4. **Keyboard shortcuts** — Add `Cmd+K` / `Ctrl+K` to open search (desktop only)

**Verification:** Build passes, search works on mobile and desktop

---

## Slice 5: Empty States & Onboarding

**Priority:** Medium (first-time user experience)
**Files:** `src/components/EmptyState.tsx`, various page files, `src/app/globals.css`

1. **Consistent empty state usage** — Events page, calendar, and settings pages use plain text divs instead of `<EmptyState>`. Replace with the component for consistency
2. **First-run dashboard** — When there are 0 items and 0 checkouts, show a welcome card with quick-start steps: "Add your first item", "Import from spreadsheet", "Set up calendar sync"
3. **Empty state animations** — Add subtle fade-in animation to `<EmptyState>` component
4. **Loading skeletons everywhere** — Replace spinner-only loading in notifications, reports, events, and calendar pages with `<SkeletonTable>` or `<SkeletonCard>` components
5. **Error states** — Ensure all pages that fetch data have proper error states with retry buttons (some just silently fail)

**Verification:** Build passes, verify each empty state renders correctly

---

## Slice 6: Dark Mode

**Priority:** Medium (students often use phones at night/in dark venues)
**Files:** `src/app/globals.css`, `src/app/layout.tsx`, `src/components/AppShell.tsx`, possibly new `src/lib/theme.ts`

1. **CSS variable dark palette** — Define all `--text`, `--bg`, `--panel`, `--border`, `--accent`, `--shadow` variables under `@media (prefers-color-scheme: dark)`. Keep Wisconsin red as accent
2. **Sidebar already dark** — The sidebar is dark by design. Ensure it doesn't double-darken in dark mode. May need sidebar-specific overrides
3. **Manual toggle** — Add theme toggle button in sidebar footer or profile. Store preference in `localStorage` with `data-theme="dark"` on `<html>`. Respect system preference as default
4. **Badge colors** — Ensure all badge variants (green, red, blue, purple, orange, gray) have sufficient contrast in dark mode
5. **Glassmorphism adjustments** — `backdrop-filter: blur()` with dark backgrounds needs different opacity/tint values
6. **Form inputs** — Ensure inputs, selects, and textareas have visible borders and readable text in dark mode
7. **Images & icons** — Verify SVG icons (inline) adapt to text color. Any raster images may need dark-mode-friendly backgrounds

**Verification:** Build passes, test all pages in dark mode, verify WCAG AA contrast ratios

---

## Slice 7: Accessibility Pass

**Priority:** High (legal compliance, inclusive design)
**Files:** `src/app/layout.tsx`, `src/components/AppShell.tsx`, `src/components/Modal.tsx`, `src/components/ConfirmDialog.tsx`, `src/app/globals.css`, various page files

1. **Skip-to-content link** — Add visually hidden skip link at top of layout that becomes visible on focus. Target `#main-content` on the `.app-main` element
2. **Semantic landmarks** — Add `<main>`, `<nav>`, `<aside>` elements to AppShell layout. Sidebar → `<aside>`, content area → `<main>`, bottom nav → `<nav>`
3. **sr-only utility class** — Add `.sr-only` class to globals.css for visually hidden text
4. **Form label associations** — Add `htmlFor` attributes to all form labels across all pages (currently 0 found). This is a sweep across every page with forms
5. **Modal focus trap** — Implement focus trapping in Modal.tsx and ConfirmDialog.tsx. On open: move focus to first focusable element. On close: return focus to trigger element
6. **Icon button labels** — Audit all icon-only buttons for `aria-label`. Add labels where missing (kebab menus, close buttons, sort buttons, filter toggles)
7. **Live regions** — Add `aria-live="polite"` to toast/notification areas and form validation messages
8. **Reduced motion** — Already has `prefers-reduced-motion` for some animations. Audit that ALL animations respect this (dash-fade-up, stat hover lift, event row slide, scan celebration)
9. **Color contrast audit** — Verify `--text-muted` and `--text-secondary` meet 4.5:1 contrast ratio against backgrounds. Fix if not

**Verification:** Build passes, test with VoiceOver on iOS, keyboard-only navigation through all flows

---

## Slice 8: Performance Optimization

**Priority:** Medium (affects perceived speed)
**Files:** `next.config.ts`, `src/app/globals.css`, various page files, `package.json`

1. **Dynamic imports** — Add `next/dynamic` for heavy page components: calendar grid, reports charts, scan page (QR scanner already dynamic). Reduces initial JS bundle
2. **next/image** — Replace any `<img>` tags with `next/image` for automatic optimization, lazy loading, and responsive sizing
3. **CSS splitting** — Consider breaking `globals.css` (4700+ lines) into component-scoped CSS modules or at least lazy-loaded route-specific chunks. Evaluate effort vs. benefit
4. **Bundle analysis** — Add `@next/bundle-analyzer` to package.json for visibility. Run once to identify largest chunks
5. **API response optimization** — Ensure API routes use `select` in Prisma queries to avoid over-fetching fields. Audit dashboard, items list, and booking list endpoints
6. **Prefetching** — Verify Next.js link prefetching is working for key navigation paths (dashboard → items, dashboard → checkouts)

**Verification:** Build passes, bundle size comparison before/after, Lighthouse performance score

---

## Slice 9: PWA & Offline Support

**Priority:** Medium-High (students in basements/stadiums with spotty signal)
**Files:** `public/manifest.json` (new), `public/icons/` (new), `src/app/layout.tsx`, `next.config.ts`

1. **Web app manifest** — Create `manifest.json` with app name "Wisconsin Creative", Wisconsin red theme color, display: standalone, icons at 192px and 512px
2. **Apple touch icon** — Add apple-touch-icon meta tag and 180px icon for iOS home screen
3. **Meta tags** — Add `<meta name="theme-color">`, `<meta name="apple-mobile-web-app-capable">`, viewport-fit=cover for notched devices
4. **Service worker** — Evaluate feasibility given Cloudflare Worker deployment. Options:
   - Use `next-pwa` package for automatic SW generation
   - Manual lightweight SW that caches app shell and static assets
   - Cache-first for CSS/JS, network-first for API calls
5. **Offline scan page** — The scan page is critical for offline use (scanning gear in field houses). Cache the scan page shell and implement optimistic UI with background sync for scan results
6. **Offline indicator** — Show a subtle banner when offline: "You're offline. Changes will sync when connected"
7. **Install prompt** — Add "Add to Home Screen" prompt for iOS/Android users who visit frequently

**Verification:** Build passes, test install on iOS Safari, verify offline scan page works, test background sync

---

## Slice 10: Final Polish & QA

**Priority:** Required before ship
**Files:** All modified files

1. **Cross-browser testing** — Safari iOS, Chrome Android, Chrome desktop, Firefox desktop
2. **Orientation testing** — Verify landscape mode on iPhone doesn't break layouts (safe-area-inset-left/right)
3. **Dynamic Island / notch testing** — Verify top content isn't obscured on iPhone 14 Pro+
4. **Slow network testing** — Chrome DevTools throttle to 3G, verify loading states and timeouts
5. **Memory leak check** — Verify no leaked event listeners or intervals on page navigation
6. **Final Lighthouse audit** — Target scores: Performance >80, Accessibility >90, Best Practices >90, SEO >80
7. **Visual regression** — Screenshot all pages at 375px, 768px, 1440px for before/after comparison

---

## Implementation Order & Dependencies

```
Slice 1 (Item Detail) ──┐
Slice 2 (Notifications) ─┤── Can run in parallel (independent pages)
Slice 3 (Settings)  ─────┘
         │
Slice 4 (Search) ────────── Depends on AppShell changes
         │
Slice 5 (Empty States) ──── Can run independently
         │
Slice 6 (Dark Mode) ─────── Should come after all CSS class extraction (Slices 1-3)
         │
Slice 7 (Accessibility) ─── Should come after dark mode (contrast checks)
         │
Slice 8 (Performance) ────── Can run independently but benefits from final code
         │
Slice 9 (PWA) ────────────── Should come last (needs final assets & builds)
         │
Slice 10 (QA) ────────────── Must be last
```

## Estimated Scope
- **Slices 1-3:** CSS-heavy, similar to previous mobile audit work (~moderate each)
- **Slice 4:** New feature (search page + AppShell changes)
- **Slice 5:** Sweep across many files, but small changes each
- **Slice 6:** Large CSS effort + theme context + toggle UI
- **Slice 7:** Sweep across all components, medium effort per file
- **Slice 8:** Research-heavy, selective changes
- **Slice 9:** New infrastructure (manifest, SW, offline logic)
- **Slice 10:** Testing pass, no new code
