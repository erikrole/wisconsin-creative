# Radio Clip sign-in preview

Owner: Radio Clip. Branch: `feat/radio-clip-sign-in`. Scope: browser approval, PKCE exchange, explicit access and native session lifecycle. No production merge/deployment or real-account grants are authorized by this preview task.

- [x] Isolate backend changes from the unrelated kit checkout on current main.
- [x] Reconcile migration numbering: `0163_radio_clip_sign_in`.
- [x] Full local suite: 5,398 passed, one opt-in skip; Node 22.
- [x] Prisma validation, changed-source lint, compile-only build, dependency high/critical audit gate.
- [ ] Commit/push and dedicated PR; required CI and managed preview complete.
- [ ] Attest branch-owned preview and verify migration/read-back.
- [ ] Synthetic-account API handoff, replay/race/revocation and browser/native acceptance.

Production remains off unless explicitly enabled; identified managed previews enable the handshake, but grant no user access automatically. See `docs/AREA_RADIO_CLIP.md` for session and rollout contracts.
