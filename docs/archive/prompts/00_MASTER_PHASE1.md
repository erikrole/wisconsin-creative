Work in the existing repo: https://github.com/erikrole/wisconsin-creative
There is no production data yet; schema can change.

Goal: Phase 1 shipping MVP with:
- Mobile-first scan → checkout/check-in
- Liquid Glass inspired UI + Wisconsin typography (Aeternus Tall headers, Gotham body; Wisconsin font only as decorative accent)
- Mixed-location support (Camp Randall + Kohl Center) and mixed checkouts allowed
- Cheqroom import (CSV primary; Excel optional)
- ICS calendar sync (HOME feed)
- Overdue email + in-app notifications with escalation
- QR scan + label print view
- Derived status engine (single source of truth)
- Audit log for critical actions

Start by:
1) quick audit of repo + schema
2) propose refactor plan (what to keep/rewrite)
3) implement in this order:
   a) schema + derived status service
   b) import wizard
   c) scan-first mobile flows
   d) ICS sync
   e) overdue notifications + notification center
   f) reports (lean)
   g) UI polish pass

Do not rebuild from scratch. Refactor in-place.
Do not import Cheqroom “status” as truth.
Every critical action must write an AuditLog entry.