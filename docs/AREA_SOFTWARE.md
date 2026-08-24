# Software Vault Area

## Document Control

- Area: Shared software access
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-08-23
- Status: Active in production — baseline vault is live; first-class tab separation and local hardening are verified locally; role-scoped and secret-lifecycle acceptance remains
- Route: `/licenses` (presented as **Software**)

## Direction

Software is the team's small, internal access cabinet for shared department logins such as Envato Elements, APM Music, and Motion Array, plus a separate Photo Mechanic activation-license workflow. Both live at `/licenses` for route compatibility, but they are distinct URL-addressable views: **Photo Mechanic** is the default landing, and **Shared logins** is selected with `?tab=shared-logins`. Existing `?tab=photo-mechanic` links still open Photo Mechanic. The two-slot custody model never becomes a shared-login credential record.

The empty state names useful software examples but never seeds or invents credentials. An ADMIN or STAFF user enters the real department credentials through the management dialog.

## Security Contract

1. Active software records are visible only to authenticated users whose role is included on the record. `ADMIN` and `STAFF` retain visibility of every record for vault management; `STUDENT` requires the `STUDENT` audience; `COLLABORATOR` requires both the `COLLABORATOR` audience and the explicit `SOFTWARE_VAULT_VIEW` collaborator capability.
2. `ADMIN` and `STAFF` users may create, edit, restore, and archive records. Archive is the reversible lifecycle action; permanent deletion is not exposed.
3. Each record stores a non-secret `visibleTo` audience array with `STAFF`, `STUDENT`, and `COLLABORATOR` options. New records default to Staff + Students; at least one audience is required, and staff is not an ADMIN checkbox because administrators inherit staff management visibility.
4. Account email and password are stored as application-encrypted AES-256-GCM ciphertext. The dedicated `SOFTWARE_VAULT_KEY` must decode to exactly 32 bytes; missing or malformed configuration fails closed.
5. The list response decrypts only the account email for the authorized viewer and only after server-side audience filtering. It never returns the password or ciphertext. Passwords are available only through the separate authenticated reveal endpoint.
6. Password reveal/copy is rate-limited, audited without the secret, and returned with `private, no-store` response headers. The UI keeps a revealed value in client memory for at most 30 seconds, clears it on unmount, and can copy without displaying it; a successful copy briefly confirms in the button without changing the hidden state.
7. Secret values never appear in audit snapshots, errors, source fixtures, exports, or the repository. Key rotation requires coordinated re-encryption before replacing the configured key.

## Data Model

Migration `0125_software_credentials` adds `SoftwareCredential` with a unique name, optional category and website URL, encrypted account-email and password fields, archive timestamp, and created/updated timestamps. Migration `0126_software_credential_visibility` adds the non-secret `visible_to` audience array with a Staff + Students default. It intentionally has no user relation: the account is shared, while access and changes are actor-scoped through authentication, per-record audiences, collaborator policy, and audit records.

## API Surface

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET | `/api/software` | `software:view` or `SOFTWARE_VAULT_VIEW` | List audience-authorized active records; ADMIN/STAFF may request archived records too |
| POST | `/api/software` | `software:manage` | Create a software record and encrypt both secrets |
| PATCH | `/api/software/[id]` | `software:manage` | Update metadata/secrets or restore/archive a record |
| DELETE | `/api/software/[id]` | `software:manage` | Archive a record through the reversible lifecycle path |
| POST | `/api/software/[id]/secret` | `software:reveal` or `SOFTWARE_VAULT_VIEW` | Rate-limited password reveal/copy request for an audience-authorized record |

All mutations use the existing authenticated audit path. Secret endpoints return only the requested password and never include it in the audit event.

## UI Contract

