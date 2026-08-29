# Password Manager Integration Plan - 2026-08-24

## Goal

- Let a password manager find, fill, save, and update Wisconsin Creative credentials
  correctly on web and native iOS, without changing any authorization,
  validation, or session behaviour.

## Route

- Owner area: Users / Settings / Authentication
- Ledger: this plan; archive after device proof closes
- Follows the passkey experience slice in `tasks/passkey-auth-plan.md`

## Source Checks

- Every password field already carried a correct `autocomplete` token; none of
  the standalone password screens carried a `username` field to pair with it.
- The login email input unmounts when the step advances, so the password and
  onboarding steps had no account field at all.
- `deviceType`, `backedUp`, and the account email were already available to
  every surface that needed them; nothing new had to be persisted.
- The reset page is reached from an email link with no session and knew only
  the token, so it could not name the account.
- `webcredentials:wisconsincreative.com` is already published in the AASA route
  and the iOS entitlement, so native association was already in place.

## Stop Conditions

- Stop if a change would alter authorization, token consumption, session
  issuance, or password validation.
- Stop if the reset-link lookup could consume a token, distinguish an unknown
  token from an expired one, or enable enumeration.
- Stop if a hidden account field could be focused, submitted as user input, or
  reach the server as anything other than an unused form field.

## Slices

- [x] Slice 1: Shared web account-username field and password-rule attribute.
- [x] Slice 2: Pair every standalone web password form with its account.
- [x] Slice 3: Well-known change-password URL.
- [x] Slice 4: Reset-link account lookup, named account, early dead-link state.
- [x] Slice 5: Native account fields on Login, Set your password, Account &
      Security, and registration.
- [x] Slice 6: Route, contract, and source tests; screenshot UI tests.

## Verification

- [x] Focused tests: 9 in `tests/password-manager-integration.test.ts`; 54
      across the auth and passkey suites.
- [x] `npx tsc --noEmit --pretty false`.
- [x] Focused ESLint on changed TypeScript/TSX (`.well-known` routes are
      excluded by the repository ignore pattern, as the AASA route already was).
- [x] `git diff --check`.
- [x] Wisconsin simulator build on iPhone 16 Pro, with no temporary fixes —
      the parallel `StatusPill.swift` break reported on 2026-08-23 is fixed in
      `cac0f750`.
- [x] `PasswordManagerScreenshotUITests` passes under `WisconsinPerformance`
      and produced the matched native captures.
- [x] Live browser proof: `/.well-known/change-password` returns 303 to
      `/settings/security`; an unknown `/.well-known/` path still returns 404,
      which is the precondition clients check.
- [x] Live DOM proof on `/reset-password`: one `input[autocomplete="username"]`
      carrying the account address, `readOnly`, `tabIndex -1`, still in layout,
      and both new-password inputs carrying `passwordrules="minlength: 8;"`.
- [x] Pixel comparison of the native login password step: differences confined
      to the account line, zero differing pixel rows below it.
- [ ] `npm run build:app` — blocked while the user's `next dev` holds port 3000.
- [ ] Authenticated Settings Security proof — blocked: no local `DATABASE_URL`.
- [ ] Real-device proof that iOS offers to save and update the credential
      against the account field, and that Safari and 1Password honour the
      well-known URL from a saved item.

## Review

- Shipped locally: a shared account-username field used by sign-in, account
  creation, forced change, reset, and Settings; the well-known change-password
  URL; a rate-limited reset-link account lookup with an early dead-link state;
  declared password rules; native `.username` fields on four screens; tests and
  two screenshot UI tests.
- Deferred: the deploy-shaped build, authenticated web capture, and device proof
  of the save/update prompts.
- Next slice or stop: run the device proof above, then archive this plan. The
  passkey step-up recommendation in `tasks/passkey-auth-plan.md` is still the
  larger open question for people who never type their password.
