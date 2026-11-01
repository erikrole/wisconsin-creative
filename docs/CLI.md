# `wc` CLI and API tokens

`npm run wc -- <command>` (or `node scripts/wc.mjs`) drives the app from a terminal or an AI agent. Every command prints JSON; errors print the API error envelope on stderr and exit 1. Times are shown in America/Chicago (`--utc` for raw instants). `wc commands` lists everything.

## Auth

- Personal API tokens (`wc_` + 64 hex) act as their owner, so every role check still applies. Stored hashed in `api_tokens` (migration 0210). Staff and admins only, READ or WRITE scope, 1 to 365 days, 10 active at most. READ tokens are refused on any non-GET request.
- A request with `Authorization: Bearer wc_...` is authenticated by the token alone (no cookie fallback, no Origin check, role preview does not apply). Bad tokens are rate limited.
- Tokens cannot reach `isTokenBlockedRequest` routes (`src/lib/api-token.ts`): sign-in/auth, password, passkeys, sessions, token management, and admin create-user, reset-password and role changes.
- Password reset, password change with "sign out others", profile password change and deactivation delete the person's tokens.
- Mint with `wc login --email you@wisc.edu [--scope read|write]` (password from `WC_PASSWORD` or a prompt; the one-time sign-in session is signed out right after), or `wc login --token wc_...`. Saved to `~/.config/wc/credentials.json` (mode 0600). `WC_TOKEN` and `WC_URL` override it.

## Scheduling

Edits go to the private working schedule, the same path the web editor uses. `schedule assign|unassign` read the current version first, send it as `expectedVersion`/`expectedDraftId`, and retry once on a 409. Staff edits can queue an auto-release, and edits to an event that already ended publish immediately. `publish` and `discard` notify or destroy work, so they need `--yes`; `--dry-run` previews any write. `wc api METHOD /api/path --data '{}'` reaches every other action.

## For agents

`wc mcp` runs the same commands as an MCP server over stdio (tools such as `schedule_assign`, `trades_list`, `api`; read-only ones carry `readOnlyHint`). Add it to Claude Code with `claude mcp add wisconsin-creative -- node /path/to/repo/scripts/wc.mjs mcp` after `wc login`, or pass `WC_TOKEN`.

Run `wc commands` first, use `--dry-run` before writes, and branch on the error `code` (for example `ONBOARDING_REQUIRED`).
