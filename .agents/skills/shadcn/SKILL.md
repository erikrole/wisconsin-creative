---
name: shadcn
description: Wisconsin Creative shadcn/ui component workflow. Use when adding, updating, debugging, or composing a shadcn primitive, when components.json or a registry is involved, or when deciding whether an existing Wisconsin Creative control should use an installed shadcn component. Prefer current local components and product contracts before CLI or registry changes.
---

# Shadcn for Wisconsin Creative

Use shadcn as source-owned infrastructure for Wisconsin Creative, not as a generic page-design generator.

## Establish project context

1. Read `components.json`, `docs/DESIGN_LANGUAGE.md`, and `docs/COLOR_SYSTEM.md`.
2. List `src/components/ui/` and inspect the relevant installed primitive completely.
3. Search existing Wisconsin Creative usage and shared operational components before adding or changing anything.
4. Confirm the package runner and current shadcn API from the repository and official CLI output. Do not assume an upstream example matches this checkout.

## Selection rules

- Reuse an installed primitive when it satisfies the interaction and accessibility contract.
- Prefer Wisconsin Creative shared components such as `PageHeader`, operational toolbars, status rails, feedback, row actions, and `EmptyState` when they own product behavior beyond a primitive.
- Compose forms, overlays, menus, and tables from the APIs that actually exist in the local component files.
- Do not require upstream components that are not installed.
- Preserve local semantic variants, status colors, hit targets, and accessibility behavior.
- Avoid community registry components unless the user requests one or current local primitives cannot meet the accepted design.

## CLI changes

Use the project's package runner and official shadcn CLI only when adding or updating a primitive.

1. Inspect `npx shadcn@latest info` and official component docs when network access is available.
2. Preview updates with `--dry-run` and `--diff`.
3. Never overwrite a locally modified primitive without explicit approval.
4. Read every generated or changed file. Reconcile imports, icon library, variants, tokens, accessibility, and local product conventions.
5. Do not initialize a new preset or switch component bases without explicit product and migration approval.

## Verification

Select proof from the `AGENTS.md` verification matrix. Add focused source-contract or component tests when a shared primitive contract changes. Run codemap/docs checks when shared ownership changes and authenticated browser proof for visible route behavior.

Report which existing primitive or registry item was used, what local behavior was preserved, the exact verification, and any routes requiring follow-up.
