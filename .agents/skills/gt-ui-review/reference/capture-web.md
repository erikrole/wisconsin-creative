# Matched web captures

Use the existing authenticated preview workflow and available browser tooling. Inspect `package.json`, `scripts/start-preview-dev.mjs`, the target route, and existing Playwright tests before starting another server. Coordinate shared dev-server/build use.

Capture before edits where possible. Record the source baseline including relevant dirty state, exact route/query, user role, viewport, browser scale, locale/timezone, appearance, fixture clock, data, and scroll position. Use the same setup for after.

For deterministic comparison prefer an isolated fixture or test account. Label intercepted network responses as fixture evidence; they do not prove durable record mutation. A separate authenticated interaction check should exercise the actual changed route when required and available. Use sensitive live data only when authorized and keep proof private/sanitized.

Wait for the actual content or failure state to settle, not an arbitrary long sleep. Capture the affected states with existing tests or repeatable browser steps. Check console/network and keyboard/focus recovery when relevant. Use installed browser skills only for the selected tool's API, not a second product audit.

If a baseline must be reconstructed, use an isolated snapshot rather than reverting files in the active checkout. Never substitute HEAD for pre-existing dirty work. If source/data cannot be matched, label the limitation or use after-only evidence.

Inspect each image and the built local review. Report what was rendered, what was interacted with, and what remains unverified. A screenshot is not proof of server authorization, persistence, deployment, or notification delivery.
