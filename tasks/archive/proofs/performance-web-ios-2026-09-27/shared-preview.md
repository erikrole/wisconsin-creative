# Shared performance preview — 2026-09-28

The reusable preview is ready for Codex and Claude on `claude/kiosk-multi-lens`. Its isolated database and three file stores are pinned, and encrypted handoff retrieval preserves the same resources and credentials. Normal browser sign-in works. No application deployment was created.

[Reuse and handoff guide](../../../../docs/PREVIEW_ENVIRONMENTS.md#reusable-performance-preview--2026-09-28) · [Provisioning receipt](preview-provisioning.json) · [Raw measurements](preview/results.json) · [Owner ledger](../../../performance-web-ios-plan-2026-09-27.md)

## Verified baseline

The final run passed **55 rendered page checks**: five fresh-browser loads and five same-context reloads for each of five routes, plus one narrow-mobile view per route. Eight APIs each passed five measured reads and one discarded warmup, with successful status and no reported partial failures. No uncaught page exceptions or horizontal overflow were found. API sampling uses the real browser session. This is an after-only baseline for future matched comparisons, not a measured before/after speedup.

The dataset has **34 synthetic users, 160 asset records, 20 bookings and 30 calendar events**. Signatures has no collections, so its populated-roster performance remains unmeasured.

| Page | Fresh-browser heading, median | Reload heading, median | Fresh-browser reads settled, median |
| --- | ---: | ---: | ---: |
| Home | 181 ms | 211 ms | 1377 ms |
| Items | 214 ms | 229 ms | 1637 ms |
| Bookings | 207 ms | 239 ms | 1240 ms |
| Schedule | 247 ms | 325 ms | 1884 ms |
| Signatures | 425 ms | 338 ms | 2097 ms |

A visible heading is separate from all content being ready. Reads-settled includes a 500ms observation delay after document load and completed GET/HEAD requests. Background POSTs are left intact and recorded separately: some returned success headers without browser completion events. The transfer-size field counts completed browser timing entries at that snapshot. These measurements cover document loads and reloads, not client-side link transitions or full interaction readiness.

| Authenticated API | Median | p95 estimate | JSON payload |
| --- | ---: | ---: | ---: |
| `/api/me` | 84.4 ms | 184.3 ms | 325 bytes |
| `/api/dashboard` | 663.7 ms | 788.5 ms | 11,571 bytes |
| `/api/dashboard/stats` | 172.2 ms | 186.7 ms | 351 bytes |
| `/api/items-page-init` | 155.3 ms | 187.7 ms | 1,720 bytes |
| `/api/assets?limit=50` | 1208.7 ms | 1757.8 ms | 54,412 bytes |
| `/api/bookings?limit=50` | 421.0 ms | 696.9 ms | 22,851 bytes |
| `/api/calendar-events?limit=100` | 405.6 ms | 434.3 ms | 13,960 bytes |
| `/api/signatures/collections` | 149.6 ms | 233.5 ms | 18 bytes |

The p95 is a nearest-rank estimate from five samples. Timings include the local app and remote isolated database; the browser and server are unthrottled. The server/database are awake even in a fresh-browser trial. Repeated runs showed normal variation, so these values establish a baseline and do not establish production tail latency or a warm-cache speedup.

## Reuse

Use Node 22 and the branch's existing setup. Neither agent needs provisioning keys for normal reuse:

```sh
npm run preview:setup
npm run preview:doctor
npm run dev:preview
# Another terminal, using the server's recorded port:
npm run auth:local
```

For a new controlled measurement:

```sh
node scripts/benchmark-authenticated-preview.mjs --build --samples 5
```

The benchmark starts and stops its own separate local production server. Results are saved in a new ignored `.tmp/preview-benchmarks/` directory. A prior report can prove an unchanged build with `--reuse-build-report <results.json>`; source fingerprint, build ID, preview branch and Node version must match. Logs and credentials stay local. The runbook includes a temporary Node 22 command for computers whose global Node version differs.

## Evidence and next slice

- Signed database/template identity, no pending migrations, retention pin, repeated setup and encrypted handoff round trip passed.
- Public images and both private stores passed synthetic upload/readback; private stores denied anonymous access and all generated test objects were removed.
- Production app build, TypeScript, benchmark lint, docs links/codemaps and diff checks passed. Existing unrelated full-repository lint findings remain recorded in the original report.
- [Desktop Home](preview/home-cold.png), [mobile Home](preview/home-narrow-mobile.png), [desktop Items](preview/items-cold.png), [mobile Items](preview/items-narrow-mobile.png), [Bookings](preview/bookings-cold.png), [Schedule](preview/schedule-cold.png), [Signatures](preview/signatures-cold.png). Ten capture hashes and settings are in [captures.json](preview/captures.json). These are after-only captures, not visual before/after evidence.
- The new command and documentation remain uncommitted. Claude in this checkout can use them now; another computer can retrieve the environment through authorized Vercel access but still needs the source files.

The largest sampled shared read is the 50-item asset list (about 1.21 seconds median), followed by Dashboard (about 0.66 seconds). Inspect their database/query breakdown next, retain this baseline, and repeat matched measurements before claiming an improvement. Native fixture measurements remain in the original report; the installed iOS app has not been redirected to this preview. Physical iPhone Release traces, native preview routing, hosted measurements, populated Signatures and client-side transitions remain separate proof.

Runtime: v22.23.2; Chromium 149.0.7827.55. Build `R8hrCeBQgERYbPXeJ2h8F`. Source fingerprint `c522916932ab8c3bf7bfc144699f716c9583cb3236f4f1fd45a85083bcca418b` remained unchanged throughout the completed run. [Prior build provenance](preview/build-provenance.json) is retained because the final run reused that verified build after an API-sampler correction.
