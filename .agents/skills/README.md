# Wisconsin Creative workflows

Use repository-local skills directly. Start with the user's task; choose one primary workflow and add another only for a distinct dependency. `AGENTS.md` owns shared working rules and verification. Each skill adds its specific decisions rather than repeating a mandatory repository tour.

| What you need | Primary workflow |
| --- | --- |
| An actual Schedule, booking, availability, or kiosk incident | `gt-incident` |
| Web implementation, page ownership, or focused UI polish | `gt-page` |
| Native iOS or dedicated iPad kiosk implementation | `gt-ios-slice` |
| Web / native findings or readiness verdict | `gt-audit-web` / `gt-audit-ios` |
| API authorization, concurrency, audit, or failure recovery | `gt-api-hardening` |
| Schema, migration, or live migration history | `gt-migrate` |
| Build/deployment failure | `gt-deploy-debug` |
| Matched visual evidence | `gt-ui-review` |
| Reuse or change a local UI primitive | `shadcn` |
| A substantial plan or next-slice decision | `gt-plan` |
| Repository-wide priorities | `improve` |
| Scoped documentation reconciliation | `area-doc-sync` |
| Writing tests, or auditing low-value tests | `gt-test-audit` |
| Post-integration debris | `gt-clean-after-merge` |
| The requested commit, push, PR, deployment, or release | `gt-ship` |

Audits are findings-only unless the same request also authorizes fixes. “Audit and fix” continues through implementation; “plan”, “defer”, and “draft” stop at their requested deliverable. Preparation does not require repeated approval. External actions remain bounded by the user's existing authorization and repository policy.

## Start small

Read `AGENTS.md`; consult `docs/NORTH_STAR.md` when product direction is relevant. Inspect the actual working state and owning source/contracts. Search decisions, gaps, and lessons for relevant terms; do not reread every document or trace every dependency for a small edit. Inspect enough surrounding context and consumers to make a coherent edit; read the whole file when ownership or behavior requires it. A plan may be a short in-chat plan for a bounded task; create/update an owner ledger when the work needs durable tracking. Do not modify someone else's active plan.

Student/staff trust and correct physical custody outrank speculative feature expansion. Status is derived from real allocations; working Schedule edits are not published crew truth. Reconcile uncertain saves before retrying and preserve entered data.

## Compatibility

`audit-page-web` → `gt-audit-web`; `audit-page-ios` → `gt-audit-ios`; `page-ownership-pass` → `gt-page`; `prisma-migrate-safely` → `gt-migrate`; `make-interfaces-feel-better` → `gt-page` polish mode. These aliases remain explicitly invocable but are omitted from automatic selection.

The empty plugin wrapper was retired; it had no packaged skill directory. There is one maintained source for this suite: `.agents/skills/`. Global/vendor skills remain available for specialized platform requirements.

## Suite maintenance

Install `scripts/requirements-skills.txt` in your Python environment, then run `npm run verify:skills` from the repository. It validates all skill metadata, local Markdown links, alias routing and invocation policies, the case registry, and helper regression tests. The dedicated Skills workflow runs the same command on relevant PRs; it does not call a model or install application dependencies.

Seven decision scenarios are retained in [evals/cases.json](evals/cases.json). Prepare a frozen prompt, rubric and source hashes with `npm run eval:skills -- --output /tmp/wc-eval-unique`. To make an opt-in live Codex call instead, use a fresh directory and add `--run`; configured model defaults are preserved. Use `--case CASE_ID` for one scenario. Grade an existing response against a prepared rubric with `npm run eval:skills -- --output /tmp/wc-eval-unique --grade /path/to/response.json`.

The prompt excludes expected answers. Review each returned rationale and completion evidence against the saved manual rubric even when decision checks pass. These are hypothetical decision evaluations, not tool execution or production tests. Output stays local and includes source guidance and model responses; do not publish it indiscriminately.
