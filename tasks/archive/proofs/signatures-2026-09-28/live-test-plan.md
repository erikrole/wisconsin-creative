# Prepared isolated Signatures acceptance run

Status: prepared; not executed. Explicit approval is required after automatic approval review rejected the earlier proposed live test.

Target: localhost port 3490, signed preview branch `br-raspy-sun-au47wnog`, with its dedicated preview integration credential. The runner refuses any different branch, missing preview storage, or an existing `ADHOC / 2032-33` collection. It records the newly created collection/member IDs and checks that the collection still contains only its own synthetic signer before lifecycle mutations.

1. Create one `Signatures QA <random suffix>` signer through the iPad browser form in the unused 2032–33 season.
2. Save synthetic pen-class input through the real capture UI; verify the committed roster result. This is browser simulation, not physical Apple Pencil proof.
3. Replay the same request and attempt a stale save from a second browser. Verify no duplicate commit, no silent overwrite, and a stale reset rejection.
4. Replace that test signature, read both private revisions, inspect transparent PNG dimensions, download PNG/SVG ZIPs, and verify anonymous access is denied.
5. Erase only the test signer's revisions, verify the settings lock persists until reset, then reset, change settings, archive, and restore the owned test collection.
6. Delete only that newly created test collection after its signatures are erased. If a check fails, stop and retain the recorded IDs for inspection; do not perform blind cleanup.

No pre-existing roster, production database, or production credential is part of this run. The prepared runner is `.tmp/signatures-audit/real-e2e.mjs`; its default mode performs only a read-only preflight. `--execute` must not be used until the user approves these effects.
