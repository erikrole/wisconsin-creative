---
name: make-interfaces-feel-better
description: Wisconsin Creative web interface detail workflow. Use when visual implementation feels off or the user asks for UI polish, spacing, typography, color, borders, motion, interaction feedback, responsive refinement, or accessibility improvements on an existing Wisconsin Creative surface. Apply the product design language and verify the built route.
---

# Make Wisconsin Creative Interfaces Feel Better

Improve an existing surface without changing its product ownership or inventing a new visual language.

## Ground the pass

1. Read `docs/DESIGN_LANGUAGE.md`, `docs/COLOR_SYSTEM.md`, and the owning area doc.
2. Inspect the target surface in the browser before judging it when runtime access is available.
3. Read the target files and the shared components they use. Compare one or two strong peer surfaces with the same workflow shape.
4. Check `components.json` and installed components before proposing a new primitive.

## Priorities

Apply these in order:

1. Trust: status, label, action, and feedback match lifecycle truth.
2. Hierarchy: the primary action and operational state are obvious.
3. Recovery: loading, partial, empty, error, stale, and success states are useful.
4. Accessibility: focus, names, contrast, keyboard use, reduced motion, and 40px targets.
5. Consistency: shared Wisconsin Creative primitives and semantic tokens replace page-local variants where they fit.
6. Finish: spacing, typography, wrapping, alignment, borders, icons, and restrained functional motion.

## Wisconsin Creative defaults

- Keep operational surfaces dense, calm, and readable.
- Prefer `PageHeader`, `OperationalToolbar`, `OperationalStatusRail`, operational feedback components, `EmptyState`, and installed shadcn primitives.
- Use semantic status colors from the current color contract. Never use color as the only signal.
- Use subtle borders and `shadow-xs` only when separation is needed.
- Use motion for focus, state change, refresh, loading, and direct manipulation. Avoid decorative entrance sequences.
- Specify transition properties and respect reduced motion. Tune duration and scale to the interaction instead of applying universal values.
- Preserve stable labels and layout while work is pending.
- Treat phone-width web as smoke coverage; primary phone workflows belong to native iOS.

## Execute and verify

Keep edits inside the selected page or shared pattern. If a shared change would affect several routes, use `gt-plan` and record propagation scope first.

Select proof from the `AGENTS.md` verification matrix. For visible work, add authenticated browser proof of the changed interaction, console, network, keyboard/focus behavior, and relevant widths. Use screenshots when they materially prove the result.

Report the user-visible improvements, shared patterns adopted, browser proof, and any surface intentionally left alone. Do not turn the closeout into a generic before/after essay.