- The `/licenses` page presents URL-backed **Photo Mechanic** and **Shared logins** tabs. Photo Mechanic is the default. The Shared logins view never renders Photo Mechanic pool controls or suggests Photo Mechanic as a shared account.
- Each active card leads with software name/category, optional official website, account email, and a masked password row.
- Copy Email is available from the list. Show Password and Copy Password explicitly request the secret; copy does not require rendering the password.
- Staff/admin management controls use a dialog for add/edit and an AlertDialog for archive. Editing leaves the password blank unless it is intentionally replaced.
- Add/edit includes a clear audience checklist for Staff, Students, and Collaborators. The selected audiences appear on each card, while collaborator policy access remains a separate admin-controlled capability.
- Copying a masked password writes it directly to the clipboard, keeps the password masked, and briefly swaps the copy icon for a check confirmation.
- Admin/staff archived records are separated from active records and can be restored.
- The Photo Mechanic tab keeps its student claim, masking, expiry, and staff/admin management behavior. It uses contextual pool actions and a mobile card/list layout so capacity, holders, expiry, and Claim/Inspect remain visible without horizontal scrolling.

## Permissions

- `software:view` / `software:reveal`: `ADMIN`, `STAFF`, `STUDENT`
- `software:manage`: `ADMIN`, `STAFF`
- `COLLABORATOR` remains absent from the central permission map and uses the default-deny `SOFTWARE_VAULT_VIEW` capability instead. This capability only opens the surface; each login still needs the Collaborators audience.

## Rollout Gates and Known Gaps

- Configure one stable, independently generated 32-byte base64 `SOFTWARE_VAULT_KEY` per environment. Production has a Sensitive key configured; preview and development must receive separate keys before vault use there.
- Migrations `0125_software_credentials` and `0126_software_credential_visibility` are applied and read back in production. `0126` has checksum `9a53d2962330acade5d053f7942ca9da49a71337dfd620a616d67e1792862a0d`, preserves the existing credential row, and leaves no unresolved migrations.
- Authenticated production proof passed for the admin surface at desktop and 390×844: the real credential remained masked, showed its Staff + Students default audience, and produced no horizontal overflow. Student/collaborator role filtering and reveal/copy/archive/restore remain pending; no secret was read, copied, or fabricated during release verification.
- The 2026-08-20 first-class tab and hardening follow-up is source, focused-test, TypeScript, lint, migration, and deploy-shaped-build verified locally only. It has not been claimed as a production deployment; authenticated browser evidence and matched `gt-ui-review` captures require an approved isolated session/fixture.
- Key rotation is an operational re-encryption procedure, not a self-service UI. Password history remains deferred; per-record audience sharing is live.

## Change Log

- 2026-08-23: Made Photo Mechanic the default `/licenses` landing. Shared logins moved to `?tab=shared-logins`; `?tab=photo-mechanic` remains compatible. Quiet Shared logins chrome so it no longer restates the tab title or treats Photo Mechanic as a footnote.

- 2026-08-20: Reconciled Software into two first-class URL-backed workflows on `/licenses`: Shared logins (default) and Photo Mechanic licenses (`?tab=photo-mechanic`). Contextualized Photo Mechanic actions, removed the product suggestion from shared-login copy, added mobile license cards, moved shared-login mutations and reveal auditing into serializable transactions, changed secret reveal to POST, minimized student license DTOs, and hardened CSV export/release behavior. Local gates pass; this follow-up is not represented as deployed without authenticated runtime proof.

- 2026-08-19: Shipped audience-gated Software logins in commit `0b6c7931` and production deployment `dpl_C76nqguhMWnUAq8hRSPW2Kudj3Wh`; rehearsed/applied/read back migration `0126_software_credential_visibility`, preserved the real credential with the Staff + Students default, and passed authenticated desktop/narrow masking, audience-label, and responsive-layout proof without exposing the secret.
- 2026-08-19: Shipped the encrypted Software Vault to production in commit `2548f4ce` and deployment `dpl_BuEMXuk96yzqyjj9sPTTAPEAQ2tS`; configured a production-only Sensitive key, applied/read back migration `0125_software_credentials`, and passed authenticated desktop/narrow empty-state and clean-console proof. First real-credential reveal/copy/archive/restore acceptance remains open.
- 2026-08-19: Added the local audience-gated login follow-up: per-login Staff/Student/Collaborator audiences, default-deny collaborator capability access, server-side filtering before email decryption, and hidden-copy confirmation. Migration `0126_software_credential_visibility` and role-scoped runtime proof remain rollout gates.
- 2026-08-19: Added the local encrypted Software Vault slice, preserved `/licenses` compatibility, and tracked migration, environment-key, and authenticated browser proof as rollout gates.
