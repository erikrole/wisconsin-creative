# Budget reconciliation and trust

Outcome: admins can distinguish unknown amounts from zero, preserve a submitted plan, and link purchases to the right inventory with accurate guidance. Existing imported budgets must remain intact and any automatic data recovery must be restricted to the specific source annotations that identify placeholders.

Scope: additive budget schema and forward migration, budget services/API and importer, matching, admin web UI, relevant tests and area documentation. No deployment or production migration is implied by source implementation.

Acceptance:
- Unit price and planned total are independently representable; unknown totals and unknown recorded spend are never presented as confirmed zero or a complete remaining balance.
- Existing plans receive an explicitly labeled migration-time snapshot, new plans are captured by an admin, and later edits cannot silently rewrite a saved total.
- Match suggestions consider team, product, actual spend and purchase evidence; weaker or mismatched items are never presented as confident links. Linking never silently changes inventory.
- Inventory guidance distinguishes missing purchased quantities, non-inventory purchases and already linked units; bulk links open the actual item family.
- Preserve user-created notes, links and other data; migration is additive and never infers an amount without unambiguous recorded evidence.

Verification: budget contract/import/matching/service/route tests, migration prefix/schema checks, TypeScript, lint, app build, docs checks, and authenticated UI proof or a precise limitation. No database deployment without explicit authorization.
