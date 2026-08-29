---
name: prisma-migrate-safely
description: Compatibility alias for Wisconsin Creative schema-first migration work. Use only when the user explicitly invokes /prisma-migrate-safely; immediately delegate to gt-migrate, which is the canonical Prisma and Neon workflow.
---

# Prisma Migrate Safely

This skill is sunset as an implementation workflow. Use `gt-migrate` for all schema design, migration generation, Neon drift diagnosis, deploy recovery, docs sync, and verification.

## Routing

1. Tell the user this invocation is now handled by `gt-migrate`.
2. Read `.agents/skills/gt-migrate/SKILL.md` completely.
3. Continue with the `gt-migrate` workflow.

## Preserved guardrails

- Read `prisma/schema.prisma` end-to-end before schema edits.
- Surface touched models, enums, cascade rules, decisions, and gaps before editing.
- Generate one coherent migration for one schema slice.
- Never edit an applied migration's SQL file (`prisma/migrations/*/migration.sql`). The PreToolUse hook will block this.
- Stop on failed migration generation instead of retrying with a different name.
