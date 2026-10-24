# Security policy

Wisconsin Creative is an invite-only production system for Wisconsin Athletics
Creative. The repository is public for review, but it holds no production data
or credentials.

## Reporting a vulnerability

Please report privately. Do not open a public issue or pull request.

- Use GitHub's **Report a vulnerability** button on the repository's
  [Security tab](https://github.com/erikrole/wisconsin-creative/security/advisories/new).
- If that is unavailable, contact the repository owner, [@erikrole](https://github.com/erikrole), through the email on their GitHub profile.

Include what you found, where, and the smallest steps to reproduce it. Expect an
acknowledgement within a few days. Please give us reasonable time to fix the
issue before sharing details.

## Scope

In scope: the web app, its API routes, the iOS app and kiosk, and the build and
release workflows in this repository. Out of scope: social engineering, denial
of service, and findings that need a physical device or an existing admin
account.

## What is already enforced

Dependency advisories gate every pull request (`scripts/audit-gate.mjs`), with
dated, expiring exceptions. Dependabot proposes updates weekly, CodeQL scans
`main` weekly, and secrets are never committed (see `.env.example`).
